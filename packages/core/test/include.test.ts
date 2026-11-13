import path from "node:path";
import { describe, expect, test } from "vitest";
import { createIncluder, formatAll, diagnosticToJson, parse, type Includer } from "../src/index";

/** In-memory files, keyed by absolute path under /d */
const fs = (files: Record<string, string>, links: Record<string, string> = {}): Includer =>
  createIncluder({
    rootDir: "/d",
    path: path.posix,
    realPath: (p) => links[p] ?? p,
    readFile: (p) => {
      if (!(p in files)) throw Object.assign(new Error("no such file"), { code: "ENOENT" });
      return files[p];
    },
  });
const run = (src: string, files: Record<string, string>) => parse(src, { include: fs(files), file: "/d/main.ene" });
const codes = (r: ReturnType<typeof parse>) => r.diagnostics.map((d) => d.code);

const SYSTEM = `# shared
user[User]{shape: circle}
api[Order API]{icon: logos:nodejs}
db[Orders DB]{shape: db, color: #f59e0b}
cache[Redis]{shape: db}
group vpc[VPC] : api db cache
group data[Data] in vpc : db cache
pin db 3,1
rank api cache
theme mono
speed 2`;

describe("include", () => {
  test("declarations come from the file; only the nodes that are used are kept", () => {
    const r = run("include ./system.ene\nuser -> api : POST\napi -> db : INSERT", { "/d/system.ene": SYSTEM });
    expect(codes(r)).toEqual([]);
    expect([...r.doc.nodes.keys()]).toEqual(["user", "api", "db"]);
    expect(r.doc.nodes.get("db")).toMatchObject({ label: "Orders DB", shape: "db", color: "#f59e0b" });
    expect(r.doc.nodes.get("api")).toMatchObject({ label: "Order API", icon: "logos:nodejs" });
    // Groups keep the used members; the rank lost a node and is dropped; the pin stays
    expect(r.doc.groups.map((g) => [g.id, g.parent, g.members])).toEqual([
      ["vpc", undefined, ["api", "db"]],
      ["data", "vpc", ["db"]],
    ]);
    expect(r.doc.ranks).toEqual([]);
    expect(r.doc.pins.map((p) => [p.id, p.col, p.row])).toEqual([["db", 3, 1]]);
    expect(r.doc.theme).toBe("mono");
    expect(r.doc.speed).toBe(2);
  });

  test("the diagram's own settings, groups and pins win", () => {
    const r = run(
      "include ./system.ene\ntheme high-contrast\nspeed 0.5\nuser -> api\napi -> db\napi -> cache\ngroup mine[Mine] : api db\npin db 0,0",
      { "/d/system.ene": SYSTEM },
    );
    expect(codes(r)).toEqual([]);
    expect(r.doc.theme).toBe("high-contrast");
    expect(r.doc.speed).toBe(0.5);
    // api and db are in the diagram's own group, so the included groups only keep cache
    expect(r.doc.groups.map((g) => [g.id, g.members])).toEqual([
      ["mine", ["api", "db"]],
      ["vpc", ["cache"]],
      ["data", ["cache"]],
    ]);
    expect(r.doc.pins.map((p) => [p.id, p.col, p.row])).toEqual([["db", 0, 0]]);
    expect(r.doc.ranks.map((x) => x.ids)).toEqual([["api", "cache"]]);
  });

  test("a group or pin in the diagram can use an included node that has no edge", () => {
    const r = run("include ./system.ene\nuser -> api\ngroup g[G] : api cache\npin cache 2,0", {
      "/d/system.ene": SYSTEM,
    });
    expect(codes(r)).toEqual([]);
    expect([...r.doc.nodes.keys()]).toEqual(["user", "api", "cache"]);
    expect(r.doc.nodes.get("cache")?.label).toBe("Redis");
  });

  test("redeclaring an included node warns like a second declaration (W102 / W106)", () => {
    const r = run("include ./system.ene\nuser -> api[Other]\napi -> db{shape: queue}", { "/d/system.ene": SYSTEM });
    expect(codes(r)).toEqual(["W102", "W106"]);
    expect(r.doc.nodes.get("api")?.label).toBe("Order API");
  });

  test("an id from an included file is not reported as a typo of a similar id", () => {
    const lib = "orders[Orders]\norder[Order]";
    expect(codes(run("include ./l.ene\norders -> x\nx -> orders\nx -> order", { "/d/l.ene": lib }))).toEqual([]);
  });

  test("nested includes, relative to the including file; the first declaration wins", () => {
    const r = run("include ./a/one.ene\nx -> y\ny -> z", {
      "/d/a/one.ene": "include ../b/two.ene\nx[From one]\ny[Y one]",
      "/d/b/two.ene": "y[Y two]\nz[Z two]",
    });
    // one.ene gives y another label than the file it includes: the usual W102, reported in one.ene
    expect(r.diagnostics.map((d) => [d.code, d.file])).toEqual([["W102", "/d/a/one.ene"]]);
    expect([...r.doc.nodes.values()].map((n) => n.label)).toEqual(["From one", "Y two", "Z two"]);
  });

  test("two files grouping the same nodes: the first one wins, nested groups stay with their parent", () => {
    const r = run("include ./a.ene\ninclude ./b.ene\nx -> y\ny -> z", {
      "/d/a.ene": "x[X]\ny[Y]\nz[Z]\ngroup inner[Inner] in a : x\ngroup a[A] : x y",
      "/d/b.ene": "include ./a.ene\ngroup b[B] : x y z\ngroup deep[Deep] in b : x z",
    });
    expect(codes(r)).toEqual([]);
    // b only gets z (x and y are taken); deep is nested in b, so it only gets z too; inner follows its parent a
    expect(r.doc.groups.map((g) => [g.id, g.parent, g.members])).toEqual([
      ["inner", "a", ["x"]],
      ["a", undefined, ["x", "y"]],
      ["b", undefined, ["z"]],
      ["deep", "b", ["z"]],
    ]);
    // Every node is in exactly one chain of nested groups
    const top = r.doc.groups.filter((g) => !g.parent).flatMap((g) => g.members);
    expect(new Set(top).size).toBe(top.length);
  });
  test("sequence participants follow the diagram, not the included file", () => {
    const r = run("diagram sequence\ninclude ./system.ene\ndb -> api\napi -> user", { "/d/system.ene": SYSTEM });
    // groups, pin and rank from the file are simply unused here: no W111 for lines the author did not write
    expect(codes(r)).toEqual([]);
    expect([...r.doc.nodes.keys()]).toEqual(["db", "api", "user"]);
  });
});

describe("include errors", () => {
  test("E501 without a reader (the browser player)", () => {
    expect(parse("include ./x.ene\na -> b").diagnostics.map((d) => d.code)).toEqual(["E501"]);
  });
  test("E307 without a path", () => {
    expect(codes(run("include\na -> b", {}))).toEqual(["E307"]);
  });
  test("E502: missing file, absolute path, leaving the folder, the folder itself, too large", () => {
    const one = (p: string, files = {}) => run(`include ${p}\na -> b`, files).diagnostics[0];
    expect(one("./nope.ene")).toMatchObject({ code: "E502", args: { path: "./nope.ene", reason: "ENOENT" } });
    expect(one("/etc/passwd").args.reason).toBe("absolute paths are not allowed");
    expect(one("../secret.ene", { "/secret.ene": "a[A]" }).args.reason).toBe(
      "the file is outside the diagram's folder",
    );
    expect(one("a/../../d2/x.ene").args.reason).toBe("the file is outside the diagram's folder");
    expect(one(".").args.reason).toBe("the file is outside the diagram's folder");
    const big = parse("include ./big.ene\na -> b", {
      include: createIncluder({
        rootDir: "/d",
        path: path.posix,
        realPath: (p) => p,
        readFile: () => "a[A]\n".repeat(10),
        maxLength: 20,
      }),
    });
    expect(big.diagnostics[0].args.reason).toBe("the file is too large");
    // The span covers the path
    expect(one("./nope.ene").span).toEqual({ line: 1, col: 9, length: 10 });
  });
  test("a symbolic link inside the folder cannot lead out of it; a link that stays inside is fine", () => {
    const files = { "/secret/keys.ene": "a[Secret]", "/d/real.ene": "a[Real]" };
    const out = parse("include ./link.ene\na -> b", { include: fs(files, { "/d/link.ene": "/secret/keys.ene" }) });
    expect(out.diagnostics[0]).toMatchObject({
      code: "E502",
      args: { reason: "the file is outside the diagram's folder" },
    });
    expect(out.doc.nodes.get("a")?.label).toBe("a");
    const ok = parse("include ./link.ene\na -> b", { include: fs(files, { "/d/link.ene": "/d/real.ene" }) });
    expect(ok.diagnostics).toEqual([]);
    expect(ok.doc.nodes.get("a")?.label).toBe("Real");
    // The folder itself may be reached through a link
    const viaLink = parse("include ./real.ene\na -> b", {
      include: fs({ "/disk/d/real.ene": "a[Real]" }, { "/d": "/disk/d", "/d/real.ene": "/disk/d/real.ene" }),
    });
    expect(viaLink.diagnostics).toEqual([]);
  });
  test("a nested include cannot climb out through a subfolder", () => {
    const r = run("include ./sub/a.ene\na -> b", { "/d/sub/a.ene": "include ../../out.ene\na[A]", "/out.ene": "b[B]" });
    expect(r.diagnostics[0]).toMatchObject({ code: "E502", file: "/d/sub/a.ene" });
  });
  test("E504 after a node or step; settings before it are fine", () => {
    const files = { "/d/s.ene": "a[A]" };
    expect(codes(run("title T\ndiagram flow\ntheme mono\nspeed 1\ninclude ./s.ene\na -> b", files))).toEqual([]);
    expect(codes(run("a -> b\ninclude ./s.ene", files))).toEqual(["E504"]);
    expect(codes(run("a[A]\ninclude ./s.ene\na -> b", files))).toEqual(["E504"]);
  });
  test("E504 inside an included file too: its includes come before its declarations", () => {
    const r = run("include ./a.ene\nx -> y", { "/d/a.ene": "x[X]\ninclude ./b.ene", "/d/b.ene": "y[Y]" });
    expect(r.diagnostics.map((d) => [d.code, d.file, d.span.line])).toEqual([["E504", "/d/a.ene", 2]]);
    // theme / speed before the include are still fine there
    expect(
      codes(run("include ./a.ene\nx -> y", { "/d/a.ene": "theme mono\ninclude ./b.ene\nx[X]", "/d/b.ene": "y[Y]" })),
    ).toEqual([]);
  });
  test("E505: a file that includes itself, a loop through another file, the root, and too many levels", () => {
    expect(codes(run("include ./a.ene\nx -> y", { "/d/a.ene": "include ./a.ene\nx[X]" }))).toEqual(["E505"]);
    expect(
      codes(run("include ./a.ene\nx -> y", { "/d/a.ene": "include ./b.ene\nx[X]", "/d/b.ene": "include ./a.ene" })),
    ).toEqual(["E505"]);
    expect(
      codes(run("include ./a.ene\nx -> y", { "/d/a.ene": "include ./main.ene\nx[X]", "/d/main.ene": "" })),
    ).toEqual(["E505"]);
    const deep = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`/d/f${i}.ene`, `include ./f${i + 1}.ene\nn${i}[N]`]),
    );
    const r = run("include ./f0.ene\nn0 -> n1", deep);
    expect(codes(r)).toEqual(["E505"]);
    expect(r.diagnostics[0].file).toBe("/d/f7.ene");
  });
  test("E503: an included file with a step, a block, a title or a wait; declarations around it still count", () => {
    const lib = "a[A]\na -> b\nbranch x\ntitle T\nwait 1\nb[B]";
    const r = run("include ./l.ene\na -> b", { "/d/l.ene": lib });
    expect(r.diagnostics.map((d) => [d.code, d.span.line])).toEqual([
      ["E503", 2],
      ["E503", 3],
      ["E503", 4],
      ["E503", 5],
    ]);
    expect(r.doc.nodes.get("b")?.label).toBe("B");
  });
  test("problems inside an included file name the file, show its line, and point at the include line", () => {
    const src = "title T\ninclude ./l.ene\na -> b";
    const r = run(src, { "/d/l.ene": "a[A]\ngroup g[G] : a nope\nb{shape: hexagon}" });
    expect(r.diagnostics.map((d) => [d.code, d.file, d.span.line, d.at?.line])).toEqual([
      ["E110", "/d/l.ene", 3, 2],
      ["E401", "/d/l.ene", 2, 2],
    ]);
    const text = formatAll(src, r.diagnostics);
    expect(text).toContain("--> /d/l.ene, line 2, col 16");
    expect(text).toContain("2 | group g[G] : a nope");
    expect(text).not.toContain("2 | include ./l.ene");
    expect(diagnosticToJson(r.diagnostics[0]).file).toBe("/d/l.ene");
    expect(diagnosticToJson(parse("a ->").diagnostics[0]).file).toBeUndefined();
  });
  test("`include` is a keyword at the start of a line, and an id after an arrow", () => {
    expect(parse("include -> b").diagnostics.map((d) => d.code)).toEqual(["E115"]);
    expect(parse("a -> include").diagnostics).toEqual([]);
  });
});
