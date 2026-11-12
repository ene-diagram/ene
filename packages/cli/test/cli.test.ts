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
