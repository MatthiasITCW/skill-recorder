import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isNarrationModelCachedAt,
  LEGACY_NARRATION_MODEL_ID,
  NARRATION_MODEL_FILES,
  NARRATION_MODEL_ID,
  removeLegacyNarrationModelCache,
} from "./whisper";

async function seedModel(cacheDir: string, modelId: string): Promise<string> {
  const modelDir = path.join(cacheDir, ...modelId.split("/"));
  for (const relativeFile of NARRATION_MODEL_FILES) {
    const file = path.join(modelDir, relativeFile);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "");
  }
  return modelDir;
}

test("cache detection selects the multilingual model rather than the legacy English model", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-recorder-models-"));
  try {
    assert.equal(NARRATION_MODEL_ID, "Xenova/whisper-small");
    await seedModel(root, LEGACY_NARRATION_MODEL_ID);
    assert.equal(isNarrationModelCachedAt(root), false);

    await seedModel(root, NARRATION_MODEL_ID);
    assert.equal(isNarrationModelCachedAt(root), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy model cleanup retains the multilingual cache", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-recorder-models-"));
  try {
    const legacyDir = await seedModel(root, LEGACY_NARRATION_MODEL_ID);
    await seedModel(root, NARRATION_MODEL_ID);

    await removeLegacyNarrationModelCache(root);

    assert.equal(isNarrationModelCachedAt(root), true);
    await assert.rejects(access(legacyDir), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
