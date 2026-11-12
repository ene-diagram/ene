import ElkModule from "elkjs/lib/elk.bundled.js";
import type { ELK as ElkApi } from "elkjs/lib/elk-api.js";
import type { Document, Timeline } from "@ene/core";

export interface LNode { id: string; label: string; icon?: string; x: number; y: number; w: number; h: number }
export interface LEdge { index: number; d: string; mid: { x: number; y: number } }
export interface Layout { nodes: LNode[]; edges: LEdge[]; width: number; height: number }

// elkjs 는 CJS — 번들러/Node 에 따라 default 가 한 겹 더 감싸질 수 있다
const ELK = ((ElkModule as unknown as { default?: unknown }).default ?? ElkModule) as unknown as new () => ElkApi;

export const NODE_H = 52;
/** 아이콘(24px) + 여백이 차지하는 가로 공간 */
export const ICON_SPACE = 34;
const GAP_NODE = 50, GAP_LAYER = 110, PAD = 40, SPREAD = 30;

/** 라벨 표시폭 추정: 한글·전각 15px, 그 외 8.5px */
export function textWidth(s: string): number {
  let w = 0;
  for (const c of s) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(c) ? 15 : 8.5;
  return w;
}

export async function layout(doc: Document, tl: Timeline): Promise<Layout> {
  const nodes: LNode[] = [...doc.nodes.values()].map((n) => ({
    id: n.id, label: n.label, ...(n.icon ? { icon: n.icon } : {}), x: 0, y: 0,
    w: Math.max(110, Math.ceil(textWidth(n.label) + 36 + (n.icon ? ICON_SPACE : 0))), h: NODE_H,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // ELK 에는 쌍마다 처음 나온 방향의 엣지 하나만 준다
  const seen = new Set<string>();
  const elkEdges: { id: string; sources: string[]; targets: string[] }[] = [];
  tl.allEdges.forEach((e, i) => {
    if (e.from === e.to) return;
    const key = [e.from, e.to].sort().join("\u0000");
    if (seen.has(key)) return;
    seen.add(key);
    elkEdges.push({ id: `e${i}`, sources: [e.from], targets: [e.to] });
  });
  const elk = new ELK();
  const g = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": String(GAP_NODE),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(GAP_LAYER),
      "elk.spacing.componentComponent": String(GAP_NODE),
    },
    children: nodes.map((n) => ({ id: n.id, width: n.w, height: n.h })),
    edges: elkEdges,
  });
  for (const c of g.children ?? []) { const n = byId.get(c.id)!; n.x = c.x ?? 0; n.y = c.y ?? 0; }

  const fixed = new Set<string>();
  // rank: 그룹의 x 를 가장 왼쪽에 맞춘다
  for (const r of doc.ranks) {
    const group = r.ids.map((id) => byId.get(id)!).filter(Boolean);
    const x = Math.min(...group.map((n) => n.x));
    group.forEach((n) => (n.x = x));
  }
  // pin: 층(열) x 와 행 높이 격자
  if (doc.pins.length) {
    const cols = [...new Set(nodes.map((n) => Math.round(n.x)))].sort((a, b) => a - b);
    const colStep = Math.max(...nodes.map((n) => n.w)) + GAP_LAYER;
    const colX = (c: number) => (c < cols.length ? cols[c] : cols[cols.length - 1] + (c - cols.length + 1) * colStep);
    const top = Math.min(...nodes.map((n) => n.y));
    for (const p of doc.pins) {
      const n = byId.get(p.id);
      if (!n) continue;
      n.x = colX(p.col); n.y = top + p.row * (NODE_H + GAP_NODE);
      fixed.add(n.id);
    }
  }
  resolveOverlaps(nodes, fixed);

  // 원점 정리
  const nx0 = Math.min(...nodes.map((n) => n.x)), ny0 = Math.min(...nodes.map((n) => n.y));
  nodes.forEach((n) => { n.x = Math.round(n.x - nx0 + PAD); n.y = Math.round(n.y - ny0 + PAD); });

  // 곡선의 제어점까지 포함한 경계로 캔버스를 잡는다 (경로는 상대 위치로만 정해지므로 옮긴 뒤 다시 그린다)
  let edges = routeEdges(tl, byId);
  const pts = () => edges.flatMap((e) => {
    const n = (e.d.match(/[-\d.]+/g) ?? []).map(Number);
    return n.flatMap((_, i) => (i % 2 ? [] : [{ x: n[i], y: n[i + 1] }]));
  });
  let minX = Math.min(...nodes.map((n) => n.x), ...pts().map((p) => p.x));
  let minY = Math.min(...nodes.map((n) => n.y), ...pts().map((p) => p.y - 20)); // 라벨 높이 여유
  if (minX < PAD || minY < PAD) {
    const dx = Math.max(0, Math.ceil(PAD - minX)), dy = Math.max(0, Math.ceil(PAD - minY));
    nodes.forEach((n) => { n.x += dx; n.y += dy; });
    edges = routeEdges(tl, byId);
  }
  const all = pts();
  const width = Math.ceil(Math.max(...nodes.map((n) => n.x + n.w), ...all.map((p) => p.x)) + PAD);
  const height = Math.ceil(Math.max(...nodes.map((n) => n.y + n.h), ...all.map((p) => p.y)) + PAD);
  return { nodes, edges, width, height };
}

/** 겹치는 노드는 고정되지 않은 쪽을 아래로 민다 */
function resolveOverlaps(nodes: LNode[], fixed: Set<string>) {
  for (let iter = 0; iter < 200; iter++) {
    let moved = false;
    const sorted = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x);
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i], b = sorted[j];
        if (!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h + GAP_NODE / 2 && b.y < a.y + a.h + GAP_NODE / 2)) continue;
        const mover = fixed.has(b.id) && !fixed.has(a.id) ? a : b;
        const anchor = mover === a ? b : a;
        mover.y = anchor.y + anchor.h + GAP_NODE;
        moved = true;
      }
    if (!moved) return;
  }
}

function routeEdges(tl: Timeline, byId: Map<string, LNode>): LEdge[] {
  const groups = new Map<string, number[]>();
  tl.allEdges.forEach((e, i) => {
    const key = [e.from, e.to].sort().join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const out: LEdge[] = [];
  for (const [key, idx] of groups) {
    const [p, q] = key.split("\u0000");
    if (p === q) { idx.forEach((i, k) => out.push(selfLoop(i, byId.get(p)!, k))); continue; }
    const P = byId.get(p)!, Q = byId.get(q)!;
    const others = [...byId.values()].filter((n) => n !== P && n !== Q);
    const pc = center(P), qc = center(Q);
    const len = Math.hypot(qc.x - pc.x, qc.y - pc.y) || 1;
    const nx = -(qc.y - pc.y) / len, ny = (qc.x - pc.x) / len;
    const curve = (i: number, o: number) => {
      const e = tl.allEdges[i];
      const a = byId.get(e.from)!, b = byId.get(e.to)!, ac = center(a), bc = center(b);
      const cx = (ac.x + bc.x) / 2 + nx * o * 2, cy = (ac.y + bc.y) / 2 + ny * o * 2;
      return { s: clip(a, cx, cy), c: { x: cx, y: cy }, t: clip(b, cx, cy) };
    };
    // 다른 노드를 뚫으면 묶음 전체를 한쪽으로 더 휘게 한다
    const base = idx.map((_, k) => (k - (idx.length - 1) / 2) * SPREAD);
    let shift = 0;
    for (const cand of [0, 40, -40, 70, -70, 100, -100, 140, -140, 190, -190, 250, -250]) {
      if (idx.every((i, k) => !crosses(curve(i, base[k] + cand), others))) { shift = cand; break; }
    }
    idx.forEach((i, k) => {
      const { s, c, t } = curve(i, base[k] + shift);
      const mid = { x: (s.x + 2 * c.x + t.x) / 4, y: (s.y + 2 * c.y + t.y) / 4 };
      out.push({ index: i, d: `M${r(s.x)},${r(s.y)} Q${r(c.x)},${r(c.y)} ${r(t.x)},${r(t.y)}`, mid: { x: r(mid.x), y: r(mid.y) } });
    });
  }
  return out.sort((x, y) => x.index - y.index);
}

type Pt = { x: number; y: number };
const MARGIN = 8;
function crosses(q: { s: Pt; c: Pt; t: Pt }, nodes: LNode[]): boolean {
  for (let k = 1; k < 40; k++) {
    const u = k / 40, a = (1 - u) ** 2, b = 2 * (1 - u) * u, c = u * u;
    const x = a * q.s.x + b * q.c.x + c * q.t.x, y = a * q.s.y + b * q.c.y + c * q.t.y;
    if (nodes.some((n) => x > n.x - MARGIN && x < n.x + n.w + MARGIN && y > n.y - MARGIN && y < n.y + n.h + MARGIN)) return true;
  }
  return false;
}

function selfLoop(i: number, n: LNode, k: number): LEdge {
  const lift = 45 + k * 18, cx = n.x + n.w / 2;
  const x1 = cx - 18, x2 = cx + 18, y = n.y;
  return { index: i, d: `M${r(x1)},${y} C${r(x1 - 30)},${y - lift} ${r(x2 + 30)},${y - lift} ${r(x2)},${y}`, mid: { x: r(cx), y: r(y - lift * 0.75) } };
}

const center = (n: LNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
const r = (v: number) => Math.round(v * 10) / 10;
/** 노드 중심에서 (tx,ty) 방향으로 나가는 선이 박스 경계와 만나는 점 */
function clip(n: LNode, tx: number, ty: number) {
  const c = center(n), ux = tx - c.x, uy = ty - c.y;
  const s = Math.min(Math.abs(n.w / 2 / (ux || 1e-9)), Math.abs(n.h / 2 / (uy || 1e-9)));
  return { x: c.x + ux * s, y: c.y + uy * s };
}
