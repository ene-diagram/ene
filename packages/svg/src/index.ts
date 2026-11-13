import { buildTimeline, isTheme, type Document, type PathChoice, type Timeline } from "@ene-diagram/core";
import type { Lang, ResolvedIcon } from "@ene-diagram/core";
import { themeClass, themeCss, type ThemeName } from "./themes.js";
import {
  edgeFor,
  layoutSequence,
  textWidth,
  type LEdge,
  type LFrame,
  type LGroup,
  type LNode,
  type Layout,
} from "@ene-diagram/layout";

/** Path id: per unique edge for flow, per step and index for sequence */
export const pathId = (e: LEdge) => (e.step === undefined ? `e${e.index}` : `s${e.step}_${e.k}`);

const lifelinesMarkup = (l: Layout) =>
  (l.lifelines ?? []).map((v) => `<line x1="${v.x}" y1="${v.y1}" x2="${v.x}" y2="${v.y2}" class="life"/>`).join("");
const framesMarkup = (l: Layout) =>
  (l.frames ?? [])
    .map(
      (f: LFrame) =>
        `<g><rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="6" class="frame"/>` +
        `<text x="${f.x + 8}" y="${f.y + 14}" class="fl">${esc(f.label)}</text></g>`,
    )
    .join("");
/** Sequence lifelines and branch frames */
export function sequenceMarkup(l: Layout): string {
  return framesMarkup(l) + lifelinesMarkup(l);
}

export interface SvgOptions {
  title?: string;
  icons?: Map<string, ResolvedIcon>;
  /** Show step notes in a caption line under the diagram (default true) */
  notes?: boolean;
  /** Colour theme (the document's `theme` setting; default "default") */
  theme?: ThemeName;
  /** Language of the accessible description (default "en") */
  lang?: Lang;
}

const ICON = 24,
  ICON_PAD = 14;

/** Node shapes (box, pill, cylinder, queue, circle) — fill/stroke are passed in */
function shapeMarkup(n: LNode, attrs: string): string {
  const { x, y, w, h } = n;
  switch (n.shape) {
    case "round":
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ${attrs}/>`;
    case "circle":
      return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${attrs}/>`;
    case "db": {
      const e = 8;
      return (
        `<path d="M${x},${y + e} A${w / 2},${e} 0 0,1 ${x + w},${y + e} V${y + h - e} A${w / 2},${e} 0 0,1 ${x},${y + h - e} Z" ${attrs}/>` +
        `<path d="M${x},${y + e} A${w / 2},${e} 0 0,0 ${x + w},${y + e}" fill="none" ${attrs.replace(/fill="[^"]*"/, "")}/>`
      );
    }
    case "queue": {
      const lines = [0, 1, 2]
        .map((i) => {
          const lx = x + w - 10 - i * 7;
          return `<line x1="${lx}" y1="${y + 8}" x2="${lx}" y2="${y + h - 8}" ${attrs.replace(/fill="[^"]*"/, "")}/>`;
        })
        .join("");
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" ${attrs}/>${lines}`;
    }
    default:
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" ${attrs}/>`;
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
  const body =
    shapeMarkup(n, 'class="node"') +
    (c ? shapeMarkup(n, `fill="${c}" fill-opacity="0.1" stroke="${c}" stroke-width="1.5"`) : "");
  return `<g>${body}${iconSvg}<text x="${lx}" y="${cy}" class="nl">${esc(n.label)}</text></g>`;
}

/** Group box (dashed border + top-left label) */
export function groupMarkup(g: LGroup): string {
  const c = g.color ? esc(g.color) : "var(--line)";
  return (
    `<g><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="14" class="grp" fill="${c}" fill-opacity="0.05" stroke="${c}" stroke-width="1.5" stroke-dasharray="6 4"/>` +
    `<text x="${g.x + 14}" y="${g.y + 21}" class="gl" fill="${c}">${esc(g.label)}</text></g>`
  );
}

/** Icon sizes come from third-party JSON: force a finite positive number */
const dim = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 16;
};
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
  if (
    icon.body.startsWith(DATA_IMAGE) &&
    /^<image href="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]*" width="[\d.]+" height="[\d.]+"\/>$/.test(icon.body)
  )
    return icon.body;
  const w = dim(icon.width),
    h = dim(icon.height);
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" color="#3a4048">${String(icon.body)}</svg>`;
  return `${DATA_IMAGE}${toBase64(doc)}" width="${w}" height="${h}"/>`;
}

/** External SVG document as an icon: read the viewBox size and wrap it as a data URI image (blocks script execution) */
export function iconFromSvgText(text: string): ResolvedIcon {
  const vb = text.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  const width = vb ? Number(vb[1]) : 24,
    height = vb ? Number(vb[2]) : 24;
  return { body: `${DATA_IMAGE}${toBase64(text)}" width="${width}" height="${height}"/>`, width, height };
}

const TITLE_H = 44,
  HOLD = 1.5,
  FADE = 0.3;
/** Height of the line that says which path is playing (several paths in one file) */
const CAP_H = 26;
/** Caption under the diagram that shows step notes: padding and line height */
const NOTE_PAD = 22,
  NOTE_LINE = 18,
  NOTE_X = 40;

/** Greedy word wrap by the estimated text width (13px caption ≈ 0.8 of the 15px node label estimate) */
export function wrapNote(s: string, width: number): string[] {
  const max = Math.max(80, width),
    w = (t: string) => textWidth(t) * 0.8;
  const lines: string[] = [];
  let cur = "";
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && w(next) > max) {
      lines.push(cur);
      cur = word;
    } else cur = next;
    // A single word longer than the line is split by characters
    while (w(cur) > max && [...cur].length > 1) {
      const cs = [...cur];
      let k = cs.length - 1;
      while (k > 1 && w(cs.slice(0, k).join("")) > max) k--;
      lines.push(cs.slice(0, k).join(""));
      cur = cs.slice(k).join("");
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Arrowhead: follows the line color (context-stroke) */
export const ARROW_DEFS = `<defs><marker id="ene-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="context-stroke"/></marker></defs>`;

export const STYLE = `
  .bg{fill:var(--bg)} .node{fill:var(--node);stroke:var(--line);stroke-width:1.5}
  .nl{text-anchor:middle;dominant-baseline:central;font-size:15px;font-weight:600;fill:var(--fg)}
  .edge{fill:none;stroke:var(--faint);stroke-width:1.5;stroke-dasharray:4 4}
  .hl{fill:none;stroke-width:2.5} .hl.ok{stroke:var(--ok)} .hl.fail{stroke:var(--fail)} .hl.reply{stroke:var(--reply);stroke-dasharray:7 5}
  .hl.async{stroke:var(--async);stroke-dasharray:1 5;stroke-linecap:round}
  .dot.ok{fill:var(--ok)} .dot.fail{fill:var(--fail)} .dot.reply{fill:var(--reply)} .dot.async{fill:var(--async)}
  .lbl{text-anchor:middle;font-size:12px;fill:var(--fg2);paint-order:stroke;stroke:var(--bg);stroke-width:4px}
  .x{text-anchor:middle;font-size:18px;font-weight:700;fill:var(--fail)}
  .t{font-size:17px;font-weight:700;fill:var(--fg)} .gl{font-size:12px;font-weight:600}
  .life{stroke:var(--line);stroke-width:1.2;stroke-dasharray:5 5} .frame{fill:var(--ok);fill-opacity:.04;stroke:var(--line);stroke-width:1.2}
  .fl{font-size:11px;font-weight:700;fill:var(--fg2)} .note{font-size:13px;fill:var(--fg2)}

  @media (prefers-reduced-motion: reduce){.dot,.x,.note{display:none}.hl,.lbl{opacity:1 !important}}`;

/** Extra rules when several paths play in one file */
const PATHS_STYLE = `
  .cap{font-size:13px;font-weight:600;fill:var(--fg2)}
  @media (prefers-reduced-motion: reduce){.alt{display:none}.part{opacity:1 !important}}`;

/** Length of one loop of the exported animation: the timeline plus a hold on the final state */
export const loopSeconds = (tl: Timeline) => Math.max(tl.total + HOLD, 0.1);

// Timing rules shared by the SVG renderer and the browser player, so both animate the same way.
/** The moving dot reaches the target at this fraction of the edge's duration */
export const DOT_ARRIVAL = 0.85;
/** When the dot of an edge starting at `start` arrives */
export const arrivalTime = (start: number, duration: number) => start + duration * DOT_ARRIVAL;
/** Start times of every step that uses each edge, by edge index */
export function edgeUses(tl: Timeline): Map<number, number[]> {
  const uses = new Map<number, number[]>();
  for (const s of tl.steps) for (const e of s.edges) uses.set(e.edgeIndex, [...(uses.get(e.edgeIndex) ?? []), s.start]);
  return uses;
}
/** When an edge's label hides: the next step that reuses the edge, else `fallback` */
export const nextUseAfter = (uses: Map<number, number[]>, edgeIndex: number, t: number, fallback: number) =>
  (uses.get(edgeIndex) ?? []).find((x) => x > t) ?? fallback;

/** One path through the diagram, for `renderSvgPaths` */
export interface SvgPart {
  layout: Layout;
  timeline: Timeline;
  /** Shown while this path plays when there are several (the branch arms it takes) */
  caption?: string;
}

/** Length of one loop when the paths play one after another */
export const pathsSeconds = (parts: SvgPart[]) => parts.reduce((sum, p) => sum + loopSeconds(p.timeline), 0);

/**
 * Parts for `renderSvgPaths` from `enumeratePaths(doc)`. Pass the flow layout (it is the same for every path);
 * leave it out for `diagram sequence`, which is laid out per path.
 */
export function svgParts(doc: Document, paths: PathChoice[], flow?: Layout): SvgPart[] {
  return paths.map((p) => {
    const timeline = buildTimeline(doc, { choices: p.choices });
    return { layout: flow ?? layoutSequence(doc, timeline), timeline, caption: p.labels.join(", ") };
  });
}

export function renderSvg(l: Layout, tl: Timeline, opts: SvgOptions = {}): string {
  return renderSvgPaths([{ layout: l, timeline: tl }], opts);
}

/**
 * One self-playing SVG that plays each path in turn, then loops. Flow diagrams pass the same layout for every
 * path (nodes and edges are drawn once); sequence diagrams pass one layout per path (rows differ), and the
 * rows of the path that is playing are shown.
 */
export function renderSvgPaths(parts: SvgPart[], opts: SvgOptions = {}): string {
  if (!parts.length) throw new Error("renderSvgPaths needs at least one path");
  const theme: ThemeName = opts.theme && isTheme(opts.theme) ? opts.theme : "default";
  const multi = parts.length > 1;
  const total = pathsSeconds(parts);
  const kt = (t: number) => Math.min(1, Math.max(0, t / total)).toFixed(4);
  const anim = (attr: string, values: string, times: string) =>
    `<animate attributeName="${attr}" values="${values}" keyTimes="${times}" dur="${total}s" repeatCount="indefinite"/>`;
  /** Hidden, shown at once from `a`, hidden at once at `b` */
  const between = (a: number, b: number) => anim("opacity", "0;0;1;1;0;0", `0;${kt(a)};${kt(a)};${kt(b)};${kt(b)};1`);
  const first = parts[0].layout;
  // Same layout object for every path: draw edges, lifelines and frames once
  const shared = parts.every((p) => p.layout === first);
  const tallest = parts.reduce((a, p) => (p.layout.height > a.height ? p.layout : a), first);
  const W = Math.max(...parts.map((p) => p.layout.width)),
    bodyH = tallest.height;
  const offY = opts.title ? TITLE_H : 0;
  const capH = multi ? CAP_H : 0;
  const withNotes = opts.notes !== false;
  const wrapAll = parts.map((p) =>
    withNotes ? p.timeline.steps.filter((s) => s.note).map((s) => wrapNote(s.note!, W - NOTE_X * 2)) : [],
  );
  const noteLines = Math.max(0, ...wrapAll.flat().map((w) => w.length));
  const noteH = noteLines ? NOTE_PAD + NOTE_LINE * noteLines : 0;

  let statics = "",
    dynamics = "";
  const descs: string[] = [];
  let off = 0;
  parts.forEach((part, pi) => {
    const { layout: l, timeline: tl } = part;
    const len = loopSeconds(tl);
    // This path fades out between `end` and `end + FADE`
    const end = off + len - FADE;
    const last = pi === parts.length - 1;
    /** Shown at once from `t0`, fades out when this path ends */
    const untilEnd = (t0: number) =>
      last
        ? anim("opacity", "0;0;1;1;0", `0;${kt(t0)};${kt(t0)};${kt(end)};1`)
        : anim("opacity", "0;0;1;1;0;0", `0;${kt(t0)};${kt(t0)};${kt(end)};${kt(end + FADE)};1`);
    const pid = (e: LEdge) => (multi && !shared ? `p${pi}${pathId(e)}` : pathId(e));
    const nodeById = new Map(l.nodes.map((n) => [n.id, n]));

    // When the same edge is reused, hide the previous label then
    const uses = edgeUses(tl);

    let base = "",
      hl = "",
      labels = "",
      dots = "";
    if (pi === 0 || !shared) for (const e of l.edges) base += `<path id="${pid(e)}" d="${e.d}" class="edge"/>`;

    for (const s of tl.steps)
      for (const [k, e] of s.edges.entries()) {
        const le = edgeFor(l, s.index, k, e.edgeIndex);
        if (!le) continue;
        const t0 = off + s.start,
          t1 = arrivalTime(t0, e.duration);
        // Sequence has separate rows, so keep the label to the end
        const reuse = nextUseAfter(uses, e.edgeIndex, s.start, Number.NaN);
        const nextUse = le.step !== undefined || Number.isNaN(reuse) ? end : off + reuse;
        hl += `<path d="${le.d}" class="hl ${e.kind}" marker-end="url(#ene-ah)" opacity="0">${untilEnd(t0)}</path>`;
        dots +=
          `<circle r="7" class="dot ${e.kind}" opacity="0">` +
          `<animateMotion dur="${total}s" repeatCount="indefinite" keyPoints="0;0;0;1;1;1" keyTimes="0;${kt(t0)};${kt(t0)};${kt(t1)};${kt(t1)};1" calcMode="linear"><mpath href="#${pid(le)}"/></animateMotion>` +
          anim("opacity", "0;0;1;1;0;0", `0;${kt(t0)};${kt(t0)};${kt(t1)};${kt(Math.min(t1 + 0.05, end))};1`) +
          `</circle>`;
        if (e.label)
          labels +=
            `<text x="${le.mid.x}" y="${le.mid.y - 6}" class="lbl" opacity="0">${esc(`${s.index + 1}. ${e.label}`)}` +
            between(t0, nextUse) +
            `</text>`;
        if (e.kind === "fail") {
          const endPt = le.d.match(/([-\d.]+),([-\d.]+)\s*$/);
          const n =
            le.step !== undefined && endPt
              ? { x: Number(endPt[1]) - 10, y: Number(endPt[2]) + 4, w: 20 }
              : nodeById.get(e.to);
          if (n) dots += `<text x="${n.x + n.w / 2}" y="${n.y - 8}" class="x" opacity="0">✕${untilEnd(t1)}</text>`;
        }
      }

    // Step notes: one caption line under the diagram, showing the note of the step that is playing
    let notes = "";
    const noted = withNotes ? tl.steps.filter((s) => s.note) : [];
    noted.forEach((s, i) => {
      const next = tl.steps[s.index + 1] ? off + tl.steps[s.index + 1].start : end;
      const spans = wrapAll[pi][i]
        .map((line, k) => `<tspan x="${NOTE_X}" dy="${k ? NOTE_LINE : 0}">${esc(line)}</tspan>`)
        .join("");
      notes +=
        `<text x="${NOTE_X}" y="${bodyH + capH + NOTE_PAD / 2 + NOTE_LINE * 0.7}" class="note" opacity="0">${spans}` +
        between(off + s.start, next) +
        `</text>`;
    });

    // Which path is playing: "2/3 · cache miss"
    const cap = multi
      ? `<text x="${NOTE_X}" y="${bodyH + CAP_H * 0.6}" class="cap${pi ? "" : " part"}" opacity="0">` +
        esc(`${pi + 1}/${parts.length}${part.caption ? ` · ${part.caption}` : ""}`) +
        between(off, off + len) +
        `</text>`
      : "";

    if (!multi) {
      statics += sequenceMarkup(l) + base;
      dynamics += hl + labels + dots + notes;
    } else {
      // Paths after the first are hidden when motion is reduced (`.alt`), so one complete path is shown
      const alt = pi ? ' class="alt"' : "";
      if (shared) statics += pi ? "" : sequenceMarkup(l) + base;
      else
        statics += `<g class="part${pi ? " alt" : ""}" opacity="0">${framesMarkup(l)}${base}${between(off, off + len)}</g>`;
      dynamics += `<g${alt}>${hl}${labels}${dots}${notes}${cap}</g>`;
    }

    const steps = tl.steps
      .flatMap((s) =>
        s.edges
          .map(
            (e) =>
              `${s.index + 1}. ${e.from} → ${e.to}${e.label ? `: ${e.label}` : ""}${e.kind === "fail" ? (opts.lang === "ko" ? " (실패)" : " (fail)") : e.kind === "async" ? " (async)" : ""}`,
          )
          .concat(s.note && withNotes ? [`(${s.note})`] : [])
          .join(" "),
      )
      .join("; ");
    descs.push(multi ? `[${pi + 1}/${parts.length}${part.caption ? ` ${part.caption}` : ""}] ${steps}` : steps);
    off += len;
  });

  // Sequence with several paths: lifelines once, as long as the longest path
  if (multi && !shared) statics = lifelinesMarkup(tallest) + statics;
  const nodes = first.nodes.map((n) => nodeMarkup(n, opts.icons)).join("");
  const H = bodyH + offY + capH + noteH;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="ene ${themeClass(theme)}" role="img" font-family="Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif">` +
    `<title>${esc(opts.title ?? "ene diagram")}</title><desc>${esc(descs.join(" | "))}</desc><style>${STYLE}${multi ? PATHS_STYLE : ""}
  ${themeCss(theme, true)}</style>${ARROW_DEFS}` +
    `<rect width="100%" height="100%" class="bg"/>` +
    (opts.title ? `<text x="40" y="34" class="t">${esc(opts.title)}</text>` : "") +
    `<g transform="translate(0 ${offY})">${(first.groups ?? []).map(groupMarkup).join("")}${statics}${nodes}${dynamics}</g></svg>`
  );
}
export { THEMES, THEME_VARS, themeClass, themeCss, type ThemeName, type ThemeVars } from "./themes.js";
export {
  fetchIcon,
  iconFromUntrustedSvg,
  ICON_DEFAULTS,
  type IconFetchOptions,
  type IconLoadResult,
} from "./icon-loader.js";
