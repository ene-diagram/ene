import { parse } from "../src/parse";
import { buildTimeline } from "../src/timeline";
import { formatSource } from "../src/fmt";

const codes = (src: string) => parse(src).diagnostics.map((d) => d.code);

test("note attaches to the previous step and reaches the timeline", () => {
  const { doc, diagnostics } = parse("api -> cache : GET product:42\nnote Cache is checked first; TTL is 60s.\ncache --> api : hit");
  expect(diagnostics).toEqual([]);
  expect(doc.body[0]).toMatchObject({ type: "step", note: "Cache is checked first; TTL is 60s." });
  expect(doc.body[1]).not.toHaveProperty("note");
  const tl = buildTimeline(doc);
  expect(tl.steps.map((s) => s.note)).toEqual(["Cache is checked first; TTL is 60s.", undefined]);
});

test("note text is literal: # and : and & are kept, with W105 for a comment-like #", () => {
  const r = parse("a -> b\nnote retry #2: a & b # really");
  expect((r.doc.body[0] as { note?: string }).note).toBe("retry #2: a & b # really");
  expect(r.diagnostics.map((d) => d.code)).toEqual(["W105"]);
});

test("notes inside blocks, after wait, joined when repeated, and on every loop iteration", () => {
  const { doc, diagnostics } = parse("loop 2\n  a -> b\n  wait 0.2\n  note first\n  note second\nend\nbranch x\n  a -> c\n  note in arm\nend");
  expect(diagnostics).toEqual([]);
  const tl = buildTimeline(doc);
  expect(tl.steps.map((s) => s.note)).toEqual(["first second", "first second", "in arm"]);
});

test("E116: note with no step above it in the same block", () => {
  expect(codes("note first\na -> b")).toEqual(["E116"]);
  expect(codes("a -> b\nloop 2\n  note inside\n  a -> b\nend")).toEqual(["E116"]);
  expect(codes("a -> b\nbranch x\n  a -> c\nend\nnote after block")).toEqual(["E116"]);
  expect(parse("note x\na -> b").diagnostics[0].span).toEqual({ line: 1, col: 1, length: 4 });
});

test("E307: note needs text; E115: a node called note at line start", () => {
  expect(codes("a -> b\nnote")).toEqual(["E307"]);
  expect(codes("note -> api")).toEqual(["E115"]);
  expect(codes("api -> note")).toEqual([]);
});

test("fmt keeps note text verbatim and indents it with its block", () => {
  expect(formatSource("loop 2\na->b\nnote   keep   #this   as is\nend\n")).toBe("loop 2\n  a -> b\n  note keep   #this   as is\nend\n");
});

test("a tab after note (or title) still keeps # literal", () => {
  expect((parse("a -> b\nnote\twhy # draft").doc.body[0] as { note?: string }).note).toBe("why # draft");
  expect(parse("title\tA # B\na -> b").doc.title).toBe("A # B");
  expect(formatSource("a -> b\nnote\twhy # draft\n")).toBe("a -> b\nnote why # draft\n");
});
