import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain .mjs without types
import { annotation, globBase, globToRegExp, list, main, plan, validVersion } from "../run.mjs";

const CLI = resolve(__dirname, "../../packages/cli/bin/ene.mjs");
const FIXTURES = resolve(__dirname, "fixtures");

describe("helpers", () => {
  it("matches globs", () => {
    const re = globToRegExp("docs/**/*.ene");
    expect(re.test("docs/a.ene")).toBe(true);
    expect(re.test("docs/x/y/a.ene")).toBe(true);
    expect(re.test("src/a.ene")).toBe(false);
    expect(globToRegExp("*.{ene,mmd}").test("a.mmd")).toBe(true);
    expect(globToRegExp("*.ene").test("x/a.ene")).toBe(false);
    expect(globToRegExp("**/*.ene").test("a.ene")).toBe(true);
    expect(globToRegExp("a.(b).ene").test("a.(b).ene")).toBe(true);
  });
  it("plans output paths", () => {
    const files = ["docs/d/a.ene", "docs/b.ene", "README.md", "x.ene"];
    expect(plan(files, ["docs/**/*.ene"], "")).toEqual([{ src: "docs/b.ene", out: "docs/b.svg" }, { src: "docs/d/a.ene", out: "docs/d/a.svg" }]);
    expect(plan(files, ["docs/**/*.ene"], "img")).toEqual([{ src: "docs/b.ene", out: "img/b.svg" }, { src: "docs/d/a.ene", out: "img/d/a.svg" }]);
    expect(plan(files, ["**/*.ene", "x.ene"], "").map((j: { src: string }) => j.src)).toEqual(["docs/b.ene", "docs/d/a.ene", "x.ene"]);
    expect(globBase("./a/b/*.ene".slice(2))).toBe("a/b");
  });
  it("escapes annotations", () => {
    expect(annotation("a,b:c.ene", { severity: "error", code: "E1", line: 2, col: 3, message: "bad\nthing %", hint: "" }))
      .toBe("::error file=a%2Cb%3Ac.ene,line=2,col=3,title=ene E1::bad%0Athing %25");
    expect(annotation("a.ene", { severity: "warning", code: "W1", line: "x", col: 1, message: "m", hint: "h" })).toBe("::warning file=a.ene,line=1,col=1,title=ene W1::m (h)");
  });
  it("validates versions and lists", () => {
    for (const v of ["0.1", "0.1.0", "^0.1.0", "latest", ">=0.1 <0.2"]) expect(validVersion(v)).toBe(true);
    for (const v of ["0.1; rm -rf /", "$(id)", "--registry=x", "a`b`", "0.1\nx"]) expect(validVersion(v)).toBe(false);
    expect(list(" a, b\n\nc ")).toEqual(["a", "b", "c"]);
    expect(list("docs/{flow,seq}/*.ene, x.ene")).toEqual(["docs/{flow,seq}/*.ene", "x.ene"]);
  });
  it("rejects two sources mapped to one SVG", () => {
    expect(() => plan(["docs/a.ene", "ex/a.ene"], ["docs/*.ene", "ex/*.ene"], "out")).toThrow(/both be written to out\/a.svg/);
  });
});

describe("validVersion", () => {
  it("allows ranges on POSIX but only plain versions and tags on Windows", () => {
    expect(validVersion("^0.1 || >=1", "linux")).toBe(true);
    expect(validVersion("0.1.0", "win32")).toBe(true);
    expect(validVersion("latest", "win32")).toBe(true);
    for (const bad of ["latest|whoami", ">=0.1", "^0.1", "0.1 1.0", "a&b"]) expect(validVersion(bad, "win32")).toBe(false);
    expect(validVersion("-x", "linux")).toBe(false);
  });
});

describe("main", () => {
  let dir: string, cwd: string, log: string[];
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const run = (env: Record<string, string>) => main({ ENE_CLI_PATH: CLI, ENE_FILES: "diagrams/*.ene", ...env });
  beforeEach(() => {
    cwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), "ene-action-"));
    execFileSync("git", ["init", "-q", "--bare", join(root, "remote.git")]);
    dir = join(root, "work");
    mkdirSync(dir);
    git("init", "-q", "-b", "main");
    git("remote", "add", "origin", join(root, "remote.git"));
    cpSync(FIXTURES, join(dir, "diagrams"), { recursive: true });
    // The committed fixture SVGs match the published CLI the CI workflow uses; render them with this
    // checkout's CLI so the test compares like with like after renderer changes.
    for (const f of readdirSync(join(dir, "diagrams")).filter((n) => n.endsWith(".ene"))) {
      execFileSync("node", [CLI, join(dir, "diagrams", f), "--no-network"]);
    }
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    git("push", "-q", "-u", "origin", "main");
    process.chdir(dir);
    log = [];
    vi.spyOn(console, "log").mockImplementation((m: string) => void log.push(String(m)));
  });
  afterEach(() => { process.chdir(cwd); vi.restoreAllMocks(); });

  it("check passes when SVGs are current", () => {
    expect(run({})).toBe(0);
    expect(log.join("\n")).toContain("up to date");
  });
  it("check fails on a stale SVG and does not write it", () => {
    const before = readFileSync("diagrams/flow.svg", "utf8");
    writeFileSync("diagrams/flow.ene", readFileSync("diagrams/flow.ene", "utf8") + "api -> db : read\n");
    expect(run({})).toBe(1);
    expect(log.join("\n")).toMatch(/::error file=diagrams\/flow.svg,title=ene::diagrams\/flow.svg is stale/);
    expect(readFileSync("diagrams/flow.svg", "utf8")).toBe(before);
  });
  it("check reports diagnostics as annotations", () => {
    writeFileSync("diagrams/bad.ene", "a -> b\nbad ->\n");
    expect(run({})).toBe(1);
    expect(log.join("\n")).toContain("::error file=diagrams/bad.ene,line=2,col=5,title=ene E103::");
  });
  it("check reports unformatted files", () => {
    writeFileSync("diagrams/flow.ene", readFileSync("diagrams/flow.ene", "utf8").replace("user -> api", "user   ->   api"));
    expect(run({ ENE_FMT_CHECK: "true" })).toBe(1);
    expect(log.join("\n")).toContain("title=ene fmt::not formatted");
  });
  it("commit mode writes, commits and pushes changed SVGs", () => {
    writeFileSync("diagrams/new.ene", "a -> b : hi\n");
    git("add", "diagrams/new.ene");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "add");
    expect(run({ ENE_MODE: "commit", ENE_OUTPUT_DIR: "out" })).toBe(0);
    expect(existsSync("out/new.svg")).toBe(true);
    expect(git("log", "-1", "--format=%s%n%an")).toBe("chore: regenerate ene diagrams\ngithub-actions[bot]\n");
    expect(git("ls-remote", "origin", "main").split("\t")[0]).toBe(git("rev-parse", "HEAD").trim());
    expect(git("status", "--porcelain")).toBe("");
  });
  it("rejects bad inputs", () => {
    expect(run({ ENE_MODE: "push" })).toBe(1);
    expect(run({ ENE_CHOICE: "1;id" })).toBe(1);
    expect(run({ ENE_CHOICE: "all;id" })).toBe(1);
    expect(run({ ENE_OUTPUT_DIR: "../x" })).toBe(1);
    expect(() => main({ ENE_FILES: "diagrams/*.ene", ENE_VERSION: "0.1 && id" })).toThrow(/invalid version/);
  });
  it("commit mode refuses a detached checkout (a PR's merge commit) without writing anything", () => {
    git("checkout", "-q", "--detach");
    writeFileSync("diagrams/flow.ene", readFileSync("diagrams/flow.ene", "utf8") + "api -> db : read\n");
    const before = readFileSync("diagrams/flow.svg", "utf8");
    expect(run({ ENE_MODE: "commit", GITHUB_HEAD_REF: "feature-x" })).toBe(1);
    expect(log.join("\n")).toContain("HEAD is detached");
    expect(readFileSync("diagrams/flow.svg", "utf8")).toBe(before);
    expect(git("ls-remote", "origin", "refs/heads/feature-x")).toBe("");
  });
});
