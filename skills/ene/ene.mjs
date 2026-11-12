#!/usr/bin/env node
// Runs the ene CLI for the Claude skill: the checkout this skill lives in (also through a symlink),
// otherwise an `ene` on PATH.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(realpathSync(fileURLToPath(import.meta.url))), "..", "..");
const bin = join(root, "packages", "cli", "bin", "ene.mjs");
const args = process.argv.slice(2);

let r;
if (existsSync(bin)) {
  if (!existsSync(join(root, "packages", "cli", "dist", "main.js"))) {
    console.error(`ene is not built yet. Run: (cd ${root} && pnpm install && pnpm build)`);
    process.exit(2);
  }
  r = spawnSync(process.execPath, [bin, ...args], { stdio: "inherit" });
} else {
  r = spawnSync("ene", args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.error) {
    console.error("ene CLI not found. Install this skill from an ene checkout (pnpm skill:install) or put `ene` on PATH.");
    process.exit(2);
  }
}
process.exit(r.status ?? 1);
