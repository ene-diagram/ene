import { parse } from "../src/parse";
import { buildTimeline, ASYNC_HANDOFF } from "../src/timeline";
import { formatSource } from "../src/fmt";

const codes = (src: string) => parse(src).diagnostics.map((d) => d.code);

test("opt is an optional branch: arm 0 = the steps, arm 1 = skip", () => {
  const { doc, diagnostics } = parse("a -> b\nopt cached\n  b --> a : hit\nend\na -> c");
  expect(diagnostics).toEqual([]);
  const st = doc.body[1];
  expect(st).toMatchObject({ type: "branch", optional: true });
  expect(st.type === "branch" && st.arms.map((a) => [a.label, a.body.length])).toEqual([["cached", 1], ["skip", 0]]);
  expect(buildTimeline(doc).steps).toHaveLength(3);
  const skipped = buildTimeline(doc, { choices: [1] });
  expect(skipped.steps.map((s) => s.edges[0].to)).toEqual(["b", "c"]);
  expect(skipped.branches).toEqual([{ label: "", arms: ["cached", "skip"], optional: true }]);
});

test("opt counts with branch for --choice, nests, and keeps loop/branch rules", () => {
  const { doc } = parse("branch x\n  a -> b\nelse y\n  a -> c\nend\nopt\n  loop 2\n    a -> d\n  end\nend");
  expect(buildTimeline(doc, { choices: [1, 0] }).steps.map((s) => s.edges[0].to)).toEqual(["c", "d", "d"]);
  expect(buildTimeline(doc, { choices: [1, 1] }).steps.map((s) => s.edges[0].to)).toEqual(["c"]);
});

test("opt errors: no steps (E201), else (E205), never closed (E203 names opt)", () => {
  expect(codes("a -> b\nopt x\nend")).toEqual(["E201"]);
  expect(codes("opt x\n  a -> b\nelse\n  a -> c\nend")).toEqual(["E205"]);
  const r = parse("opt x\n  a -> b");
  expect(r.diagnostics.map((d) => [d.code, d.args.block])).toEqual([["E203", "opt"]]);
  expect(codes("opt -> a")).toEqual(["E115"]);
});

test("~> is an async edge that needs spaces (E117)", () => {
  const { doc, diagnostics } = parse("api ~> queue : publish & api -> db");
  expect(diagnostics).toEqual([]);
  const st = doc.body[0];
  expect(st.type === "step" && st.edges.map((e) => e.kind)).toEqual(["async", "ok"]);
  expect(codes("a~> b")).toEqual(["E117"]);
  expect(codes("a ~>b")).toEqual(["E117"]);
  expect(codes("a ~>")).toEqual(["E103"]);
  expect(codes("~> b")).toEqual(["E104"]);
  expect(parse("a~>b").diagnostics[0].span).toEqual({ line: 1, col: 2, length: 2 });
  expect(codes("a -> b : x ~> y")).toEqual([]);
});

test("an async-only step does not block: the next step starts after a short hand-off", () => {
  const tl = buildTimeline(parse("speed 1\na ~> q : publish\na -> b : next\na ~> q : last").doc);
  expect(tl.steps.map((s) => s.start)).toEqual([0, ASYNC_HANDOFF, ASYNC_HANDOFF + 1]);
  expect(tl.steps[0].duration).toBe(1);
  // the last async edge still finishes before the end
  expect(tl.total).toBe(ASYNC_HANDOFF + 2);
  // mixed with a blocking edge, the step waits as usual
  expect(buildTimeline(parse("speed 1\na ~> q & a -> b\na -> c").doc).steps[1].start).toBe(1);
});

test("fmt handles opt and ~>", () => {
  expect(formatSource("opt   coupon #1\na~>b\nb  ~>   c:x\nend\n")).toBe("opt coupon #1\n  a~>b\n  b ~> c : x\nend\n");
});
