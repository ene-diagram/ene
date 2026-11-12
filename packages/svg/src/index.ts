import type { Timeline } from "@ene/core";
import type { ResolvedIcon } from "@ene/core";
import type { LGroup, LNode, Layout } from "@ene/layout";

export interface SvgOptions { title?: string; icons?: Map<string, ResolvedIcon> }

const ICON = 24, ICON_PAD = 14;

/** 노드 모양 (박스·알약·원통·큐·원) — fill/stroke 는 인자로 */
function shapeMarkup(n: LNode, attrs: string): string {
  const { x, y, w, h } = n;
  switch (n.shape) {
    case "round": return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ${attrs}/>`;
    case "circle": return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${attrs}/>`;
    case "db": {
      const e = 8;
      return `<path d="M${x},${y + e} A${w / 2},${e} 0 0,1 ${x + w},${y + e} V${y + h - e} A${w / 2},${e} 0 0,1 ${x},${y + h - e} Z" ${attrs}/>` +
        `<path d="M${x},${y + e} A${w / 2},${e} 0 0,0 ${x + w},${y + e}" fill="none" ${attrs.replace(/fill="[^"]*"/, "")}/>`;
    }
    case "queue": {
      const lines = [0, 1, 2].map((i) => { const lx = x + w - 10 - i * 7; return `<line x1="${lx}" y1="${y + 8}" x2="${lx}" y2="${y + h - 8}" ${attrs.replace(/fill="[^"]*"/, "")}/>`; }).join("");
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" ${attrs}/>` + lines;
    }
    default: return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" ${attrs}/>`;
  }
}

/** 노드 하나(모양 + 색 + 아이콘 + 라벨) 마크업. 플레이어도 같은 것을 쓴다 */
export function nodeMarkup(n: LNode, icons: Map<string, ResolvedIcon> = new Map()): string {
  const icon = n.icon ? icons.get(n.icon) : undefined;
  const cy = n.y + n.h / 2;
  const iconSvg = icon
    ? `<svg x="${n.x + ICON_PAD}" y="${cy - ICON / 2}" width="${ICON}" height="${ICON}" viewBox="0 0 ${icon.width} ${icon.height}">${icon.body}</svg>`
    : "";
  const lx = icon ? (n.x + ICON_PAD + ICON + n.x + n.w) / 2 : n.x + n.w / 2;
  const c = n.color ? esc(n.color) : undefined;
  const body = shapeMarkup(n, 'class="node"') +
    (c ? shapeMarkup(n, `fill="${c}" fill-opacity="0.1" stroke="${c}" stroke-width="1.5"`) : "");
  return `<g>${body}${iconSvg}<text x="${lx}" y="${cy}" class="nl">${esc(n.label)}</text></g>`;
}

/** 그룹 상자 (점선 테두리 + 왼쪽 위 라벨) */
export function groupMarkup(g: LGroup): string {
  const c = g.color ? esc(g.color) : "var(--line)";
  return `<g><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="14" class="grp" fill="${c}" fill-opacity="0.05" stroke="${c}" stroke-width="1.5" stroke-dasharray="6 4"/>` +
    `<text x="${g.x + 14}" y="${g.y + 21}" class="gl" fill="${c}">${esc(g.label)}</text></g>`;
}

declare const btoa: (s: string) => string;
declare const TextEncoder: { new (): { encode(s: string): Uint8Array } };
/** 외부 SVG 문서를 아이콘으로: viewBox 크기를 읽고 data URI 이미지로 감싼다 (스크립트 실행 차단) */
export function iconFromSvgText(text: string): ResolvedIcon {
  const vb = text.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  const width = vb ? Number(vb[1]) : 24, height = vb ? Number(vb[2]) : 24;
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return { body: `<image href="data:image/svg+xml;base64,${btoa(bin)}" width="${width}" height="${height}"/>`, width, height };
}

const TITLE_H = 44, HOLD = 1.5, FADE = 0.3;

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const STYLE = `
  .bg{fill:var(--bg)} .node{fill:var(--node);stroke:var(--line);stroke-width:1.5}
  .nl{text-anchor:middle;dominant-baseline:central;font-size:15px;font-weight:600;fill:var(--fg)}
  .edge{fill:none;stroke:var(--faint);stroke-width:1.5;stroke-dasharray:4 4}
  .hl{fill:none;stroke-width:2.5} .hl.ok{stroke:var(--ok)} .hl.fail{stroke:var(--fail)} .hl.reply{stroke:var(--reply);stroke-dasharray:7 5}
  .dot.ok{fill:var(--ok)} .dot.fail{fill:var(--fail)} .dot.reply{fill:var(--reply)}
  .lbl{text-anchor:middle;font-size:12px;fill:var(--fg2);paint-order:stroke;stroke:var(--bg);stroke-width:4px}
  .x{text-anchor:middle;font-size:18px;font-weight:700;fill:var(--fail)}
  .t{font-size:17px;font-weight:700;fill:var(--fg)} .gl{font-size:12px;font-weight:600}
  svg{--bg:#fbfcfd;--node:#fff;--line:#c1c8d2;--faint:#d9dde3;--fg:#1c2024;--fg2:#3a4048;--ok:#3e63dd;--fail:#e5484d;--reply:#30a46c}
  @media (prefers-color-scheme: dark){svg{--bg:#111113;--node:#1c1d21;--line:#3b3e45;--faint:#2e3036;--fg:#edeef0;--fg2:#b0b4ba;--ok:#7b9bff;--fail:#ff6369;--reply:#4cc38a}}
  @media (prefers-reduced-motion: reduce){.dot,.x{display:none}.hl,.lbl{opacity:1 !important}}`;

export function renderSvg(l: Layout, tl: Timeline, opts: SvgOptions = {}): string {
  const total = Math.max(tl.total + HOLD, 0.1);
  const kt = (t: number) => (Math.min(1, Math.max(0, t / total))).toFixed(4);
  const anim = (attr: string, values: string, times: string) =>
    `<animate attributeName="${attr}" values="${values}" keyTimes="${times}" dur="${total}s" repeatCount="indefinite"/>`;
  const edgeById = new Map(l.edges.map((e) => [e.index, e]));
  const nodeById = new Map(l.nodes.map((n) => [n.id, n]));
  const offY = opts.title ? TITLE_H : 0;

  // 같은 엣지가 다시 쓰이면 이전 라벨을 그때 숨긴다
  const uses = new Map<number, number[]>();
  tl.steps.forEach((s) => s.edges.forEach((e) => uses.set(e.edgeIndex, [...(uses.get(e.edgeIndex) ?? []), s.start])));

  let base = "", hl = "", labels = "", dots = "";
  for (const e of l.edges) base += `<path id="e${e.index}" d="${e.d}" class="edge"/>`;

  for (const s of tl.steps)
    for (const e of s.edges) {
      const le = edgeById.get(e.edgeIndex);
      if (!le) continue;
      const t0 = s.start, t1 = s.start + e.duration * 0.85;
      const end = total - FADE;
      const nextUse = (uses.get(e.edgeIndex) ?? []).find((t) => t > t0) ?? end;
      const on = `0;${kt(t0)};${kt(t0)};${kt(end)};1`;
      hl += `<path d="${le.d}" class="hl ${e.kind}" opacity="0">${anim("opacity", "0;0;1;1;0", on)}</path>`;
      dots += `<circle r="7" class="dot ${e.kind}" opacity="0">` +
        `<animateMotion dur="${total}s" repeatCount="indefinite" keyPoints="0;0;0;1;1;1" keyTimes="0;${kt(t0)};${kt(t0)};${kt(t1)};${kt(t1)};1" calcMode="linear"><mpath href="#e${e.edgeIndex}"/></animateMotion>` +
        anim("opacity", "0;0;1;1;0;0", `0;${kt(t0)};${kt(t0)};${kt(t1)};${kt(Math.min(t1 + 0.05, end))};1`) + `</circle>`;
      if (e.label)
        labels += `<text x="${le.mid.x}" y="${le.mid.y - 6}" class="lbl" opacity="0">${esc(`${s.index + 1}. ${e.label}`)}` +
          anim("opacity", "0;0;1;1;0;0", `0;${kt(t0)};${kt(t0)};${kt(nextUse)};${kt(nextUse)};1`) + `</text>`;
      if (e.kind === "fail") {
        const n = nodeById.get(e.to);
        if (n) dots += `<text x="${n.x + n.w / 2}" y="${n.y - 8}" class="x" opacity="0">✕${anim("opacity", "0;0;1;1;0", `0;${kt(t1)};${kt(t1)};${kt(end)};1`)}</text>`;
      }
    }

  const nodes = l.nodes.map((n) => nodeMarkup(n, opts.icons)).join("");

  const desc = tl.steps.flatMap((s) => s.edges.map((e) =>
    `${s.index + 1}. ${e.from} → ${e.to}${e.label ? `: ${e.label}` : ""}${e.kind === "fail" ? " (실패)" : ""}`)).join("; ");

  const W = l.width, H = l.height + offY;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" font-family="Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif">` +
    `<title>${esc(opts.title ?? "ene diagram")}</title><desc>${esc(desc)}</desc><style>${STYLE}</style>` +
    `<rect width="100%" height="100%" class="bg"/>` +
    (opts.title ? `<text x="40" y="34" class="t">${esc(opts.title)}</text>` : "") +
    `<g transform="translate(0 ${offY})">${(l.groups ?? []).map(groupMarkup).join("")}${base}${nodes}${hl}${labels}${dots}</g></svg>`;
}
