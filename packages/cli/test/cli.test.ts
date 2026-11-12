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
  expect(svg.startsWith("<svg")).toBe(true); expect(svg).toContain("Cache hit / miss");
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
  writeFileSync(f, "branch a\n x -> y\nelse b\n x -> z\nend\ny -> z");
  const r = runCli([f, "--choice", "9"]); expect(r.status).toBe(0); expect(r.stderr).toContain("choice 9");
});
const logos = new URL("../../../node_modules/@iconify-json/logos/icons.json", import.meta.url).pathname;
test("--icons embeds pack icons and warns on unknown", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-")); const f = join(d, "i.ene");
  writeFileSync(f, "fn[람다]{icon: logos:aws-lambda} -> db[디비]{icon: logos:aws-dynamoo}");
  const r = runCli([f, "--icons", logos, "--lang", "ko"]);
  expect(r.status).toBe(0); expect(r.stderr).toContain("W104"); expect(r.stderr).toContain("logos:aws-dynamodb");
  expect(readFileSync(join(d, "i.svg"), "utf8")).toContain('viewBox="0 0 256 256"');
});
test("relative file icon is resolved next to the input", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  writeFileSync(join(d, "x.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>');
  writeFileSync(join(d, "i.ene"), "a{icon: ./x.svg} -> b");
  expect(runCli([join(d, "i.ene")]).status).toBe(0);
  expect(readFileSync(join(d, "i.svg"), "utf8")).toContain("data:image/svg+xml;base64,");
});
test("ene icons converts a folder of svgs to an iconify pack", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  writeFileSync(join(d, "Arch_AWS-Lambda_48.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M0 0"/></svg>');
  writeFileSync(join(d, "Amazon Simple Storage Service.svg"), '<svg viewBox="0 0 64 64"><g/></svg>');
  const out = join(d, "aws.json");
  const r = runCli(["icons", d, "--prefix", "aws", "-o", out]); expect(r.status).toBe(0);
  const j = JSON.parse(readFileSync(out, "utf8"));
  expect(j.prefix).toBe("aws");
  expect(j.icons["aws-lambda"]).toEqual({ body: '<path d="M0 0"/>', width: 48, height: 48 });
  expect(Object.keys(j.icons)).toContain("amazon-simple-storage-service");
});
test("check --json prints machine-readable diagnostics and exits 1 on errors", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-")); const f = join(d, "c.ene");
  writeFileSync(f, "api -> cache : get\npin cahce 0,0");
  const r = runCli(["check", f, "--json"]);
  expect(r.status).toBe(1);
  const out = JSON.parse(r.stdout);
  expect(Array.isArray(out)).toBe(true);
  const e = out.find((x: { code: string }) => x.code === "E401");
  expect(e).toMatchObject({ severity: "error", line: 2, suggestion: "cache" });
  expect(Object.keys(e)).toEqual(expect.arrayContaining(["code", "severity", "line", "col", "length", "message", "hint"]));
  expect(existsSync(join(d, "c.svg"))).toBe(false);
});
test("check on a clean file exits 0 and prints [] with --json", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-")); const f = join(d, "ok.ene");
  writeFileSync(f, "a -> b\nb --> a");
  const r = runCli(["check", f, "--json"]);
  expect(r.status).toBe(0); expect(JSON.parse(r.stdout)).toEqual([]);
  expect(runCli(["check", f]).stdout).toContain("no problems");
});

test.each([null, [], {}, { prefix: "x", icons: null }, { prefix: "x", icons: { a: { body: 3 } } }].map((pack) => [pack]))("check rejects malformed icon packs without a stack trace: %j", (pack) => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "input.ene"), p = join(d, "pack.json");
  writeFileSync(f, "a{icon: x:a} -> b"); writeFileSync(p, JSON.stringify(pack));
  const r = runCli(["check", f, "--json", "--icons", p]);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("invalid icon pack");
  expect(r.stderr).not.toContain("TypeError");
  expect(r.stderr).not.toContain("at checkCommand");
});
test("check accepts a valid icon pack", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "input.ene"), p = join(d, "pack.json");
  writeFileSync(f, "a{icon: x:a} -> b");
  writeFileSync(p, JSON.stringify({ prefix: "x", icons: { a: { body: "<path/>" } } }));
  const r = runCli(["check", f, "--json", "--icons", p]);
  expect(r.status).toBe(0); expect(JSON.parse(r.stdout)).toEqual([]);
});
