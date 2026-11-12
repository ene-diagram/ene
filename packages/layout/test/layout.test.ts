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
const quad = (d: string) => (d.match(/[-\d.]+/g) ?? []).map(Number);
/** M/L/Q 경로를 점으로 샘플링 */
export const sample = (d: string) => {
  const pts: { x: number; y: number }[] = []; let cur = { x: 0, y: 0 };
  for (const m of d.matchAll(/([MLQ])([^MLQ]*)/g)) {
    const n = (m[2].match(/[-\d.]+/g) ?? []).map(Number);
    if (m[1] === "M") { cur = { x: n[0], y: n[1] }; continue; }
    if (m[1] === "L") { for (let k = 1; k <= 10; k++) pts.push({ x: cur.x + (n[0] - cur.x) * k / 10, y: cur.y + (n[1] - cur.y) * k / 10 }); cur = { x: n[0], y: n[1] }; }
    if (m[1] === "Q") { for (let k = 1; k <= 20; k++) { const t = k / 20; pts.push({ x: (1-t)**2*cur.x + 2*(1-t)*t*n[0] + t*t*n[2], y: (1-t)**2*cur.y + 2*(1-t)*t*n[1] + t*t*n[3] }); } cur = { x: n[2], y: n[3] }; }
  }
  return pts;
};
test.each(readdirSync(ex).filter(f => f.endsWith(".ene")))("%s: edges do not pass through other nodes", async (f) => {
  const src = readFileSync(new URL(f, ex), "utf8");
  const { doc } = parse(src); const tl = buildTimeline(doc); const l = await layout(doc, tl);
  for (const e of l.edges) {
    const ed = tl.allEdges[e.index]; if (ed.from === ed.to) continue;
    for (const { x, y } of sample(e.d)) {
      const hit = l.nodes.find(n => n.id !== ed.from && n.id !== ed.to && x > n.x && x < n.x + n.w && y > n.y && y < n.y + n.h);
      expect(hit?.id, `${ed.from}->${ed.to} crosses`).toBeUndefined();
    }
  }
});
test.each(readdirSync(ex).filter(f => f.endsWith(".ene")))("%s: every curve stays inside the canvas", async (f) => {
  const { doc } = parse(readFileSync(new URL(f, ex), "utf8")); const l = await layout(doc, buildTimeline(doc));
  for (const e of l.edges) {
    const n = quad(e.d);
    for (let i = 0; i < n.length; i += 2) {
      expect(n[i]).toBeGreaterThanOrEqual(0); expect(n[i]).toBeLessThanOrEqual(l.width);
      expect(n[i + 1]).toBeGreaterThanOrEqual(0); expect(n[i + 1]).toBeLessThanOrEqual(l.height);
    }
  }
});
test("many edges between one pair stay compact", async () => {
  const src = Array.from({ length: 6 }, (_, i) => (i % 2 ? "b --> a" : "a -> b")).join("\n");
  const l = await run(src);
  const ys = l.edges.map(e => e.mid.y); const spread = Math.max(...ys) - Math.min(...ys);
  expect(spread).toBeLessThanOrEqual(110);
  for (let i = 0; i < ys.length; i++) for (let j = i + 1; j < ys.length; j++) expect(Math.abs(ys[i] - ys[j])).toBeGreaterThanOrEqual(12);
});
test("large example lays out in under 3s", async () => {
  const src = readFileSync(new URL("12-large-commerce.ene", ex), "utf8");
  const t0 = performance.now(); const l = await run(src);
  expect(performance.now() - t0).toBeLessThan(3000); expect(l.nodes.length).toBe(28);
});
test("accepts an injected ELK instance", async () => {
  let called = 0;
  const fake = { layout: async (g: any) => { called++; return { ...g, children: g.children.map((c: any, i: number) => ({ ...c, x: i * 300, y: 0 })) }; } };
  const { doc } = parse("a -> b"); const l = await layout(doc, buildTimeline(doc), { elk: fake as any });
  expect(called).toBe(1); expect(l.nodes[1].x - l.nodes[0].x).toBe(300);
});
test.each(readdirSync(ex).filter(f => f.endsWith(".ene")))("%s: group boxes contain members, exclude others, nest", async (f) => {
  const { doc } = parse(readFileSync(new URL(f, ex), "utf8")); const l = await layout(doc, buildTimeline(doc));
  const inBox = (n: { x: number; y: number; w: number; h: number }, g: { x: number; y: number; w: number; h: number }) =>
    n.x >= g.x && n.y >= g.y && n.x + n.w <= g.x + g.w && n.y + n.h <= g.y + g.h;
  const overlap = (n: { x: number; y: number; w: number; h: number }, g: { x: number; y: number; w: number; h: number }) =>
    n.x < g.x + g.w && g.x < n.x + n.w && n.y < g.y + g.h && g.y < n.y + n.h;
  expect(l.groups).toHaveLength(doc.groups.length);
  for (const g of doc.groups) {
    const box = l.groups.find(b => b.id === g.id)!;
    const all = new Set(doc.groups.filter(x => x.id === g.id || isDesc(doc.groups, x.id, g.id)).flatMap(x => x.members));
    for (const n of l.nodes) {
      if (all.has(n.id)) expect(inBox(n, box), `${n.id} in ${g.id}`).toBe(true);
      else expect(overlap(n, box), `${n.id} outside ${g.id}`).toBe(false);
    }
    if (g.parent) expect(inBox(box, l.groups.find(b => b.id === g.parent)!)).toBe(true);
  }
});
const isDesc = (gs: { id: string; parent?: string }[], id: string, anc: string): boolean => {
  const g = gs.find(x => x.id === id); return !!g?.parent && (g.parent === anc || isDesc(gs, g.parent, anc));
};
