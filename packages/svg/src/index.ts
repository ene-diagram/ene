import type { Timeline } from "@ene/core";
import type { ResolvedIcon } from "@ene/core";
import { edgeFor, type LEdge, type LFrame, type LGroup, type LNode, type Layout } from "@ene/layout";

/** Path id: per unique edge for flow, per step and index for sequence */
export const pathId = (e: LEdge) => (e.step === undefined ? `e${e.index}` : `s${e.step}_${e.k}`);

/** Sequence lifelines and branch frames */
export function sequenceMarkup(l: Layout): string {
  const lines = (l.lifelines ?? []).map((v) => `<line x1="${v.x}" y1="${v.y1}" x2="${v.x}" y2="${v.y2}" class="life"/>`).join("");
  const frames = (l.frames ?? []).map((f: LFrame) =>
    `<g><rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="6" class="frame"/>` +
    `<text x="${f.x + 8}" y="${f.y + 14}" class="fl">${esc(f.label)}</text></g>`).join("");
  return frames + lines;
}

export interface SvgOptions { title?: string; icons?: Map<string, ResolvedIcon> }

const ICON = 24, ICON_PAD = 14;

/** Node shapes (box, pill, cylinder, queue, circle) — fill/stroke are passed in */
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

/** Markup for one node (shape + color + icon + label). The player uses the same one */
export function nodeMarkup(n: LNode, icons: Map<string, ResolvedIcon> = new Map()): string {
  const icon = n.icon ? icons.get(n.icon) : undefined;
  const cy = n.y + n.h / 2;
  const iconSvg = icon
    ? `<svg x="${n.x + ICON_PAD}" y="${cy - ICON / 2}" width="${ICON}" height="${ICON}" viewBox="0 0 ${dim(icon.width)} ${dim(icon.height)}">${safeIconBody(icon)}</svg>`
    : "";
  const lx = icon ? (n.x + ICON_PAD + ICON + n.x + n.w) / 2 : n.x + n.w / 2;
  const c = n.color ? esc(n.color) : undefined;
  const body = shapeMarkup(n, 'class="node"') +
    (c ? shapeMarkup(n, `fill="${c}" fill-opacity="0.1" stroke="${c}" stroke-width="1.5"`) : "");
  return `<g>${body}${iconSvg}<text x="${lx}" y="${cy}" class="nl">${esc(n.label)}</text></g>`;
}

/** Group box (dashed border + top-left label) */
export function groupMarkup(g: LGroup): string {
  const c = g.color ? esc(g.color) : "var(--line)";
  return `<g><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="14" class="grp" fill="${c}" fill-opacity="0.05" stroke="${c}" stroke-width="1.5" stroke-dasharray="6 4"/>` +
    `<text x="${g.x + 14}" y="${g.y + 21}" class="gl" fill="${c}">${esc(g.label)}</text></g>`;
}

declare const btoa: (s: string) => string;
declare const TextEncoder: { new (): { encode(s: string): Uint8Array } };
/** Icon sizes come from third-party JSON: force a finite positive number */
const dim = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 16; };
const DATA_IMAGE = '<image href="data:image/svg+xml;base64,';
const toBase64 = (text: string) => {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
};
/**
 * Icon markup that is safe to inline. Bodies from icon packs are third-party markup, so they are
 * wrapped as a data-URI `<image>` (an isolated document: no scripts, no event handlers, no DOM access).
 * Bodies already produced by iconFromSvgText are passed through.
 */
export function safeIconBody(icon: ResolvedIcon): string {
  if (icon.body.startsWith(DATA_IMAGE) && /^<image href="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]*" width="[\d.]+" height="[\d.]+"\/>$/.test(icon.body))
    return icon.body;
  const w = dim(icon.width), h = dim(icon.height);
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" color="#3a4048">${String(icon.body)}</svg>`;
  return `${DATA_IMAGE}${toBase64(doc)}" width="${w}" height="${h}"/>`;
}

/** External SVG document as an icon: read the viewBox size and wrap it as a data URI image (blocks script execution) */
export function iconFromSvgText(text: string): ResolvedIcon {
  const vb = text.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  const width = vb ? Number(vb[1]) : 24, height = vb ? Number(vb[2]) : 24;
  return { body: `${DATA_IMAGE}${toBase64(text)}" width="${width}" height="${height}"/>`, width, height };
}

const TITLE_H = 44, HOLD = 1.5, FADE = 0.3;

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Arrowhead: follows the line color (context-stroke) */
export const ARROW_DEFS = `<defs><marker id="ene-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="context-stroke"/></marker></defs>`;

export const STYLE = `
  .bg{fill:var(--bg)} .node{fill:var(--node);stroke:var(--line);stroke-width:1.5}
  .nl{text-anchor:middle;dominant-baseline:central;font-size:15px;font-weight:600;fill:var(--fg)}
  .edge{fill:none;stroke:var(--faint);stroke-width:1.5;stroke-dasharray:4 4}
  .hl{fill:none;stroke-width:2.5} .hl.ok{stroke:var(--ok)} .hl.fail{stroke:var(--fail)} .hl.reply{stroke:var(--reply);stroke-dasharray:7 5}
  .dot.ok{fill:var(--ok)} .dot.fail{fill:var(--fail)} .dot.reply{fill:var(--reply)}
  .lbl{text-anchor:middle;font-size:12px;fill:var(--fg2);paint-order:stroke;stroke:var(--bg);stroke-width:4px}
  .x{text-anchor:middle;font-size:18px;font-weight:700;fill:var(--fail)}
  .t{font-size:17px;font-weight:700;fill:var(--fg)} .gl{font-size:12px;font-weight:600}
  .life{stroke:var(--line);stroke-width:1.2;stroke-dasharray:5 5} .frame{fill:var(--ok);fill-opacity:.04;stroke:var(--line);stroke-width:1.2}
  .fl{font-size:11px;font-weight:700;fill:var(--fg2)}
  svg{--bg:#fbfcfd;--node:#fff;--line:#c1c8d2;--faint:#d9dde3;--fg:#1c2024;--fg2:#3a4048;--ok:#3e63dd;--fail:#e5484d;--reply:#30a46c}
  @media (prefers-color-scheme: dark){svg{--bg:#111113;--node:#1c1d21;--line:#3b3e45;--faint:#2e3036;--fg:#edeef0;--fg2:#b0b4ba;--ok:#7b9bff;--fail:#ff6369;--reply:#4cc38a}}
  @media (prefers-reduced-motion: reduce){.dot,.x{display:none}.hl,.lbl{opacity:1 !important}}`;

export function renderSvg(l: Layout, tl: Timeline, opts: SvgOptions = {}): string {
  const total = Math.max(tl.total + HOLD, 0.1);
  const kt = (t: number) => (Math.min(1, Math.max(0, t / total))).toFixed(4);
  const anim = (attr: string, values: string, times: string) =>
    `<animate attributeName="${attr}" values="${values}" keyTimes="${times}" dur="${total}s" repeatCount="indefinite"/>`;
  const nodeById = new Map(l.nodes.map((n) => [n.id, n]));
  const offY = opts.title ? TITLE_H : 0;

  // When the same edge is reused, hide the previous label then
  const uses = new Map<number, number[]>();
  tl.steps.forEach((s) => s.edges.forEach((e) => uses.set(e.edgeIndex, [...(uses.get(e.edgeIndex) ?? []), s.start])));

  let base = "", hl = "", labels = "", dots = "";
  for (const e of l.edges) base += `<path id="${pathId(e)}" d="${e.d}" class="edge"/>`;

  for (const s of tl.steps)
    for (const [k, e] of s.edges.entries()) {
      const le = edgeFor(l, s.index, k, e.edgeIndex);
      if (!le) continue;
      const t0 = s.start, t1 = s.start + e.duration * 0.85;
      const end = total - FADE;
      // Sequence has separate rows, so keep the label to the end
      const nextUse = le.step !== undefined ? end : (uses.get(e.edgeIndex) ?? []).find((t) => t > t0) ?? end;
      const on = `0;${kt(t0)};${kt(t0)};${kt(end)};1`;
      hl += `<path d="${le.d}" class="hl ${e.kind}" marker-end="url(#ene-ah)" opacity="0">${anim("opacity", "0;0;1;1;0", on)}</path>`;
      dots += `<circle r="7" class="dot ${e.kind}" opacity="0">` +
        `<animateMotion dur="${total}s" repeatCount="indefinite" keyPoints="0;0;0;1;1;1" keyTimes="0;${kt(t0)};${kt(t0)};${kt(t1)};${kt(t1)};1" calcMode="linear"><mpath href="#${pathId(le)}"/></animateMotion>` +
        anim("opacity", "0;0;1;1;0;0", `0;${kt(t0)};${kt(t0)};${kt(t1)};${kt(Math.min(t1 + 0.05, end))};1`) + `</circle>`;
      if (e.label)
        labels += `<text x="${le.mid.x}" y="${le.mid.y - 6}" class="lbl" opacity="0">${esc(`${s.index + 1}. ${e.label}`)}` +
          anim("opacity", "0;0;1;1;0;0", `0;${kt(t0)};${kt(t0)};${kt(nextUse)};${kt(nextUse)};1`) + `</text>`;
      if (e.kind === "fail") {
        const endPt = le.d.match(/([-\d.]+),([-\d.]+)\s*$/);
        const n = le.step !== undefined && endPt
          ? { x: Number(endPt[1]) - 10, y: Number(endPt[2]) + 4, w: 20 }
          : nodeById.get(e.to);
        if (n) dots += `<text x="${n.x + n.w / 2}" y="${n.y - 8}" class="x" opacity="0">✕${anim("opacity", "0;0;1;1;0", `0;${kt(t1)};${kt(t1)};${kt(end)};1`)}</text>`;
      }
    }

  const nodes = l.nodes.map((n) => nodeMarkup(n, opts.icons)).join("");

  const desc = tl.steps.flatMap((s) => s.edges.map((e) =>
    `${s.index + 1}. ${e.from} → ${e.to}${e.label ? `: ${e.label}` : ""}${e.kind === "fail" ? " (실패)" : ""}`)).join("; ");

  const W = l.width, H = l.height + offY;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" font-family="Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif">` +
    `<title>${esc(opts.title ?? "ene diagram")}</title><desc>${esc(desc)}</desc><style>${STYLE}</style>${ARROW_DEFS}` +
    `<rect width="100%" height="100%" class="bg"/>` +
    (opts.title ? `<text x="40" y="34" class="t">${esc(opts.title)}</text>` : "") +
    `<g transform="translate(0 ${offY})">${(l.groups ?? []).map(groupMarkup).join("")}${sequenceMarkup(l)}${base}${nodes}${hl}${labels}${dots}</g></svg>`;
}
