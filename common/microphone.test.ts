import assert from "node:assert/strict";
import test from "node:test";

import {
  SYSTEM_DEFAULT_MICROPHONE,
  resolveMicrophonePreference,
  type MicrophoneDevice,
} from "./microphone";

const devices: MicrophoneDevice[] = [
  SYSTEM_DEFAULT_MICROPHONE,
  { id: "built-in", label: "MacBook Microphone", groupId: "internal" },
  { id: "usb-new", label: "Desk Mic", groupId: "usb-group" },
];

test("microphone preference resolves exact and changed device ids", () => {
  const exact = resolveMicrophonePreference(
    { id: "built-in", label: "MacBook Microphone", groupId: "internal" },
    devices,
  );
  assert.equal(exact.device.id, "built-in");
  assert.equal(exact.unavailable, false);
  assert.equal(exact.changed, false);

  const replugged = resolveMicrophonePreference(
    { id: "usb-old", label: "Desk Mic", groupId: "usb-group" },
    devices,
  );
  assert.equal(replugged.device.id, "usb-new");
  assert.equal(replugged.preference.id, "usb-new");
  assert.equal(replugged.unavailable, false);
  assert.equal(replugged.changed, true);
});

test("missing microphone visibly falls back without forgetting the preference", () => {
  const preference = { id: "missing", label: "Travel Headset", groupId: "headset" };
  const resolved = resolveMicrophonePreference(preference, devices);

  assert.deepEqual(resolved.device, SYSTEM_DEFAULT_MICROPHONE);
  assert.deepEqual(resolved.preference, preference);
  assert.equal(resolved.unavailable, true);
  assert.equal(resolved.changed, false);
});
