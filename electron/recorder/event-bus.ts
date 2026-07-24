import type { EventInput } from "../../common/events";
import type { RecEvent } from "../../common/types";
import type { SessionStore } from "./session-store";

export type EventListener = (ev: RecEvent) => void;

/**
 * In-process hub between collectors and the active session. Collectors publish
 * typed `EventInput`s; the bus persists them via the attached `SessionStore`
 * and fans them out to subscribers (status updates now; correlation later).
 * When no session is active (`detach`ed) published events are safely dropped,
 * so a collector that fires slightly after Stop cannot write to a closed store.
 */
export class EventBus {
  private store: SessionStore | null = null;
  private readonly listeners = new Set<EventListener>();

  attach(store: SessionStore): void {
    this.store = store;
  }

  detach(): void {
    this.store = null;
  }

  get active(): boolean {
    return this.store !== null;
  }

  publish(input: EventInput): RecEvent | null {
    if (!this.store) return null;
    const ev = this.store.append(input.type, input.source, input.payload);
    for (const listener of this.listeners) listener(ev);
    return ev;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
