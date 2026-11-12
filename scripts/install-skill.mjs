// Links skills/ene into a Claude skills directory so Claude can draw ene diagrams.
//   node scripts/install-skill.mjs            → ~/.claude/skills/ene
//   node scripts/install-skill.mjs <dir>      → <dir>/ene   (e.g. a project's .claude/skills)
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../skills/ene", import.meta.url));
const dir = resolve(process.argv[2] ?? join(homedir(), ".claude", "skills"));
const target = join(dir, "ene");

const stat = lstatSync(target, { throwIfNoEntry: false });
if (stat?.isSymbolicLink()) {
  if (resolve(dir, readlinkSync(target)) === source) { console.log(`already installed: ${target}`); process.exit(0); }
  unlinkSync(target);
} else if (stat) {
  console.error(`${target} exists and is not a link. Remove it first.`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
symlinkSync(source, target, "dir");
console.log(`installed: ${target} -> ${source}`);
if (!existsSync(fileURLToPath(new URL("../packages/cli/dist/main.js", import.meta.url)))) console.log("next: pnpm build");
