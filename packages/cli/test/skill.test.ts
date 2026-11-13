import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../../..", import.meta.url).pathname;
const skill = join(root, "skills", "ene");
const md = readFileSync(join(skill, "SKILL.md"), "utf8");
beforeAll(() => execFileSync("pnpm", ["exec", "tsc", "-b", "packages/cli"], { cwd: root }));

test("SKILL.md has name and description frontmatter", () => {
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
  expect(fm).toMatch(/^name: ene$/m);
  expect(fm.match(/^description: (.+)$/m)?.[1].length).toBeGreaterThan(80);
});

test("the example in SKILL.md checks clean and renders through the wrapper", () => {
  const src = md.match(/## Example\n\n```\n([\s\S]*?)```/)![1];
  const d = mkdtempSync(join(tmpdir(), "ene-skill-"));
  const f = join(d, "flow.ene");
  writeFileSync(f, src);
  const check = spawnSync("node", [join(skill, "ene.mjs"), "check", f, "--json"], { encoding: "utf8" });
  expect(check.status).toBe(0);
  expect(JSON.parse(check.stdout)).toEqual([]);
  const fmt = spawnSync("node", [join(skill, "ene.mjs"), "fmt", "--check", f], { encoding: "utf8" });
  expect(fmt.status).toBe(0);
  execFileSync("node", [join(skill, "ene.mjs"), f, "-o", join(d, "flow.svg"), "--choice", "1"]);
  expect(readFileSync(join(d, "flow.svg"), "utf8")).toContain("Cache hit / miss");
});

test("the wrapper passes the exit code and works through a symlinked skill directory", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-skill-"));
  const f = join(d, "bad.ene");
  writeFileSync(f, "a ->\n");
  symlinkSync(skill, join(d, "ene"), "dir");
  const r = spawnSync("node", [join(d, "ene", "ene.mjs"), "check", f, "--json"], { encoding: "utf8" });
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)[0].code).toBe("E103");
});

test("install-skill links the skill, is idempotent and refuses to replace a real directory", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-skill-"));
  const run = (dir: string) =>
    spawnSync("node", [join(root, "scripts", "install-skill.mjs"), dir], { encoding: "utf8" });
  expect(run(join(d, "skills")).status).toBe(0);
  const link = join(d, "skills", "ene");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(readlinkSync(link)).toBe(skill);
  expect(existsSync(join(link, "SKILL.md"))).toBe(true);
  expect(run(join(d, "skills")).stdout).toContain("already installed");
  execFileSync("mkdir", ["-p", join(d, "taken", "ene")]);
  expect(run(join(d, "taken")).status).toBe(1);
});
