import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FULL_CAPTURE } from "../../common/config";
import { RecorderController, type SessionAudioRecorder } from "./controller";

class FakeAudioRecorder implements SessionAudioRecorder {
  readonly calls: string[] = [];
  finishVideoStartEpoch: number | null | undefined;
  failEnable = false;

  async start(): Promise<void> {
    this.calls.push("start");
  }

  async enable(): Promise<void> {
    this.calls.push("enable");
    if (this.failEnable) throw new Error("Microphone permission denied.");
  }

  async disable(): Promise<void> {
    this.calls.push("disable");
  }

  async finish(videoStartEpoch: number | null): Promise<void> {
    this.calls.push("finish");
    this.finishVideoStartEpoch = videoStartEpoch;
  }
}

test("microphone toggles are serialized and finalized on save", async () => {
  await withSessionsRoot(async () => {
    const audio = new FakeAudioRecorder();
    let processed = 0;
    const controller = new RecorderController({
      resolveConfig: () => ({ ...FULL_CAPTURE }),
      buildCollectors: () => [],
      createVideoRecorder: () => ({
        start: async () => undefined,
        stop: async () => ({ startEpoch: 1_234 }),
      }),
      createAudioRecorder: () => audio,
      deleteSession: async () => undefined,
      postProcess: async () => {
        processed++;
      },
    });

    const started = await controller.start();
    assert.equal(started.ok, true);
    assert.equal(controller.status().microphone.state, "off");

    assert.equal((await controller.setMicrophoneEnabled(true)).ok, true);
    assert.equal(controller.status().microphone.state, "on");
    assert.equal((await controller.setMicrophoneEnabled(false)).ok, true);
    assert.equal((await controller.setMicrophoneEnabled(true)).ok, true);

    const stopped = await controller.stop();
    assert.equal(stopped.ok, true);
    assert.equal(controller.status().state, "idle");
    assert.equal(controller.status().transition, "none");
    assert.equal(controller.status().lastSession?.id, started.sessionId);
    assert.deepEqual(controller.status().lastFinish, {
      sessionId: started.sessionId,
      outcome: "saved",
    });
    assert.deepEqual(audio.calls, [
      "start",
      "enable",
      "disable",
      "enable",
      "disable",
      "finish",
    ]);
    assert.equal(audio.finishVideoStartEpoch, 1_234);

    await controller.whenProcessed();
    assert.equal(processed, 1);
  });
});

test("discard removes the active session and skips post-processing", async () => {
  await withSessionsRoot(async (root) => {
    const audio = new FakeAudioRecorder();
    let processed = 0;
    const controller = new RecorderController({
      resolveConfig: () => ({ ...FULL_CAPTURE, video: false }),
      buildCollectors: () => [],
      createAudioRecorder: () => audio,
      deleteSession: async (id) => rm(path.join(root, id), { recursive: true }),
      postProcess: async () => {
        processed++;
      },
    });

    const started = await controller.start({ narration: true });
    assert.equal(started.ok, true);
    const id = started.sessionId;
    assert.ok(id);
    assert.equal(controller.status().microphone.state, "on");

    const discarded = await controller.discard();
    assert.equal(discarded.ok, true);
    assert.equal(discarded.sessionId, id);
    assert.equal(controller.status().state, "idle");
    assert.equal(controller.status().lastSession, null);
    assert.deepEqual(controller.status().lastFinish, {
      sessionId: id,
      outcome: "discarded",
    });
    assert.equal(processed, 0);
    await assert.rejects(access(path.join(root, id)), { code: "ENOENT" });
    assert.deepEqual(audio.calls, ["start", "enable", "disable", "finish"]);
  });
});

test("failed discard retains and post-processes the finalized session", async () => {
  await withSessionsRoot(async () => {
    let processed = 0;
    let releaseProcessing: () => void = () => undefined;
    const processingGate = new Promise<void>((resolve) => {
      releaseProcessing = resolve;
    });
    const controller = new RecorderController({
      resolveConfig: () => ({ ...FULL_CAPTURE, video: false }),
      buildCollectors: () => [],
      deleteSession: async () => {
        throw new Error("Access denied.");
      },
      postProcess: async () => {
        processed++;
        await processingGate;
      },
    });

    const started = await controller.start();
    assert.equal(started.ok, true);

    const discarded = await controller.discard();
    assert.equal(discarded.ok, false);
    assert.match(discarded.error ?? "", /could not be discarded.*access denied/i);
    assert.deepEqual(controller.status().lastFinish, {
      sessionId: started.sessionId,
      outcome: "saved",
    });
    assert.deepEqual(controller.status().lastSession, {
      id: started.sessionId,
      processed: false,
    });

    assert.equal(processed, 1);
    const drained = controller.whenProcessed();
    releaseProcessing();
    await drained;
    assert.deepEqual(controller.status().lastSession, {
      id: started.sessionId,
      processed: true,
    });
  });
});

test("unexpected microphone termination updates live status without ending video capture", async () => {
  await withSessionsRoot(async () => {
    const audio = new FakeAudioRecorder();
    let notifyEnded: (event: { error: string | null }) => void = () => {
      throw new Error("Microphone callback was not registered.");
    };
    const controller = new RecorderController({
      resolveConfig: () => ({ ...FULL_CAPTURE, video: false }),
      buildCollectors: () => [],
      createAudioRecorder: (notify) => {
        notifyEnded = notify;
        return audio;
      },
      deleteSession: async () => undefined,
    });

    assert.equal((await controller.start()).ok, true);
    assert.equal((await controller.setMicrophoneEnabled(true)).ok, true);
    notifyEnded({ error: "The microphone disconnected." });
    assert.equal(controller.status().state, "recording");
    assert.deepEqual(controller.status().microphone, {
      state: "error",
      error: "The microphone disconnected.",
    });
    assert.equal((await controller.stop()).ok, true);
  });
});

test("shutdown rejects queued and future recording starts", async () => {
  await withSessionsRoot(async () => {
    const controller = new RecorderController({
      resolveConfig: () => ({ ...FULL_CAPTURE, video: false }),
      buildCollectors: () => [],
      deleteSession: async () => undefined,
    });

    controller.beginShutdown();
    const result = await controller.start();
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /shutting down/i);
    assert.equal(controller.status().state, "idle");
  });
});

test("discard outcome is not confused with an earlier saved session", async () => {
  await withSessionsRoot(async (root) => {
    const controller = new RecorderController({
      resolveConfig: () => ({ ...FULL_CAPTURE, video: false }),
      buildCollectors: () => [],
      deleteSession: async (id) => rm(path.join(root, id), { recursive: true }),
    });

    const saved = await controller.start();
    assert.equal(saved.ok, true);
    assert.equal((await controller.stop()).ok, true);

    const discarded = await controller.start();
    assert.equal(discarded.ok, true);
    assert.equal((await controller.discard()).ok, true);
    assert.equal(controller.status().lastSession?.id, saved.sessionId);
    assert.deepEqual(controller.status().lastFinish, {
      sessionId: discarded.sessionId,
      outcome: "discarded",
    });
  });
});

test("microphone failure is surfaced without stopping screen capture", async () => {
  await withSessionsRoot(async () => {
    const audio = new FakeAudioRecorder();
    audio.failEnable = true;
    const controller = new RecorderController({
      resolveConfig: () => ({ ...FULL_CAPTURE, video: false }),
      buildCollectors: () => [],
      createAudioRecorder: () => audio,
      deleteSession: async () => undefined,
    });

    assert.equal((await controller.start()).ok, true);
    const result = await controller.setMicrophoneEnabled(true);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /permission denied/i);
    assert.equal(controller.status().state, "recording");
    assert.equal(controller.status().microphone.state, "error");
    assert.equal((await controller.stop()).ok, true);
  });
});

test("stop waits behind an in-flight microphone enable", async () => {
  await withSessionsRoot(async () => {
    let releaseEnable: () => void = () => undefined;
    const enableGate = new Promise<void>((resolve) => {
      releaseEnable = resolve;
    });
    const calls: string[] = [];
    const audio: SessionAudioRecorder = {
      start: async () => {
        calls.push("start");
      },
      enable: async () => {
        calls.push("enable:start");
        await enableGate;
        calls.push("enable:end");
      },
      disable: async () => {
        calls.push("disable");
      },
      finish: async () => {
        calls.push("finish");
      },
    };
    const controller = new RecorderController({
      resolveConfig: () => ({ ...FULL_CAPTURE, video: false }),
      buildCollectors: () => [],
      createAudioRecorder: () => audio,
      deleteSession: async () => undefined,
    });

    assert.equal((await controller.start()).ok, true);
    const enabling = controller.setMicrophoneEnabled(true);
    const stopping = controller.stop();
    await Promise.resolve();
    assert.deepEqual(calls, ["start", "enable:start"]);

    releaseEnable();
    assert.equal((await enabling).ok, true);
    assert.equal((await stopping).ok, true);
    assert.deepEqual(calls, ["start", "enable:start", "enable:end", "disable", "finish"]);
  });
});

async function withSessionsRoot(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "skill-recorder-controller-"));
  const previousRoot = process.env.SKILL_RECORDER_SESSIONS_DIR;
  process.env.SKILL_RECORDER_SESSIONS_DIR = root;
  try {
    await run(root);
  } finally {
    if (previousRoot === undefined) delete process.env.SKILL_RECORDER_SESSIONS_DIR;
    else process.env.SKILL_RECORDER_SESSIONS_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
}
