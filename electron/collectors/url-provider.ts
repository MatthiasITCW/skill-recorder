import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

/**
 * Reads the *active tab URL* of the frontmost browser — the single richest
 * non-video signal we can't get from window titles alone. macOS exposes it only
 * via AppleScript / Apple Events (a per-browser "Automation" grant), so this is
 * deliberately isolated behind a small interface:
 *   - it can be called **on demand** (only when a browser is frontmost and
 *     something changed) instead of on every poll, keeping Apple Events traffic
 *     to the browser — and the perceptible lag it causes — low;
 *   - a future Windows implementation (UI Automation address-bar read) or a
 *     macOS Accessibility implementation can slot in behind the same interface.
 */
export interface ActiveUrl {
  url: string;
  title?: string;
}

export interface UrlProvider {
  /** True when this provider can read a URL for the given frontmost app. */
  supports(app: string): boolean;
  /** Best-effort active-tab URL; resolves null on any failure (never throws). */
  get(app: string): Promise<ActiveUrl | null>;
}

// Browsers whose scripting dictionary exposes `active tab of front window`.
const CHROMIUM_BROWSERS = new Set<string>([
  "Google Chrome",
  "Google Chrome Canary",
  "Google Chrome Beta",
  "Google Chrome Dev",
  "Microsoft Edge",
  "Microsoft Edge Beta",
  "Microsoft Edge Dev",
  "Microsoft Edge Canary",
  "Brave Browser",
  "Brave Browser Beta",
  "Brave Browser Nightly",
  "Vivaldi",
  "Opera",
  "Opera GX",
  "Arc",
  "Chromium",
  "Yandex",
]);

// Browsers that use `front document` (WebKit/Safari scripting dictionary).
const WEBKIT_BROWSERS = new Set<string>(["Safari", "Safari Technology Preview"]);

export type BrowserEngine = "chromium" | "webkit";

/** Identify a frontmost app's scripting dialect, or null if it's not a browser. */
export function browserEngine(app: string): BrowserEngine | null {
  if (CHROMIUM_BROWSERS.has(app)) return "chromium";
  if (WEBKIT_BROWSERS.has(app)) return "webkit";
  return null;
}

export function isBrowserApp(app: string): boolean {
  return browserEngine(app) !== null;
}

const SEP = String.fromCharCode(30); // ASCII record separator, unlikely in URLs/titles

function chromiumScript(app: string): string {
  return (
    `tell application "${app}"\n` +
    `set _u to URL of active tab of front window\n` +
    `set _t to title of active tab of front window\n` +
    `return _u & (ASCII character 30) & _t\n` +
    `end tell`
  );
}

function webkitScript(app: string): string {
  return (
    `tell application "${app}"\n` +
    `set _u to URL of front document\n` +
    `set _t to name of front document\n` +
    `return _u & (ASCII character 30) & _t\n` +
    `end tell`
  );
}

function osascript(script: string, timeoutMs = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], { timeout: timeoutMs }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/**
 * macOS URL provider via AppleScript. Only ever invoked for allow-listed browser
 * apps, so the interpolated app name is trusted (no shell/AS injection surface).
 */
export class MacUrlProvider implements UrlProvider {
  supports(app: string): boolean {
    return isBrowserApp(app);
  }

  async get(app: string): Promise<ActiveUrl | null> {
    const engine = browserEngine(app);
    if (!engine) return null;
    const script = engine === "chromium" ? chromiumScript(app) : webkitScript(app);
    try {
      const out = await osascript(script);
      const [url, title] = out.replace(/\n+$/, "").split(SEP);
      if (!url || url === "missing value") return null;
      return { url: url.trim(), title: title?.trim() || undefined };
    } catch {
      // No front window, browser busy, or Automation permission not granted.
      return null;
    }
  }
}

/**
 * Windows URL provider via a persistent PowerShell sidecar running UI Automation.
 *
 * Architecture: a single long-lived PowerShell process loads the UIA assemblies
 * once at startup, then enters a loop reading commands from stdin. Each `get()`
 * call writes a request line; the sidecar reads the active browser's address bar
 * via AutomationId (omnibox, addressEditBox, urlbar) with fallbacks to Edit and
 * Document controls, and writes the result as a single JSON line to stdout.
 *
 * This mirrors the approach used by other open-source Windows activity trackers
 * (f4w4z/trace, Sunhaiy/suxin-desktop) which also use a persistent PowerShell
 * process to avoid the ~200ms cold-start penalty per query.
 */
export class WindowsUrlProvider implements UrlProvider {
  private proc: ChildProcess | null = null;
  private reader: ReadlineInterface | null = null;
  private pending: { resolve: (v: string) => void; timer: NodeJS.Timeout } | null = null;
  private starting = false;

  supports(app: string): boolean {
    return isBrowserApp(app);
  }

  async get(_app: string): Promise<ActiveUrl | null> {
    this.ensureProc();
    if (!this.proc) return null;
    try {
      const line = await this.query();
      if (!line) return null;
      const parsed = JSON.parse(line) as { url?: string; title?: string };
      if (!parsed.url) return null;
      const cleanTitle = parsed.title
        ?.replace(/\s*[-\u2013\u2014]\s*(Microsoft\s+Edge|Google\s+Chrome|Brave|Vivaldi|Opera|Arc).*$/i, "")
        .trim();
      return { url: parsed.url, title: cleanTitle || undefined };
    } catch {
      return null;
    }
  }

  private ensureProc(): void {
    if (this.proc || this.starting) return;
    this.starting = true;
    this.proc = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", SIDECAR_SCRIPT], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    this.proc.on("exit", () => {
      this.proc = null;
      this.reader = null;
      this.starting = false;
    });
    this.proc.on("error", () => {
      this.proc = null;
      this.reader = null;
      this.starting = false;
    });
    this.reader = createInterface({ input: this.proc.stdout!, crlfDelay: Infinity });
    this.reader.on("line", (line: string) => {
      if (!this.pending) return;
      clearTimeout(this.pending.timer);
      this.pending.resolve(line);
      this.pending = null;
    });
    this.starting = false;
  }

  private query(): Promise<string> {
    return new Promise((resolve) => {
      if (!this.proc?.stdin?.writable) {
        resolve("");
        return;
      }
      const timer = setTimeout(() => {
        this.pending = null;
        resolve("");
      }, 1500);
      this.pending = { resolve, timer };
      this.proc.stdin.write("query\n");
    });
  }
}

/**
 * Self-contained PowerShell script that:
 * 1. Loads UIA assemblies and Win32 interop once at startup
 * 2. Reads lines from stdin in a loop
 * 3. On each "query" line, finds the foreground browser URL via UIA
 * 4. Writes one JSON line to stdout: {"url":"...","title":"..."} or {}
 *
 * The script uses AutomationId-based lookup (omnibox, addressEditBox, urlbar)
 * which is more reliable than name-matching across locales.
 */
const SIDECAR_SCRIPT = `
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-BrowserUrl {
  # The caller (ActiveWindowCollector) already knows a browser is frontmost.
  # Find the first Chrome_WidgetWin_1 top-level window and read its address bar.
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Chrome_WidgetWin_1')
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  $el = $null
  foreach ($w in $wins) { $el = $w; break }
  if (-not $el) { return $null }

  try {

    # Primary: known automation IDs for address bars
    foreach ($id in @('omnibox','addressEditBox','urlbar-edit-view','urlbar','view_id/omnibox_url_field')) {
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
      $found = $el.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      if ($found) {
        try {
          $vp = $found.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
          if ($vp) {
            $val = ([System.Windows.Automation.ValuePattern]$vp).Current.Value
            if ($val -match '^https?://') {
              return @{ url = $val; title = $el.Current.Name }
            }
          }
        } catch {}
      }
    }

    # Fallback: Edit control whose name matches address/URL patterns
    $editCond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit)
    $edits = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
    foreach ($edit in $edits) {
      if ($edit.Current.Name -match 'address|search bar|URL') {
        try {
          $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
          if ($vp) {
            $val = ([System.Windows.Automation.ValuePattern]$vp).Current.Value
            if ($val -match '^https?://') {
              return @{ url = $val; title = $el.Current.Name }
            }
          }
        } catch {}
      }
    }

    # Fallback 2: Document control (newer Edge/Chrome versions)
    $docCond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Document)
    $docs = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $docCond)
    foreach ($d in $docs) {
      try {
        $vp = $d.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($vp) {
          $val = ([System.Windows.Automation.ValuePattern]$vp).Current.Value
          if ($val -match '^https?://') {
            return @{ url = $val; title = $el.Current.Name }
          }
        }
      } catch {}
    }
  } catch {}
  return $null
}

# Main loop: read stdin, respond on stdout
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $result = Get-BrowserUrl
  if ($result) {
    $json = '{"url":' + (ConvertTo-Json $result.url -Compress) + ',"title":' + (ConvertTo-Json $result.title -Compress) + '}'
    [Console]::Out.WriteLine($json)
  } else {
    [Console]::Out.WriteLine('{}')
  }
  [Console]::Out.Flush()
}
`;

/** The URL provider for the current platform, or null where unsupported. */
export function createUrlProvider(): UrlProvider | null {
  if (process.platform === "darwin") return new MacUrlProvider();
  if (process.platform === "win32") return new WindowsUrlProvider();
  return null;
}
