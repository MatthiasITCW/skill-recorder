export type RecordingStartDecision = "show-warning" | "start";

/** App-lifetime privacy acknowledgement; a new process creates a fresh session. */
export class RecordingPrivacySession {
  private reviewed = false;

  startDecision(): RecordingStartDecision {
    return this.reviewed ? "start" : "show-warning";
  }

  markReviewed(): void {
    this.reviewed = true;
  }
}
