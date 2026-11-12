import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const bin = new URL("../bin/ene.mjs", import.meta.url).pathname;
const ex = new URL("../../core/examples/03-cache.ene", import.meta.url).pathname;
beforeAll(() => execFileSync("pnpm", ["exec", "tsc", "-b", "packages/cli"], { cwd: new URL("../../..", import.meta.url).pathname }));
test("renders example to svg", () => {
  const out = join(mkdtempSync(join(tmpdir(), "ene-")), "o.svg");
  execFileSync("node", [bin, ex, "-o", out, "--choice", "1"]);
  const svg = readFileSync(out, "utf8");
  expect(svg.startsWith("<svg")).toBe(true); expect(svg).toContain("캐시 hit / miss");
});
test("default output path is input with .svg", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-")); const f = join(d, "x.ene");
  writeFileSync(f, "a -> b\nb --> a\na -> c");
  execFileSync("node", [bin, f]); expect(existsSync(join(d, "x.svg"))).toBe(true);
});
test("errors print korean diagnostics and exit 1", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-")); const f = join(d, "bad.ene");
  writeFileSync(f, "a ->\n");
  const r = spawnSync("node", [bin, f, "--lang", "ko"], { encoding: "utf8" });
  expect(r.status).toBe(1); expect(r.stderr).toContain("화살표 뒤에 대상 노드가 없어요");
  expect(existsSync(join(d, "bad.svg"))).toBe(false);
});
const runCli = (args: string[]) => spawnSync("node", [bin, ...args], { encoding: "utf8" });
test("missing file gives a clear error, exit 1", () => {
  const r = runCli(["/nope/x.ene"]); expect(r.status).toBe(1);
  expect(r.stderr).toContain("cannot read /nope/x.ene"); expect(r.stderr).not.toContain("at ");
});
test.each([[["x.ene", "-o"]], [["x.ene", "--lang"]], [["x.ene", "--lang", "fr"]], [["x.ene", "--choice", "abc"]], [["x.ene", "--choice"]]])(
  "bad flags print usage and exit 2: %j", (args) => {
    const r = runCli(args as string[]); expect(r.status).toBe(2); expect(r.stderr).toContain("usage:");
  });
test("out-of-range choice warns", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-")); const f = join(d, "b.ene");
  writeFileSync(f, "branch a\n x -> y\nbranch b\n x -> z\nend\ny -> z");
  const r = runCli([f, "--choice", "9"]); expect(r.status).toBe(0); expect(r.stderr).toContain("choice 9");
});
