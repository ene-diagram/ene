import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const bin = new URL("../bin/ene.mjs", import.meta.url).pathname;
const ex = new URL("../../core/examples/03-cache.ene", import.meta.url).pathname;
beforeAll(() =>
  execFileSync("pnpm", ["exec", "tsc", "-b", "packages/cli"], { cwd: new URL("../../..", import.meta.url).pathname }),
);
test("renders example to svg", () => {
  const out = join(mkdtempSync(join(tmpdir(), "ene-")), "o.svg");
  execFileSync("node", [bin, ex, "-o", out, "--choice", "1"]);
  const svg = readFileSync(out, "utf8");
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg).toContain("Cache hit / miss");
});
test("default output path is input with .svg", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "x.ene");
  writeFileSync(f, "a -> b\nb --> a\na -> c");
  execFileSync("node", [bin, f]);
  expect(existsSync(join(d, "x.svg"))).toBe(true);
});
test("errors print korean diagnostics and exit 1", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "bad.ene");
  writeFileSync(f, "a ->\n");
  const r = spawnSync("node", [bin, f, "--lang", "ko"], { encoding: "utf8" });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("화살표 뒤에 대상 노드가 없어요");
  expect(existsSync(join(d, "bad.svg"))).toBe(false);
});
const runCli = (args: string[]) => spawnSync("node", [bin, ...args], { encoding: "utf8" });
test("missing file gives a clear error, exit 1", () => {
  const r = runCli(["/nope/x.ene"]);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("cannot read /nope/x.ene");
  expect(r.stderr).not.toContain("at ");
});
test.each([
  [["x.ene", "-o"]],
  [["x.ene", "--lang"]],
  [["x.ene", "--lang", "fr"]],
  [["x.ene", "--choice", "abc"]],
  [["x.ene", "--choice"]],
])("bad flags print usage and exit 2: %j", (args) => {
  const r = runCli(args as string[]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("usage:");
});
test("--choice all plays every path in one file; too many paths is an error", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "b.ene");
  const two = "branch a\n x -> y\nelse b\n x -> z\nend\n";
  writeFileSync(f, `${two}y -> z`);
  const r = runCli([f, "--choice", "all", "-o", "-"]);
  expect(r.status).toBe(0);
  expect(r.stderr).toContain("2 paths");
  expect(r.stdout).toContain("1/2 · a");
  expect(r.stdout).toContain("2/2 · b");
  // No branches: the same file as without the flag
  writeFileSync(f, "x -> y");
  expect(runCli([f, "--choice", "all", "-o", "-"]).stdout).toBe(runCli([f, "-o", "-"]).stdout);
  writeFileSync(f, `${two.repeat(5)}y -> z`);
  const many = runCli([f, "--choice", "all", "-o", "-"]);
  expect(many.status).toBe(1);
  expect(many.stderr).toContain("more than 16 paths");
  expect(many.stdout).toBe("");
});
test("out-of-range choice warns", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "b.ene");
  writeFileSync(f, "branch a\n x -> y\nelse b\n x -> z\nend\ny -> z");
  const r = runCli([f, "--choice", "9"]);
  expect(r.status).toBe(0);
  expect(r.stderr).toContain("choice 9");
});
const logos = new URL("../../../node_modules/@iconify-json/logos/icons.json", import.meta.url).pathname;
test("--icons embeds pack icons and warns on unknown", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "i.ene");
  writeFileSync(f, "fn[람다]{icon: logos:aws-lambda} -> db[디비]{icon: logos:aws-dynamoo}");
  const r = runCli([f, "--icons", logos, "--lang", "ko"]);
  expect(r.status).toBe(0);
  expect(r.stderr).toContain("W104");
  expect(r.stderr).toContain("logos:aws-dynamodb");
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
  writeFileSync(
    join(d, "Arch_AWS-Lambda_48.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M0 0"/></svg>',
  );
  writeFileSync(join(d, "Amazon Simple Storage Service.svg"), '<svg viewBox="0 0 64 64"><g/></svg>');
  const out = join(d, "aws.json");
  const r = runCli(["icons", d, "--prefix", "aws", "-o", out]);
  expect(r.status).toBe(0);
  const j = JSON.parse(readFileSync(out, "utf8"));
  expect(j.prefix).toBe("aws");
  expect(j.icons["aws-lambda"]).toEqual({ body: '<path d="M0 0"/>', width: 48, height: 48 });
  expect(Object.keys(j.icons)).toContain("amazon-simple-storage-service");
});
test("check --json prints machine-readable diagnostics and exits 1 on errors", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "c.ene");
  writeFileSync(f, "api -> cache : get\npin cahce 0,0");
  const r = runCli(["check", f, "--json"]);
  expect(r.status).toBe(1);
  const out = JSON.parse(r.stdout);
  expect(Array.isArray(out)).toBe(true);
  const e = out.find((x: { code: string }) => x.code === "E401");
  expect(e).toMatchObject({ severity: "error", line: 2, suggestion: "cache" });
  expect(Object.keys(e)).toEqual(
    expect.arrayContaining(["code", "severity", "line", "col", "length", "message", "hint"]),
  );
  expect(existsSync(join(d, "c.svg"))).toBe(false);
});
test("check on a clean file exits 0 and prints [] with --json", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "ok.ene");
  writeFileSync(f, "a -> b\nb --> a");
  const r = runCli(["check", f, "--json"]);
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toEqual([]);
  expect(runCli(["check", f]).stdout).toContain("no problems");
});

test.each(
  [null, [], {}, { prefix: "x", icons: null }, { prefix: "x", icons: { a: { body: 3 } } }].map((pack) => [pack]),
)("check rejects malformed icon packs without a stack trace: %j", (pack) => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "input.ene"),
    p = join(d, "pack.json");
  writeFileSync(f, "a{icon: x:a} -> b");
  writeFileSync(p, JSON.stringify(pack));
  const r = runCli(["check", f, "--json", "--icons", p]);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("invalid icon pack");
  expect(r.stderr).not.toContain("TypeError");
  expect(r.stderr).not.toContain("at checkCommand");
});
test("check accepts a valid icon pack", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "input.ene"),
    p = join(d, "pack.json");
  writeFileSync(f, "a{icon: x:a} -> b");
  writeFileSync(p, JSON.stringify({ prefix: "x", icons: { a: { body: "<path/>" } } }));
  const r = runCli(["check", f, "--json", "--icons", p]);
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toEqual([]);
});
test("--no-network skips remote icons with a clear warning", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "n.ene");
  writeFileSync(f, "a{icon: https://example.invalid/x.svg} -> b");
  const r = runCli([f, "--no-network"]);
  expect(r.status).toBe(0);
  expect(r.stderr).toContain("network access disabled");
});
test("local icon problems are reported with a reason", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "l.ene");
  writeFileSync(join(d, "big.svg"), `<svg>${"x".repeat(600 * 1024)}</svg>`);
  writeFileSync(join(d, "bad.svg"), "not svg");
  writeFileSync(f, "a{icon: ./big.svg} -> b{icon: ./bad.svg}\nb -> c{icon: ./missing.svg}");
  const r = runCli([f]);
  expect(r.status).toBe(0);
  expect(r.stderr).toContain("file too large");
  expect(r.stderr).toContain("not an SVG document");
  expect(r.stderr).toContain("ENOENT");
});
test("invalid icon pack is rejected with details", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "p.ene");
  const p = join(d, "pack.json");
  writeFileSync(f, "a -> b");
  writeFileSync(p, JSON.stringify({ prefix: "x", icons: { a: { body: 3 } } }));
  const r = runCli([f, "--icons", p]);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("invalid icon pack");
  expect(r.stderr).toContain("icons.a");
});
test("reads stdin with '-' and writes stdout by default", () => {
  const r = spawnSync("node", [bin, "-"], { input: "a -> b\nb --> a", encoding: "utf8" });
  expect(r.status).toBe(0);
  expect(r.stdout.startsWith("<svg")).toBe(true);
  expect(r.stderr).toContain("✅ stdout");
});
test("-o - writes the svg to stdout", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "s.ene");
  writeFileSync(f, "a -> b");
  const r = runCli([f, "-o", "-"]);
  expect(r.status).toBe(0);
  expect(r.stdout.startsWith("<svg")).toBe(true);
  expect(existsSync(join(d, "s.svg"))).toBe(false);
});
test("keyword without a value gets E307", () => {
  const r = spawnSync("node", [bin, "-"], { input: "a -> b\nloop\na -> b\nend\nwait", encoding: "utf8" });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("`loop` needs a value");
  expect(r.stderr).toContain("`wait` needs a value");
  expect(r.stderr).not.toContain('""');
});

test("fmt prints, --check exits 1 on unformatted files, --write fixes them", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "f.ene");
  writeFileSync(f, "a->b:hi\nbranch x\nb-->a\nend");
  expect(runCli(["fmt", f]).stdout).toBe("a -> b : hi\nbranch x\n  b --> a\nend\n");
  const c = runCli(["fmt", "--check", f]);
  expect(c.status).toBe(1);
  expect(c.stderr).toContain("not formatted");
  expect(runCli(["fmt", "--write", f]).status).toBe(0);
  expect(readFileSync(f, "utf8")).toBe("a -> b : hi\nbranch x\n  b --> a\nend\n");
  expect(runCli(["fmt", "--check", f]).status).toBe(0);
});
describe("from-mermaid", () => {
  const mmd =
    "sequenceDiagram\n  participant A as Alice\n  A->>+B: hello\n  alt ok\n    B-->>-A: hi\n  else down\n    B--xA: 503\n  end\n";
  test("prints .ene on stdout, warnings with file:line on stderr", () => {
    const d = mkdtempSync(join(tmpdir(), "ene-"));
    const f = join(d, "s.mmd");
    writeFileSync(f, mmd);
    const r = spawnSync("node", [bin, "from-mermaid", f], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      "diagram sequence\n\nA[Alice]\nB[B]\n\nA -> B : hello\nbranch ok\n  B --> A : hi\nelse down\n  B -x A : 503\nend\n",
    );
    expect(r.stderr).toContain(`warning: ${f}:3: activation bars are not drawn (and on 1 more line)`);
  });
  test("reads stdin and writes -o; the result checks clean", () => {
    const d = mkdtempSync(join(tmpdir(), "ene-"));
    const out = join(d, "s.ene");
    const r = spawnSync("node", [bin, "from-mermaid", "-", "-o", out], { input: mmd, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(spawnSync("node", [bin, "check", out, "--json"], { encoding: "utf8" }).stdout.trim()).toBe("[]");
  });
  test("exit 1 with a message for a diagram that cannot be converted; 2 on usage errors", () => {
    const d = mkdtempSync(join(tmpdir(), "ene-"));
    const f = join(d, "f.mmd");
    writeFileSync(f, 'pie\n "a": 1\n');
    const r = spawnSync("node", [bin, "from-mermaid", f], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("only `sequenceDiagram`, `flowchart` and `graph` can be converted");
    expect(spawnSync("node", [bin, "from-mermaid"], { encoding: "utf8" }).status).toBe(2);
    expect(spawnSync("node", [bin, "from-mermaid", join(d, "missing.mmd")], { encoding: "utf8" }).status).toBe(1);
  });
  test("a .mmd file renders directly, with --choice", () => {
    const d = mkdtempSync(join(tmpdir(), "ene-"));
    const f = join(d, "s.mmd");
    writeFileSync(f, mmd);
    const r = spawnSync("node", [bin, f, "--choice", "1"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const svg = readFileSync(join(d, "s.svg"), "utf8");
    expect(svg).toContain("503");
    expect(svg).toContain("Alice");
    writeFileSync(f, "flowchart LR\n a[Start]-->|go| b\n");
    const fc = spawnSync("node", [bin, f], { encoding: "utf8" });
    expect(fc.status).toBe(0);
    expect(fc.stderr).toContain("review the order");
    expect(readFileSync(join(d, "s.svg"), "utf8")).toContain("Start");
    writeFileSync(f, 'pie\n "a": 1\n');
    expect(spawnSync("node", [bin, f], { encoding: "utf8" }).status).toBe(1);
  });
});
test("--theme overrides the document theme; an unknown theme exits 2", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "t.ene");
  writeFileSync(f, "theme mono\na -> b");
  execFileSync("node", [bin, f]);
  expect(readFileSync(join(d, "t.svg"), "utf8")).toContain("ene-theme-mono");
  execFileSync("node", [bin, f, "--theme", "high-contrast"]);
  expect(readFileSync(join(d, "t.svg"), "utf8")).toContain("ene-theme-high-contrast");
  const r = runCli([f, "--theme", "neon"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain('unknown theme "neon"');
});
test("notes are captions in the SVG unless --no-notes", () => {
  const d = mkdtempSync(join(tmpdir(), "ene-"));
  const f = join(d, "n.ene");
  writeFileSync(f, "a -> b\nnote why this step\n");
  expect(runCli([f, "-o", "-"]).stdout).toContain('class="note"');
  expect(runCli([f, "-o", "-", "--no-notes"]).stdout).not.toContain('class="note"');
});
test("--version prints the package version", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  expect(execFileSync("node", [bin, "--version"], { encoding: "utf8" }).trim()).toBe(pkg.version);
});
