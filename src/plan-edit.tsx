import { useEffect, useRef, useState, type ReactNode } from "react";

import type { AnalysisStep } from "../common/analysis";
import {
  describeSchedule,
  type AutomationSchedule,
  type AutomationStepDraft,
  type TimeOfDay,
} from "../common/automation";
import type { PlanStep, SkillInput } from "../common/skill";

/* --- shared array helpers (pure) ----------------------------------------- */

export function replaceAt<T>(arr: T[], i: number, next: T): T[] {
  const out = arr.slice();
  out[i] = next;
  return out;
}
export function removeAt<T>(arr: T[], i: number): T[] {
  return arr.filter((_, idx) => idx !== i);
}
export function moveItem<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const out = arr.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/* --- shared vocab (input source) ----------------------------------------- */

export const SOURCE_LABEL: Record<SkillInput["source"], string> = {
  fixed: "Fixed value",
  provided: "You provide it",
  locate: "The agent finds it",
};

const SOURCE_OPTIONS: { value: SkillInput["source"]; label: string }[] = [
  { value: "fixed", label: "Fixed value" },
  { value: "provided", label: "You provide it" },
  { value: "locate", label: "The agent finds it" },
];

const SOURCE_HINT: Record<SkillInput["source"], string> = {
  fixed: "The exact URL / path / value, baked in",
  provided: "What to ask you for when it runs",
  locate: "How the agent should find it on your device",
};


/* --- EditableText: reads as plain text, becomes an input on click --------- */

export function EditableText({
  value,
  onChange,
  placeholder = "",
  multiline = false,
  as = "span",
  className = "",
  rows = 2,
  hideEmpty = false,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
  as?: "span" | "div" | "p";
  className?: string;
  rows?: number;
  /** When empty, stay invisible until the surrounding tile is hovered. */
  hideEmpty?: boolean;
  ariaLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [editing]);

  const begin = () => {
    setDraft(value);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft);
  };
  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    const shared = {
      value: draft,
      "aria-label": ariaLabel ?? placeholder,
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      onBlur: commit,
    };
    return multiline ? (
      <textarea
        ref={ref as React.Ref<HTMLTextAreaElement>}
        className={`ed-input ed-input-multi ${className}`}
        rows={rows}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          }
        }}
        {...shared}
      />
    ) : (
      <input
        ref={ref as React.Ref<HTMLInputElement>}
        className={`ed-input ${className}`}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          } else if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        {...shared}
      />
    );
  }

  const empty = value.trim().length === 0;
  const Tag = as;
  return (
    <Tag
      className={`ed-read ${multiline ? "ed-read-multi" : ""} ${empty ? "ed-empty" : ""} ${
        empty && hideEmpty ? "ed-hide" : ""
      } ${className}`}
      tabIndex={0}
      role="textbox"
      aria-label={ariaLabel ?? placeholder}
      title="Click to edit"
      onClick={begin}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          begin();
        }
      }}
    >
      {empty ? placeholder : value}
    </Tag>
  );
}

/* --- EditablePill: reads as a tinted pill, becomes a select on click ------ */

function EditablePill<T extends string>({
  value,
  options,
  onChange,
  pill,
  selectClassName = "",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  pill: ReactNode;
  selectClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <select
        ref={ref}
        className={`tile-select ${selectClassName}`}
        value={value}
        onChange={(e) => {
          onChange(e.target.value as T);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <button type="button" className="pill-btn" title="Click to change" onClick={() => setEditing(true)}>
      {pill}
    </button>
  );
}

/* --- reusable row controls (hover-revealed by CSS) ----------------------- */

function RowControls({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  /** Omit to hide reorder arrows (e.g. for unordered inputs). */
  onMove?: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="row-controls">
      {onMove && (
        <>
          <button
            type="button"
            className="tile-btn"
            title="Move up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="tile-btn"
            title="Move down"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
        </>
      )}
      <button type="button" className="tile-btn tile-btn-del" title="Remove" onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

function AddTile({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <button type="button" className="tile-add" onClick={onAdd}>
      + {label}
    </button>
  );
}

let uidCounter = 0;
function newId(prefix: string): string {
  uidCounter += 1;
  return `${prefix}${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

/* --- Inputs (a SET — editable, add/remove, but NOT reorderable) ----------- */

export function InputTiles({
  inputs,
  onChange,
}: {
  inputs: SkillInput[];
  onChange: (next: SkillInput[]) => void;
}) {
  const patch = (i: number, part: Partial<SkillInput>) =>
    onChange(replaceAt(inputs, i, { ...inputs[i], ...part }));

  return (
    <div className="tiles">
      {inputs.map((inp, i) => (
        <div key={i} className="tile input-tile">
          <div className="tile-head">
            <EditableText
              className="ed-name"
              value={inp.name}
              placeholder="Input name"
              ariaLabel="Input name"
              onChange={(v) => patch(i, { name: v })}
            />
            <EditablePill
              value={inp.source}
              options={SOURCE_OPTIONS}
              onChange={(v) => patch(i, { source: v })}
              pill={<span className={`src-badge src-${inp.source}`}>{SOURCE_LABEL[inp.source]}</span>}
            />
            <RowControls index={i} count={inputs.length} onRemove={() => onChange(removeAt(inputs, i))} />
          </div>
          <EditableText
            as="p"
            multiline
            className="ed-detail"
            value={inp.detail}
            placeholder={SOURCE_HINT[inp.source]}
            ariaLabel="Input detail"
            hideEmpty
            onChange={(v) => patch(i, { detail: v })}
          />
        </div>
      ))}
      <AddTile
        label="Add input"
        onAdd={() => onChange([...inputs, { name: "", description: "", source: "provided", detail: "" }])}
      />
    </div>
  );
}

/* --- Skill steps (ordered; numbered title + description) ------------------ */

export function SkillStepTiles({
  steps,
  onChange,
}: {
  steps: PlanStep[];
  onChange: (next: PlanStep[]) => void;
}) {
  const patch = (i: number, part: Partial<PlanStep>) =>
    onChange(replaceAt(steps, i, { ...steps[i], ...part }));

  return (
    <div className="tiles">
      {steps.map((s, i) => (
        <div key={i} className="tile step-tile">
          <div className="tile-head">
            <span className="tile-num">{i + 1}</span>
            <EditableText
              className="ed-strong"
              value={s.title}
              placeholder="Step title"
              ariaLabel="Step title"
              onChange={(v) => patch(i, { title: v })}
            />
            <RowControls
              index={i}
              count={steps.length}
              onMove={(dir) => onChange(moveItem(steps, i, dir))}
              onRemove={() => onChange(removeAt(steps, i))}
            />
          </div>
          <EditableText
            as="p"
            multiline
            className="ed-detail"
            value={s.text}
            placeholder="What happens in this step?"
            ariaLabel="Step description"
            onChange={(v) => patch(i, { text: v })}
          />
          <div className="tile-foot">
            <EditableText
              className="ed-tool"
              value={s.tool}
              placeholder="+ native tool"
              ariaLabel="Native tool"
              hideEmpty
              onChange={(v) => patch(i, { tool: v })}
            />
          </div>
        </div>
      ))}
      <AddTile
        label="Add step"
        onAdd={() => onChange([...steps, { kind: "action", title: "", text: "", tool: "" }])}
      />
    </div>
  );
}

/* --- Automation steps (ordered; label + NL prompt) ------------------------ */

export function AutomationStepTiles({
  steps,
  onChange,
}: {
  steps: AutomationStepDraft[];
  onChange: (next: AutomationStepDraft[]) => void;
}) {
  const patch = (i: number, part: Partial<AutomationStepDraft>) =>
    onChange(replaceAt(steps, i, { ...steps[i], ...part }));

  return (
    <div className="tiles">
      {steps.map((s, i) => (
        <div key={i} className="tile step-tile">
          <div className="tile-head">
            <span className="tile-num">{i + 1}</span>
            <EditableText
              className="ed-strong"
              value={s.label}
              placeholder="Step label"
              ariaLabel="Step label"
              onChange={(v) => patch(i, { label: v })}
            />
            <RowControls
              index={i}
              count={steps.length}
              onMove={(dir) => onChange(moveItem(steps, i, dir))}
              onRemove={() => onChange(removeAt(steps, i))}
            />
          </div>
          <EditableText
            as="p"
            multiline
            className="ed-detail"
            value={s.prompt}
            placeholder="The instruction the agent runs for this step"
            ariaLabel="Step instruction"
            onChange={(v) => patch(i, { prompt: v })}
          />
        </div>
      ))}
      <AddTile label="Add step" onAdd={() => onChange([...steps, { label: "", prompt: "" }])} />
    </div>
  );
}

/* --- Analysis steps (ordered; title + detail) ----------------------------- */

export function AnalysisStepTiles({
  steps,
  onChange,
}: {
  steps: AnalysisStep[];
  onChange: (next: AnalysisStep[]) => void;
}) {
  const patch = (i: number, part: Partial<AnalysisStep>) =>
    onChange(replaceAt(steps, i, { ...steps[i], ...part }));

  return (
    <div className="tiles">
      {steps.map((s, i) => (
        <div key={s.id} className="tile step-tile">
          <div className="tile-head">
            <span className="tile-num">{i + 1}</span>
            <EditableText
              className="ed-strong"
              value={s.title}
              placeholder="What you did"
              ariaLabel="Step title"
              onChange={(v) => patch(i, { title: v })}
            />
            <RowControls
              index={i}
              count={steps.length}
              onMove={(dir) => onChange(moveItem(steps, i, dir))}
              onRemove={() => onChange(removeAt(steps, i))}
            />
          </div>
          <EditableText
            as="p"
            multiline
            className="ed-detail"
            value={s.detail}
            placeholder="A little more detail"
            ariaLabel="Step detail"
            hideEmpty
            onChange={(v) => patch(i, { detail: v })}
          />
        </div>
      ))}
      <AddTile
        label="Add step"
        onAdd={() =>
          onChange([
            ...steps,
            { id: newId("u"), title: "", detail: "", apps: [], evidence: [], confidence: "medium" },
          ])
        }
      />
    </div>
  );
}

/* --- Automation schedule editor (read-first: sentence → controls) --------- */

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const INTERVAL_CHOICES = [15, 30, 60, 120, 180, 240, 360, 720];

function fmtTime(t: TimeOfDay): string {
  return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}
function parseTime(v: string): TimeOfDay {
  const [h, m] = v.split(":").map((n) => Number.parseInt(n, 10));
  return { hour: Number.isFinite(h) ? h : 0, minute: Number.isFinite(m) ? m : 0 };
}
function anchorOf(s: AutomationSchedule): TimeOfDay {
  if (s.kind === "single") return s.time;
  if (s.kind === "interval") return s.anchor;
  return s.times[0] ?? { hour: 9, minute: 0 };
}

/** Compact schedule editor. Reads as a plain-language sentence; "Edit" reveals the
 *  structured controls. Structured edits clear `naturalLanguage` so the displayed
 *  cadence always reflects the real firing rule. */
export function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: AutomationSchedule;
  onChange: (next: AutomationSchedule) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="sched-read">
        <span className="sched-when">{describeSchedule(schedule)}</span>
        <button type="button" className="linky" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
    );
  }

  const days = schedule.days;
  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    onChange({ ...schedule, days: next, naturalLanguage: "" });
  };

  const changeKind = (kind: AutomationSchedule["kind"]) => {
    if (kind === schedule.kind) return;
    const anchor = anchorOf(schedule);
    if (kind === "single") onChange({ kind: "single", naturalLanguage: "", days, time: anchor });
    else if (kind === "interval")
      onChange({ kind: "interval", naturalLanguage: "", days, intervalMinutes: 60, anchor });
    else onChange({ kind: "multi", naturalLanguage: "", days, times: [anchor] });
  };

  return (
    <div className="sched-edit">
      <div className="sched-row">
        <select
          className="tile-select"
          value={schedule.kind}
          onChange={(e) => changeKind(e.target.value as AutomationSchedule["kind"])}
        >
          <option value="single">Once a day</option>
          <option value="interval">Every…</option>
          <option value="multi">A few times a day</option>
        </select>

        {schedule.kind === "single" && (
          <input
            type="time"
            className="tile-input tile-time"
            value={fmtTime(schedule.time)}
            onChange={(e) => onChange({ ...schedule, time: parseTime(e.target.value), naturalLanguage: "" })}
          />
        )}

        {schedule.kind === "interval" && (
          <>
            <select
              className="tile-select"
              value={schedule.intervalMinutes}
              onChange={(e) =>
                onChange({ ...schedule, intervalMinutes: Number.parseInt(e.target.value, 10), naturalLanguage: "" })
              }
            >
              {INTERVAL_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} min` : `${m / 60} h`}
                </option>
              ))}
            </select>
            <span className="sched-lbl">from</span>
            <input
              type="time"
              className="tile-input tile-time"
              value={fmtTime(schedule.anchor)}
              onChange={(e) => onChange({ ...schedule, anchor: parseTime(e.target.value), naturalLanguage: "" })}
            />
          </>
        )}

        <button type="button" className="linky sched-done" onClick={() => setEditing(false)}>
          Done
        </button>
      </div>

      {schedule.kind === "multi" && (
        <div className="sched-times">
          {schedule.times.map((t, i) => (
            <div key={i} className="sched-time-row">
              <input
                type="time"
                className="tile-input tile-time"
                value={fmtTime(t)}
                onChange={(e) =>
                  onChange({ ...schedule, times: replaceAt(schedule.times, i, parseTime(e.target.value)), naturalLanguage: "" })
                }
              />
              <button
                type="button"
                className="tile-btn tile-btn-del"
                title="Remove time"
                disabled={schedule.times.length <= 1}
                onClick={() => onChange({ ...schedule, times: removeAt(schedule.times, i), naturalLanguage: "" })}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="tile-add"
            onClick={() =>
              onChange({ ...schedule, times: [...schedule.times, anchorOf(schedule)], naturalLanguage: "" })
            }
          >
            + Add time
          </button>
        </div>
      )}

      <div className="sched-days">
        <span className="sched-lbl">On</span>
        {DAY_LABELS.map((lbl, d) => (
          <button
            key={d}
            type="button"
            className={`day-chip${days.length === 0 || days.includes(d) ? " on" : ""}`}
            title={days.length === 0 ? "Every day" : undefined}
            onClick={() => toggleDay(d)}
          >
            {lbl}
          </button>
        ))}
        {days.length === 0 && <span className="sched-lbl sched-every">every day</span>}
      </div>
    </div>
  );
}
