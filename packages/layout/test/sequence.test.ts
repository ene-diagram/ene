import { parse, buildTimeline } from "@ene-diagram/core";
import { layoutSequence, edgeFor } from "../src/index";
const seq = (src: string, choices?: number[]) => {
  const { doc } = parse(`diagram sequence\n${src}`);
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

describe("activation bars", () => {
  const bars = (src: string, choices?: number[]) =>
    seq(src, choices).l.activations!.map((a) => [a.id, a.step, (a.y2 - a.y1) / 52, a.x]);
  test("a request opens a bar on the callee until it answers that caller", () => {
    const { l } = seq("user -> api : req\napi -> db : q\ndb --> api : rows\napi --> user : res");
    const [api, db] = l.activations!;
    expect([api.id, api.step, api.k]).toEqual(["api", 0, 0]);
    expect([db.id, db.step]).toEqual(["db", 1]);
    // api is busy for rows 0..3, db for rows 1..2
    expect((api.y2 - api.y1) / 52).toBe(3);
    expect((db.y2 - db.y1) / 52).toBe(1);
    const life = l.lifelines!.find((x) => x.id === "api")!;
    expect(api.x + api.w / 2).toBe(life.x);
    expect(api.y1).toBeGreaterThan(life.y1);
    expect(api.y2).toBeLessThan(life.y2);
  });
  test("a failure answers too; a request that is never answered has no bar", () => {
    expect(bars("a -> b\nb -x a\na -> c\na ~> b")).toEqual([["b", 0, 1, expect.any(Number)]]);
  });
  test("an answer closes the latest open request between the two, and nested bars step right", () => {
    const b = bars("a -> b : outer\na -> b : inner\nb --> a\nb --> a");
    expect(b.map((x) => [x[1], x[2]])).toEqual([
      [0, 3],
      [1, 1],
    ]);
    expect((b[1][3] as number) - (b[0][3] as number)).toBe(4);
  });
  test("an answer to someone else, a self message or an answer with no request does nothing", () => {
    expect(bars("a -> b\nb --> c\nb -> b\nc --> a")).toEqual([]);
  });
  test("bars follow the branch that is taken", () => {
    const src = "a -> b\nbranch ok\n  b --> a\nelse slow\n  b -> c\n  c --> b\n  b --> a\nend";
    expect(bars(src, [0]).map((x) => [x[0], x[2]])).toEqual([["b", 1]]);
    expect(bars(src, [1]).map((x) => [x[0], x[2]])).toEqual([
      ["b", 3],
      ["c", 1],
    ]);
  });
});
