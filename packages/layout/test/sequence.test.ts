import { parse, buildTimeline } from "@ene-diagram/core";
import { layoutSequence, edgeFor } from "../src/index";
const seq = (src: string, choices?: number[]) => {
  const { doc } = parse("diagram sequence\n" + src);
  const tl = buildTimeline(doc, { choices });
  return { tl, l: layoutSequence(doc, tl) };
};
test("participants in declaration order, rows go down, arrows are horizontal", () => {
  const { tl, l } = seq("user -> api : req\napi -> db : q\ndb --> api : rows\napi --> user : res");
  expect(l.nodes.map((n) => n.id)).toEqual(["user", "api", "db"]);
  expect(l.nodes[0].x).toBeLessThan(l.nodes[1].x);
  const ys = tl.steps.map((s) => {
    const e = edgeFor(l, s.index, 0, s.edges[0].edgeIndex)!;
    const n = e.d.match(/[-\d.]+/g)!.map(Number);
    expect(n[1]).toBe(n[n.length - 1]);
    return n[1];
  });
  expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  expect(new Set(ys).size).toBe(4);
  expect(l.lifelines).toHaveLength(3);
});
test("parallel edges share a row, self edge loops right", () => {
  const { tl, l } = seq("a -> b & a -> c\nb -> b : self");
  const y = (s: number, k: number) => Number(edgeFor(l, s, k, tl.steps[s].edges[k].edgeIndex)!.d.match(/[-\d.]+/g)![1]);
  expect(y(0, 0)).toBe(y(0, 1));
  expect(edgeFor(l, 1, 0, tl.steps[1].edges[0].edgeIndex)!.d).toContain("C");
});
test("branch arm gets a frame labeled with the arm", () => {
  const { l } = seq("a -> b\nbranch hit\n b --> a\nelse miss\n b -> c\n c --> a\nend", [1]);
  expect(l.frames).toEqual([expect.objectContaining({ label: "miss" })]);
});
test("opt frames are labeled opt; skipped opt has no frame", () => {
  expect(seq("a -> b\nopt cached\n b --> a\nend").l.frames!.map((f) => f.label)).toEqual(["opt cached"]);
  expect(seq("a -> b\nopt\n b --> a\nend").l.frames!.map((f) => f.label)).toEqual(["opt"]);
  expect(seq("a -> b\nopt cached\n b --> a\nend", [1]).l.frames).toEqual([]);
});
