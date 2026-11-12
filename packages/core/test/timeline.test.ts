import { parse } from "../src/parse";
import { buildTimeline } from "../src/timeline";
test("sequential timing with speed", () => {
  const t = buildTimeline(parse("speed 1\na -> b\nb -> c").doc);
  expect(t.steps.map(s => [s.start, s.duration])).toEqual([[0, 1], [1, 1]]); expect(t.total).toBe(2);
});
test("parallel step uses longest edge", () => {
  const t = buildTimeline(parse("speed 1\na -> b @3s & a -> c").doc);
  expect(t.steps[0].duration).toBe(3); expect(t.steps[0].edges[1].duration).toBe(1);
});
test("wait delays next step", () =>
  expect(buildTimeline(parse("speed 1\na -> b\nwait 0.5\nb -> c").doc).steps[1].start).toBe(1.5));
test("loop expands and reuses edge index", () => {
  const t = buildTimeline(parse("loop 2\n a -> b\nend").doc);
  expect(t.steps.map(s => s.edges[0].edgeIndex)).toEqual([0, 0]);
});
test("branch choice changes steps but not allEdges", () => {
  const src = "a -> b\nbranch hit\n b -> a\nbranch miss\n b -> c\n c -> a\nend";
  const t0 = buildTimeline(parse(src).doc), t1 = buildTimeline(parse(src).doc, { choices: [1] });
  expect(t0.steps).toHaveLength(2); expect(t1.steps).toHaveLength(3);
  expect(t0.allEdges).toEqual(t1.allEdges); expect(t0.allEdges).toHaveLength(4);
  expect(t0.branches).toEqual([{ label: "", arms: ["hit", "miss"] }]);
  expect(t1.steps[2].branchPath).toEqual([0, 1]);
});
test("out-of-range choice falls back to first arm", () =>
  expect(buildTimeline(parse("branch a\n x -> y\nend").doc, { choices: [5] }).steps).toHaveLength(1));
