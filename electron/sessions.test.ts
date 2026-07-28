import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { deleteSession, listSessions } from "./sessions";

test("session size includes every artifact and deletion removes the whole directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-recorder-sessions-"));
  const previousRoot = process.env.SKILL_RECORDER_SESSIONS_DIR;
  process.env.SKILL_RECORDER_SESSIONS_DIR = root;

  try {
    const id = "storage-test";
    const dir = path.join(root, id);
    await mkdir(path.join(dir, "video-frames"), { recursive: true });
    await mkdir(path.join(dir, "frames"), { recursive: true });
    await mkdir(path.join(dir, "audio"), { recursive: true });

    const artifacts: [string, string | Uint8Array][] = [
      ["session.json", JSON.stringify({ id, startedAt: 1_000, stoppedAt: 2_000 })],
      ["video.webm", Buffer.alloc(17, 1)],
      [
        "audio.json",
        JSON.stringify({
          version: 2,
          segments: [{ file: "audio/segment-0001.webm" }, { file: "audio/segment-0002.webm" }],
        }),
      ],
      [path.join("audio", "segment-0001.webm"), Buffer.alloc(19, 2)],
      [path.join("audio", "segment-0002.webm"), Buffer.alloc(13, 2)],
      [path.join("video-frames", "frame_000001.jpg"), Buffer.alloc(23, 3)],
      [path.join("frames", "event_1000.jpg"), Buffer.alloc(29, 4)],
    ];
    for (const [file, data] of artifacts) await writeFile(path.join(dir, file), data);

    const [summary] = await listSessions();
    const expectedBytes = artifacts.reduce(
      (sum, [, data]) => sum + (typeof data === "string" ? Buffer.byteLength(data) : data.byteLength),
      0,
    );
    assert.equal(summary?.sizeBytes, expectedBytes);
    assert.equal(summary?.hasAudio, true);
    assert.equal(summary?.narrationLanguage, "en");

    await deleteSession(id);
    await assert.rejects(access(dir), { code: "ENOENT" });
  } finally {
    if (previousRoot === undefined) delete process.env.SKILL_RECORDER_SESSIONS_DIR;
    else process.env.SKILL_RECORDER_SESSIONS_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});
