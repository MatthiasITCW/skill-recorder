import type { EventInput, EventPayloads, EventType } from "../../common/events";
import { createLogger } from "../logger";
import type { EventBus } from "./event-bus";

type Logger = ReturnType<typeof createLogger>;

/** Handle a collector receives on start: how to publish and where to write. */
export interface CollectorContext {
  /** Publish a typed event; `source` is filled in with the collector name. */
  publish<K extends EventType>(type: K, payload: EventPayloads[K]): void;
  /** The current session's directory (for collectors that write side files). */
  sessionDir: string;
  log: Logger;
}

/**
 * A source of events. Implementations are cheap to construct and only do real
 * work between `start` and `stop`. Both may be async (native handles, polling
 * loops, file tails). Later milestones add ActiveWindow / Clipboard / Terminal.
 */
export interface Collector {
  readonly name: string;
  start(ctx: CollectorContext): void | Promise<void>;
  stop(): void | Promise<void>;
}

/**
 * Owns the lifecycle of a set of collectors for one recording session and wires
 * each collector's `publish` to the shared `EventBus`. Start/stop failures are
 * isolated so one bad collector can't abort a recording.
 */
export class CollectorHost {
  private active: Collector[] = [];
  private readonly log: Logger;

  constructor(private readonly bus: EventBus) {
    this.log = createLogger("Collectors");
  }

  async startAll(collectors: readonly Collector[], sessionDir: string): Promise<void> {
    this.active = [];
    for (const collector of collectors) {
      const ctx: CollectorContext = {
        sessionDir,
        log: createLogger(collector.name),
        publish: (type, payload) => {
          this.bus.publish({ type, source: collector.name, payload } as EventInput);
        },
      };
      try {
        await collector.start(ctx);
        this.active.push(collector);
      } catch (err) {
        this.log.error(`"${collector.name}" failed to start:`, err);
      }
    }
  }

  async stopAll(): Promise<void> {
    const collectors = this.active;
    this.active = [];
    await Promise.all(
      collectors.map(async (collector) => {
        try {
          await collector.stop();
        } catch (err) {
          this.log.error(`"${collector.name}" failed to stop:`, err);
        }
      }),
    );
  }
}
