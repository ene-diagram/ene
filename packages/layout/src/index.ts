import type { ELK as ElkApi } from "elkjs/lib/elk-api.js";
export type { ElkApi };
import type { Document, Timeline } from "@ene/core";

export interface LNode { id: string; label: string; icon?: string; shape?: string; color?: string; x: number; y: number; w: number; h: number }
export interface LEdge { index: number; d: string; mid: { x: number; y: number } }
export interface LGroup { id: string; label: string; color?: string; depth: number; x: number; y: number; w: number; h: number }
export interface Layout { nodes: LNode[]; edges: LEdge[]; groups: LGroup[]; width: number; height: number }

const G_PAD = 18, G_TOP = 34;

export interface LayoutOptions {
  /** 미리 만든 ELK 인스턴스. 없으면 elkjs 를 그때 불러온다 (브라우저 플레이어는 별도 파일로 주입) */
  elk?: Pick<ElkApi, "layout">;
}

async function defaultElk(): Promise<Pick<ElkApi, "layout">> {
  const m = await import("elkjs/lib/elk.bundled.js");
  // elkjs 는 CJS — 환경에 따라 default 가 한 겹 더 감싸질 수 있다
  const Ctor = ((m as { default?: unknown }).default ?? m) as { default?: unknown };
  return new ((Ctor.default ?? Ctor) as new () => ElkApi)();
}

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

export async function layout(doc: Document, tl: Timeline, opts: LayoutOptions = {}): Promise<Layout> {
  const nodes: LNode[] = [...doc.nodes.values()].map((n) => ({
    id: n.id, label: n.label, ...(n.icon ? { icon: n.icon } : {}), ...(n.shape ? { shape: n.shape } : {}), ...(n.color ? { color: n.color } : {}), x: 0, y: 0,
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
  const elk = opts.elk ?? (await defaultElk());
  // 그룹은 ELK 의 계층 노드로 넘긴다 (멤버는 자식)
  type ElkN = { id: string; width?: number; height?: number; children?: ElkN[]; layoutOptions?: Record<string, string>; x?: number; y?: number };
  const direct = new Map<string, string>(); // 노드 → 가장 안쪽 그룹
  for (const g of doc.groups) for (const m of g.members) direct.set(m, g.id);
  const elkNode = (n: LNode): ElkN => ({ id: n.id, width: n.w, height: n.h });
  const elkGroup = (gid: string): ElkN => ({
    id: `group:${gid}`,
    layoutOptions: { "elk.padding": `[top=${G_TOP},left=${G_PAD},bottom=${G_PAD},right=${G_PAD}]` },
    children: [
      ...nodes.filter((n) => direct.get(n.id) === gid).map(elkNode),
      ...doc.groups.filter((g) => g.parent === gid).map((g) => elkGroup(g.id)),
    ],
  });
  const g = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": String(GAP_NODE),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(GAP_LAYER),
      "elk.spacing.componentComponent": String(GAP_NODE),
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: [
      ...nodes.filter((n) => !direct.has(n.id)).map(elkNode),
      ...doc.groups.filter((gr) => !gr.parent).map((gr) => elkGroup(gr.id)),
    ],
    edges: elkEdges,
  } as never) as unknown as ElkN;
  const walk = (c: ElkN, ox: number, oy: number) => {
    const x = ox + (c.x ?? 0), y = oy + (c.y ?? 0);
    const n = byId.get(c.id);
    if (n) { n.x = x; n.y = y; }
    for (const ch of c.children ?? []) walk(ch, x, y);
  };
  for (const c of g.children ?? []) walk(c, 0, 0);

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
  let groups = groupBoxes(doc, byId);
  // 멤버가 아닌 노드가 그룹 상자에 걸치면 상자 아래로 내린다
  for (let iter = 0; iter < 60 && groups.length; iter++) {
    let moved = false;
    for (const gb of groups) {
      const members = membersDeep(doc, gb.id);
      for (const n of nodes) {
        if (members.has(n.id) || fixed.has(n.id)) continue;
        if (n.x < gb.x + gb.w && gb.x < n.x + n.w && n.y < gb.y + gb.h && gb.y < n.y + n.h) { n.y = gb.y + gb.h + GAP_NODE / 2; moved = true; }
      }
    }
    if (!moved) break;
    resolveOverlaps(nodes, fixed);
    groups = groupBoxes(doc, byId);
  }

  // 원점 정리
  const nx0 = Math.min(...nodes.map((n) => n.x), ...groups.map((b) => b.x)), ny0 = Math.min(...nodes.map((n) => n.y), ...groups.map((b) => b.y));
  nodes.forEach((n) => { n.x = Math.round(n.x - nx0 + PAD); n.y = Math.round(n.y - ny0 + PAD); });

  // 곡선의 제어점까지 포함한 경계로 캔버스를 잡는다 (경로는 상대 위치로만 정해지므로 옮긴 뒤 다시 그린다)
  let edges = routeEdges(tl, byId);
  const pts = () => edges.flatMap((e) => {
    const n = (e.d.match(/[-\d.]+/g) ?? []).map(Number);
    return n.flatMap((_, i) => (i % 2 ? [] : [{ x: n[i], y: n[i + 1] }]));
  });
  groups = groupBoxes(doc, byId);
  let minX = Math.min(...nodes.map((n) => n.x), ...groups.map((b) => b.x), ...pts().map((p) => p.x));
  let minY = Math.min(...nodes.map((n) => n.y), ...groups.map((b) => b.y), ...pts().map((p) => p.y - 20)); // 라벨 높이 여유
  if (minX < PAD || minY < PAD) {
    const dx = Math.max(0, Math.ceil(PAD - minX)), dy = Math.max(0, Math.ceil(PAD - minY));
    nodes.forEach((n) => { n.x += dx; n.y += dy; });
    edges = routeEdges(tl, byId);
    groups = groupBoxes(doc, byId);
  }
  const all = pts();
  const width = Math.ceil(Math.max(...nodes.map((n) => n.x + n.w), ...groups.map((b) => b.x + b.w), ...all.map((p) => p.x)) + PAD);
  const height = Math.ceil(Math.max(...nodes.map((n) => n.y + n.h), ...groups.map((b) => b.y + b.h), ...all.map((p) => p.y)) + PAD);
  return { nodes, edges, groups, width, height };
}

function membersDeep(doc: Document, gid: string): Set<string> {
  const out = new Set<string>();
  const add = (id: string) => {
    doc.groups.find((g) => g.id === id)?.members.forEach((m) => out.add(m));
    doc.groups.filter((g) => g.parent === id).forEach((g) => add(g.id));
  };
  add(gid);
  return out;
}

/** 그룹 상자 = 멤버(와 안쪽 그룹) 경계 + 여백. 안쪽부터 계산한다 */
function groupBoxes(doc: Document, byId: Map<string, LNode>): LGroup[] {
  const depth = (id: string): number => { const g = doc.groups.find((x) => x.id === id); return g?.parent ? depth(g.parent) + 1 : 0; };
  const boxes = new Map<string, LGroup>();
  const order = [...doc.groups].sort((a, b) => depth(b.id) - depth(a.id));
  for (const g of order) {
    const rects = [
      ...g.members.map((m) => byId.get(m)!).filter(Boolean),
      ...doc.groups.filter((c) => c.parent === g.id).map((c) => boxes.get(c.id)!).filter(Boolean),
    ];
    if (!rects.length) continue;
    const x = Math.min(...rects.map((r) => r.x)) - G_PAD, y = Math.min(...rects.map((r) => r.y)) - G_TOP;
    const w = Math.max(...rects.map((r) => r.x + r.w)) + G_PAD - x, h = Math.max(...rects.map((r) => r.y + r.h)) + G_PAD - y;
    boxes.set(g.id, { id: g.id, label: g.label, ...(g.color ? { color: g.color } : {}), depth: depth(g.id), x, y, w, h });
  }
  return doc.groups.map((g) => boxes.get(g.id)!).filter(Boolean);
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
    // 엣지가 많으면 간격을 좁혀 묶음이 과하게 부풀지 않게 한다
    const spread = idx.length <= 4 ? SPREAD : Math.max(12, 72 / (idx.length - 1));
    const base = idx.map((_, k) => (k - (idx.length - 1) / 2) * spread);
    let shift: number | undefined;
    for (const cand of [0, 40, -40, 70, -70, 100, -100, 140, -140, 190, -190, 250, -250]) {
      if (idx.every((i, k) => !crosses(curve(i, base[k] + cand), others))) { shift = cand; break; }
    }
    if (shift === undefined) {
      // 곡선으로 못 피하면 위/아래로 돌아가는 꺾은선
      const bus = idx.map((i, k) => detour(tl.allEdges[i], byId, others, k) ?? gridRoute(tl.allEdges[i], byId, others, k));
      if (bus.every(Boolean)) { idx.forEach((i, k) => out.push({ index: i, ...bus[k]! })); continue; }
      shift = 0;
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

const inside = (x: number, y: number, nodes: LNode[]) =>
  nodes.some((n) => x > n.x - MARGIN && x < n.x + n.w + MARGIN && y > n.y - MARGIN && y < n.y + n.h + MARGIN);

function polyCrosses(pts: Pt[], nodes: LNode[]): boolean {
  for (let i = 1; i < pts.length; i++)
    for (let k = 0; k <= 20; k++) {
      const x = pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * k) / 20, y = pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * k) / 20;
      if (inside(x, y, nodes)) return true;
    }
  return false;
}

/**
 * 마지막 대안: 격자(10px) 위 A* 로 장애물을 피하는 직각 경로. 꺾임에 비용을 줘서 단순한 길을 고른다.
 * k 번째 엣지는 다른 엣지와 겹치지 않게 경로를 조금씩 비켜 놓는다.
 */
function gridRoute(e: { from: string; to: string }, byId: Map<string, LNode>, others: LNode[], k: number): { d: string; mid: Pt } | undefined {
  const a = byId.get(e.from)!, b = byId.get(e.to)!, all = [a, b, ...others];
  const C = 10, pad = 80;
  const x0 = Math.min(...all.map((n) => n.x)) - pad, y0 = Math.min(...all.map((n) => n.y)) - pad;
  const W = Math.ceil((Math.max(...all.map((n) => n.x + n.w)) + pad - x0) / C), H = Math.ceil((Math.max(...all.map((n) => n.y + n.h)) + pad - y0) / C);
  const blocked = new Uint8Array(W * H);
  for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++)
    if (inside(x0 + gx * C, y0 + gy * C, others)) blocked[gy * W + gx] = 1;
  const cell = (n: LNode) => [Math.round((n.x + n.w / 2 - x0) / C), Math.round((n.y + n.h / 2 - y0) / C)];
  const [sx, sy] = cell(a), [tx, ty] = cell(b);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // 상태 = 칸 * 4 + 들어온 방향
  const N = W * H * 4, g = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  const open: [number, number][] = [];
  const push = (st: number, f: number) => { open.push([f, st]); let i = open.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p][0] <= open[i][0]) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
  const pop = () => { const top = open[0], last = open.pop()!; if (open.length) { open[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < open.length && open[l][0] < open[m][0]) m = l; if (rr < open.length && open[rr][0] < open[m][0]) m = rr; if (m === i) break; [open[m], open[i]] = [open[i], open[m]]; i = m; } } return top; };
  for (let d = 0; d < 4; d++) { const st = (sy * W + sx) * 4 + d; g[st] = 0; push(st, Math.abs(tx - sx) + Math.abs(ty - sy)); }
  let goal = -1;
  while (open.length) {
    const [, st] = pop();
    const c = st >> 2, d = st & 3, cx = c % W, cy = (c / W) | 0;
    if (cx === tx && cy === ty) { goal = st; break; }
    for (let nd = 0; nd < 4; nd++) {
      const nx = cx + DIRS[nd][0], ny = cy + DIRS[nd][1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || blocked[ny * W + nx]) continue;
      const ns = (ny * W + nx) * 4 + nd, cost = g[st] + 1 + (nd !== d ? 6 : 0);
      if (cost < g[ns]) { g[ns] = cost; prev[ns] = st; push(ns, cost + Math.abs(tx - nx) + Math.abs(ty - ny)); }
    }
  }
  if (goal < 0) return undefined;
  const cells: Pt[] = [];
  for (let st = goal; st >= 0; st = prev[st]) { const c = st >> 2; cells.push({ x: x0 + (c % W) * C, y: y0 + ((c / W) | 0) * C }); }
  cells.reverse();
  // 노드 밖으로 나온 첫 점 ~ 대상 노드에 들어가기 직전 점
  const out = (p: Pt, n: LNode) => !(p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h);
  let i0 = cells.findIndex((p) => out(p, a)), i1 = cells.length - 1 - [...cells].reverse().findIndex((p) => out(p, b));
  if (i0 < 0 || i1 < i0) return undefined;
  i0 = Math.max(0, i0 - 1); i1 = Math.min(cells.length - 1, i1 + 1);
  const off = k * 8;
  let pts = cells.slice(i0, i1 + 1).map((p) => ({ x: p.x + off, y: p.y + off }));
  if (off && polyCrosses(pts, others)) pts = cells.slice(i0, i1 + 1);
  // 일직선 위 점 제거
  pts = pts.filter((p, j) => j === 0 || j === pts.length - 1 ||
    !((pts[j - 1].x === p.x && p.x === pts[j + 1].x) || (pts[j - 1].y === p.y && p.y === pts[j + 1].y)));
  const segs = pts.slice(1).map((p, j) => Math.hypot(p.x - pts[j].x, p.y - pts[j].y));
  let half = segs.reduce((s, v) => s + v, 0) / 2, mid = pts[0];
  for (let j = 0; j < segs.length; j++) {
    if (half <= segs[j]) { const t = segs[j] ? half / segs[j] : 0; mid = { x: pts[j].x + (pts[j + 1].x - pts[j].x) * t, y: pts[j].y + (pts[j + 1].y - pts[j].y) * t }; break; }
    half -= segs[j];
  }
  return { d: `M${pts.map((p) => `${r(p.x)},${r(p.y)}`).join(" L")}`, mid: { x: r(mid.x), y: r(mid.y) } };
}

/** 노드 위(또는 아래)로 나가 가로로 지나간 뒤 대상 노드로 들어가는 꺾은선 */
function detour(e: { from: string; to: string }, byId: Map<string, LNode>, others: LNode[], k: number): { d: string; mid: Pt } | undefined {
  const a = byId.get(e.from)!, b = byId.get(e.to)!;
  const lo = Math.min(a.x, b.x), hi = Math.max(a.x + a.w, b.x + b.w);
  const between = others.filter((n) => n.x < hi && n.x + n.w > lo);
  const off = 10 + k * 8;
  for (const side of ["top", "bottom"] as const) {
    const ys = [a, b, ...between].map((n) => (side === "top" ? n.y : n.y + n.h));
    const yl = side === "top" ? Math.min(...ys) - 24 - k * 12 : Math.max(...ys) + 24 + k * 12;
    const sx = a.x + a.w / 2 + (b.x > a.x ? off : -off), tx = b.x + b.w / 2 + (b.x > a.x ? -off : off);
    const sy = side === "top" ? a.y : a.y + a.h, ty = side === "top" ? b.y : b.y + b.h;
    const pts = [{ x: sx, y: sy }, { x: sx, y: yl }, { x: tx, y: yl }, { x: tx, y: ty }];
    if (polyCrosses(pts, others)) continue;
    return { d: `M${r(sx)},${r(sy)} L${r(sx)},${r(yl)} L${r(tx)},${r(yl)} L${r(tx)},${r(ty)}`, mid: { x: r((sx + tx) / 2), y: r(yl) } };
  }
  return undefined;
}
const MARGIN = 8;
function crosses(q: { s: Pt; c: Pt; t: Pt }, nodes: LNode[]): boolean {
  for (let k = 1; k < 40; k++) {
    const u = k / 40, a = (1 - u) ** 2, b = 2 * (1 - u) * u, c = u * u;
    if (inside(a * q.s.x + b * q.c.x + c * q.t.x, a * q.s.y + b * q.c.y + c * q.t.y, nodes)) return true;
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
