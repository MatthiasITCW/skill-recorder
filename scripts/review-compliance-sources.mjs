#!/usr/bin/env node
/**
 * Reviewer tool that proposes SHA-256 values for `third_party/compliance-policy.json`.
 *
 * `npm run compliance:prepare` is deliberately fail-closed: it will only accept source
 * material whose hash is already recorded in the policy, so it can never be used to
 * bootstrap new hashes. This script performs that bootstrap step separately, under human
 * review, and never writes to the policy itself — it prints a patch for a reviewer to
 * inspect and apply.
 *
 * Usage:
 *   node scripts/review-compliance-sources.mjs [--platform win32|darwin|linux]
 *                                              [--versions <versions.json>]
 *                                              [--all]
 *
 * Defaults to the payload installed for the current platform. `--versions` allows a
 * reviewer to generate the hashes for another platform's manifest from one machine;
 * `--all` also re-derives material that already has a reviewed hash.
 */
import { execFile } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  buildNativeSourceSpecs,
  deterministicGitConfigArgs,
  hasExpectedFileHeader,
  nativePayloadCandidates,
  sha256File,
} from "./compliance.mjs";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviewDir = path.join(rootDir, ".compliance-review");

function parseArguments(argv) {
  const options = { platform: process.platform, versions: null, all: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--all") options.all = true;
    else if (argument === "--platform") options.platform = argv[(index += 1)];
    else if (argument === "--versions") options.versions = argv[(index += 1)];
    else throw new Error(`Unknown argument ${argument}.`);
  }
  if (!options.platform) throw new Error("--platform requires a value.");
  return options;
}

function loadVersions({ platform, versions }) {
  if (versions) return JSON.parse(readFileSync(path.resolve(versions), "utf8"));
  const candidates = Object.entries(nativePayloadCandidates)
    .filter(([target]) => target.startsWith(`${platform}-`))
    .flatMap(([, names]) => names);
  for (const name of candidates) {
    const file = path.join(rootDir, "node_modules", ...name.split("/"), "versions.json");
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  }
  throw new Error(
    `No installed native payload for ${platform}. Pass --versions <versions.json> to review ` +
      "a manifest captured on another platform.",
  );
}

async function download(url, target) {
  const temporary = `${target}.partial`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await rm(temporary, { force: true });
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          accept: "application/octet-stream, text/plain;q=0.9, */*;q=0.8",
          "user-agent":
            "Mozilla/5.0 (compatible; SkillRecorderCompliance/1.0; " +
            "+https://github.com/microsoft/skill-recorder)",
        },
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
      if (statSync(temporary).size < 100) throw new Error("response was unexpectedly short");
      await rename(temporary, target);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw new Error(`Failed to download ${url}: ${lastError?.message ?? "unknown error"}`);
}

async function runGit(args, cwd) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function gitArchive(spec, target) {
  const repository = path.join(reviewDir, "git", spec.id.replaceAll(/[^A-Za-z0-9._-]/g, "_"));
  await rm(repository, { recursive: true, force: true });
  await mkdir(repository, { recursive: true });
  await runGit(["init", "--quiet"], repository);
  await runGit(
    ["fetch", "--depth=1", "--no-tags", "--quiet", spec.gitRepository, spec.gitRevision],
    repository,
  );
  const resolved = await runGit(["rev-parse", "FETCH_HEAD"], repository);
  if (resolved !== spec.gitRevision) {
    throw new Error(`Fetched ${spec.id} revision ${resolved}; expected ${spec.gitRevision}.`);
  }
  await runGit(
    [
      ...deterministicGitConfigArgs,
      "archive",
      "--format=tar",
      `--prefix=${spec.archivePrefix}`,
      `--output=${target}`,
      "FETCH_HEAD",
    ],
    repository,
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const policy = JSON.parse(
    readFileSync(path.join(rootDir, "third_party", "compliance-policy.json"), "utf8"),
  );
  const versions = loadVersions(options);
  const specs = buildNativeSourceSpecs(versions, {
    platform: options.platform,
    sharpVersion: policy.sharp,
    sharpLibvipsVersion: policy.sharpLibvips.version,
    electronVersion: policy.electron.version,
    ffmpegRevision: policy.electron.ffmpegRevision,
    sourceCommits: policy.sourceCommits,
  });

  const pending = specs.filter(({ id }) => options.all || !policy.sourceMaterials?.[id]);
  if (pending.length === 0) {
    console.log("Every source material for this manifest already has a reviewed hash.");
    return;
  }

  await mkdir(path.join(reviewDir, "sources"), { recursive: true });
  const results = [];
  const failures = [];
  const queue = [...pending];
  const workers = Array.from({ length: 4 }, async () => {
    for (let spec = queue.shift(); spec; spec = queue.shift()) {
      const target = path.join(reviewDir, "sources", spec.fileName);
      try {
        await rm(target, { force: true });
        if (spec.gitRepository) await gitArchive(spec, target);
        else await download(spec.url, target);
        if (!(await hasExpectedFileHeader(spec.fileName, target))) {
          throw new Error("retrieved material is not a valid archive or patch");
        }
        results.push({ id: spec.id, url: spec.url, sha256: await sha256File(target) });
      } catch (error) {
        failures.push({ id: spec.id, url: spec.url, message: error.message });
      }
    }
  });
  await Promise.all(workers);

  results.sort((a, b) => a.id.localeCompare(b.id));
  failures.sort((a, b) => a.id.localeCompare(b.id));

  console.log(`\nReviewed source material for ${options.platform} (vips ${versions.vips}):\n`);
  for (const { id, url } of results) console.log(`  ${id}\n    ${url}`);
  console.log("\nProposed third_party/compliance-policy.json sourceMaterials entries:\n");
  console.log(
    results.map(({ id, sha256 }) => `    ${JSON.stringify(id)}: ${JSON.stringify(sha256)}`).join(",\n"),
  );

  if (failures.length > 0) {
    console.error("\nFailed to retrieve:");
    for (const { id, url, message } of failures) console.error(`  ${id} (${url}): ${message}`);
    process.exitCode = 1;
  }
}

await main();
