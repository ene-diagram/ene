import { readdirSync, readFileSync } from "node:fs";
import { parse, buildTimeline } from "@ene/core";
import { layout, type Layout } from "../src/index";
const ex = new URL("../../core/examples/", import.meta.url);
const run = async (src: string, choices?: number[]) => {
  const { doc } = parse(src); return layout(doc, buildTimeline(doc, { choices }));
};
const overlaps = (l: Layout) => l.nodes.some((a, i) => l.nodes.some((b, j) =>
  i < j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));

test.each(readdirSync(ex).filter(f => f.endsWith(".ene")))("%s: no overlapping nodes, all edges routed", async (f) => {
  const src = readFileSync(new URL(f, ex), "utf8");
  const l = await run(src);
  expect(overlaps(l)).toBe(false);
  expect(l.edges).toHaveLength(buildTimeline(parse(src).doc).allEdges.length);
  for (const e of l.edges) expect(e.d).toMatch(/^M[-\d.]+,[-\d.]+ /);
  expect(l.width).toBeGreaterThan(0);
});
test("coordinates do not depend on branch choice", async () => {
  const src = readFileSync(new URL("03-cache.ene", ex), "utf8");
  const [a, b] = await Promise.all([run(src, [0]), run(src, [1])]);
  expect(a.nodes).toEqual(b.nodes);
});
test("pin places node in grid cell", async () => {
  const l = await run("a -> b\nb -> c\npin c 0,2");
  const a = l.nodes.find(n => n.id === "a")!, c = l.nodes.find(n => n.id === "c")!;
  expect(c.x).toBe(a.x); expect(c.y).toBeGreaterThan(a.y);
});
test("rank aligns x", async () => {
  const l = await run("a -> b\nb -> c\nrank b c");
  const b = l.nodes.find(n => n.id === "b")!, c = l.nodes.find(n => n.id === "c")!;
  expect(c.x).toBe(b.x); expect(overlaps(l)).toBe(false);
});
test("three edges between same pair are spread apart", async () => {
  const l = await run("a -> b\nb --> a\na -> b : retry");
  const m = l.edges.map(e => e.mid);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++)
    expect(Math.hypot(m[i].x - m[j].x, m[i].y - m[j].y)).toBeGreaterThanOrEqual(20);
});
test("self edge and single node work", async () => {
  const l = await run("a -> a");
  expect(l.nodes).toHaveLength(1); expect(l.edges[0].d).toContain("C");
});
