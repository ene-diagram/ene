import { expect, test } from "vitest";
import { CODES, KEYWORDS, LIMITS, MESSAGES, buildTimeline, parse } from "../src/index.js";

const codes = (s: string) => parse(s).diagnostics.map((d) => d.code);

test("#29 non-finite speed / wait / duration are rejected", () => {
  expect(codes("speed Infinity\na -> b")).toContain("E304");
  expect(codes("wait Infinity\na -> b")).toContain("E301");
  expect(codes("wait 1e400\na -> b")).toContain("E301");
  expect(codes(`a -> b @${"9".repeat(400)}s`)).toContain("E303");
});

test("#29 loop count must be a safe integer", () => {
  expect(codes("loop 1e20\na -> b\nend")).toContain("E302");
  expect(codes("loop 3\na -> b\nend")).toEqual([]);
});

test("#29 expanded steps are bounded without expanding", () => {
  const nested = "loop 1000\nloop 1000\nloop 1000\na -> b\nend\nend\nend";
  expect(codes(nested)).toEqual(["E305"]);
  expect(codes(`loop ${LIMITS.steps}\na -> b\nend`)).toEqual([]);
  expect(codes(`loop ${LIMITS.steps + 1}\na -> b\nend`)).toEqual(["E305"]);
});

test("#29 total duration is bounded, branch takes the worst arm", () => {
  expect(codes(`wait ${LIMITS.seconds}\na -> b`)).toEqual(["E306"]);
  expect(codes("a -> b\nbranch x\nwait 100000\na -> b\nelse y\na -> b\nend")).toEqual(["E306"]);
  expect(buildTimeline(parse("wait 10\na -> b").doc).total).toBeCloseTo(11.2);
});

test("#29 nesting depth is bounded", () => {
  const d = LIMITS.depth + 1;
  const src = "loop 1\n".repeat(d) + "a -> b\n" + "end\n".repeat(d);
  expect(codes(src)).toContain("E206");
  const ok = "loop 1\n".repeat(LIMITS.depth) + "a -> b\n" + "end\n".repeat(LIMITS.depth);
  expect(codes(ok)).toEqual([]);
});

test("#8 group parent cycles report E407", () => {
  const r = parse("a -> b\ngroup x in y : a\ngroup y in x : a");
  expect(r.diagnostics.map((d) => [d.code, d.args.name]).sort()).toEqual([
    ["E407", "x"],
    ["E407", "y"],
  ]);
  expect(codes("a -> b\ngroup x in x : a")).toEqual(["E407"]);
});

test("#9 hints list every keyword and attribute", () => {
  for (const lang of ["en", "ko"] as const) {
    for (const k of KEYWORDS) expect(MESSAGES[lang].E102.hint).toContain(k);
    for (const k of ["icon", "shape", "color"]) expect(MESSAGES[lang].E108.hint).toContain(k);
  }
  for (const c of CODES) {
    expect(MESSAGES.en[c]).toBeTruthy();
    expect(MESSAGES.ko[c]).toBeTruthy();
  }
});

test("#10 color must be a CSS name or hex", () => {
  expect(parse("a{color: notacolor} -> b").diagnostics[0]).toMatchObject({ code: "E111" });
  expect(parse("a{color: orang} -> b").diagnostics[0]).toMatchObject({ code: "E111", args: { suggestion: "orange" } });
  for (const c of ["orange", "RebeccaPurple", "#f59e0b", "#abc", "currentColor"])
    expect(codes(`a{color: ${c}} -> b`)).toEqual([]);
});
