import assert from "node:assert/strict";
import test from "node:test";

import { RecordingPrivacySession } from "./recording-privacy";

test("warns before every start until the detailed disclosure is reviewed", () => {
  const privacy = new RecordingPrivacySession();

  assert.equal(privacy.startDecision(), "show-warning");
  assert.equal(privacy.startDecision(), "show-warning");

  privacy.markReviewed();
  assert.equal(privacy.startDecision(), "start");
});

test("review acknowledgement does not survive a new app process", () => {
  const firstLaunch = new RecordingPrivacySession();
  firstLaunch.markReviewed();

  const nextLaunch = new RecordingPrivacySession();
  assert.equal(nextLaunch.startDecision(), "show-warning");
});
