import {
  buildTimeline,
  checkIcons,
  formatAll,
  isIconUrl,
  isTheme,
  parse,
  resolveIcon,
  validateIconPack,
  type IconPack,
  type Lang,
  type ResolvedIcon,
  type Timeline,
} from "@ene-diagram/core";
import { edgeFor, layout as computeLayout, layoutSequence, type ElkApi, type Layout } from "@ene-diagram/layout";
import {
  ARROW_DEFS,
  arrivalTime,
  edgeUses,
  nextUseAfter,
  STYLE,
  esc,
  renderSvg,
  themeClass,
  themeCss,
  type ThemeName,
  fetchIcon,
  groupMarkup,
  iconFromUntrustedSvg,
  nodeMarkup,
  sequenceMarkup,
  type IconFetchOptions,
  type IconLoadResult,
} from "@ene-diagram/svg";
import { createController, type Controller } from "./controller.js";

export interface PlayerOptions {
  lang?: Lang;
  autoplay?: boolean;
  loop?: boolean;
  /** Initial branch choices: one zero-based arm per branch, in order */
  choices?: number[];
  /** Called when the viewer picks another arm in a branch menu (not for `setChoices`) */
  onChoicesChange?: (choices: number[]) => void;
  /**
   * Dim the nodes and edges that are not part of the step playing now (nothing moves).
   * `"auto"` (default) turns it on for diagrams with at least FOCUS_AUTO_NODES nodes
   */
  focus?: boolean | "auto";
  /** Colour theme; overrides the document's `theme` setting */
  theme?: ThemeName;
  /** Open paused at this step (1 = the first step, as the player shows it). Out-of-range values are clamped */
  step?: number;
  /** Zoom buttons, Ctrl/⌘ + wheel zoom and drag to pan (default true) */
  zoom?: boolean;
}

/** Largest zoom factor */
export const MAX_ZOOM = 4;
const ZOOM_STEP = 1.5;

/** Node count from which `focus: "auto"` dims inactive parts */
export const FOCUS_AUTO_NODES = 12;
/** Opacity of dimmed parts in focus mode */
const DIM = 0.2;

// ---- ELK lazy loading: load ene-elk.js next to ene.js once, on first need ----
let elkUrl: string | undefined;
let elkPromise: Promise<ElkApi> | undefined;
/** Set the location of ene-elk.js (default: same folder as ene.js) */
export function setElkUrl(url: string): void {
  elkUrl = url;
}
function loadElk(): Promise<ElkApi> {
  const w = window as unknown as { ELK?: new () => ElkApi };
  if (w.ELK) return Promise.resolve(new w.ELK());
  elkPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = elkUrl ?? "ene-elk.js";
    s.onload = () => (w.ELK ? resolve(new w.ELK()) : reject(new Error("ene-elk.js did not define ELK")));
    s.onerror = () => {
      elkPromise = undefined;
      reject(new Error(`cannot load ${s.src}`));
    };
    document.head.appendChild(s);
  });
  return elkPromise;
}
export interface Player {
  controller: Controller;
  /** Current branch choices (a copy) */
  readonly choices: number[];
  setChoices(choices: number[]): void;
  /** Step that is playing: 1 = the first step, 0 when the diagram has no steps */
  readonly step: number;
  /** Pause at the start of a step (1 = the first step; clamped) */
  goto(step: number): void;
  /** Zoom factor, 1 (whole diagram) to MAX_ZOOM */
  readonly zoom: number;
  /** Zoom to a factor (clamped to 1..MAX_ZOOM) around the centre of the view */
  setZoom(zoom: number): void;
  /** The self-playing animated SVG (as `ene -o x.svg` writes it) for the current branch choices */
  toSvg(): string;
  destroy(): void;
}

const NS = "http://www.w3.org/2000/svg";
const TITLE_H = 44;

const PLAYER_CSS = `
.ene-player{display:inline-flex;flex-direction:column;gap:8px;max-width:100%;outline:none;font-family:Pretendard,-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif}
.ene-player:focus-visible{box-shadow:0 0 0 2px #3e63dd;border-radius:10px}
.ene-player svg{max-width:100%;height:auto;border-radius:10px}
.ene-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:13px;color:#3a4048}
.ene-bar button,.ene-bar select{font:inherit;padding:4px 10px;border:1px solid #c1c8d2;border-radius:6px;background:#fff;color:#1c2024;cursor:pointer}
.ene-bar button:hover{background:#f1f3f5}
.ene-bar button:disabled{opacity:.45;cursor:default}
.ene-seek{width:0;min-width:100%;margin:0;accent-color:#3e63dd;cursor:pointer}
.ene-player svg.ene-zoomed{cursor:grab;touch-action:none}.ene-player svg.ene-panning{cursor:grabbing}
.ene-opt{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
.ene-note{font-size:14px;line-height:1.5;color:#3a4048;min-height:1.5em;width:0;min-width:100%}
.ene-step{margin-left:6px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px}
.ene-error{color:#e5484d;background:#fff5f5;border:1px solid #ffd1d1;border-radius:8px;padding:12px;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre;overflow:auto}
.ene-focus .ene-n,.ene-focus .edge{transition:opacity .25s}.ene-focus .ene-dim{opacity:${DIM}}
@media (prefers-reduced-motion: reduce){.ene-focus .ene-n,.ene-focus .edge{transition:none}}
@media (prefers-color-scheme: dark){.ene-note{color:#b0b4ba}.ene-bar{color:#b0b4ba}.ene-bar button,.ene-bar select{background:#1c1d21;color:#edeef0;border-color:#3b3e45}.ene-error{background:#2a1215;border-color:#5c1a1f;color:#ff9592}}`;

export interface IconPackSource {
  name?: string;
  pack?: IconPack;
  loader?: () => Promise<IconPack>;
}
const packSources: IconPackSource[] = [];
let packsPromise: Promise<IconPack[]> | undefined;
const urlIcons = new Map<string, Promise<IconLoadResult>>();
let iconFetchOpts: Omit<IconFetchOptions, "fetch"> = {};
/** Configure external icon loading: timeout, size limit and an optional host allowlist */
export function setIconLoading(opts: Omit<IconFetchOptions, "fetch">): void {
  iconFetchOpts = { ...opts };
  urlIcons.clear();
}

/** Register icon packs (Iconify JSON). The loader is called once, when an icon is first needed */
export function registerIconPacks(sources: IconPackSource[]): void {
  packSources.push(...sources);
  packsPromise = undefined;
}
async function loadPacks(): Promise<IconPack[]> {
  packsPromise ??= Promise.all(
    packSources.map(async (s) => {
      let p: unknown;
      try {
        p = s.pack ?? (await s.loader?.());
      } catch (e) {
        console.warn(`ene: icon pack ${s.name ?? ""} failed to load: ${(e as Error).message}`);
        return undefined;
      }
      const errs = p === undefined ? [] : validateIconPack(p);
      if (errs.length) {
        console.warn(`ene: invalid icon pack ${s.name ?? ""}:\n  - ${errs.join("\n  - ")}`);
        return undefined;
      }
      return p as IconPack | undefined;
    }),
  ).then((ps) => ps.filter((p): p is IconPack => !!p));
  return packsPromise;
}
function loadUrlIcon(url: string): Promise<IconLoadResult> {
  if (!urlIcons.has(url)) {
    let p: Promise<IconLoadResult>;
    if (url.startsWith("data:")) {
      const m = url.match(/^data:image\/svg\+xml(;base64)?,(.*)$/s);
      try {
        p = Promise.resolve(
          m
            ? iconFromUntrustedSvg(m[1] ? atob(m[2]) : decodeURIComponent(m[2]))
            : { ok: false, reason: "only data:image/svg+xml URLs are supported" },
        );
      } catch {
        p = Promise.resolve({ ok: false, reason: "malformed data URL" });
      }
    } else {
      try {
        p = fetchIcon(new URL(url, document.baseURI).href, iconFetchOpts);
      } catch {
        p = Promise.resolve({ ok: false, reason: "invalid URL" });
      }
    }
    // Failed loads are not cached, so a later render can retry
    urlIcons.set(
      url,
      p.then((r) => {
        if (!r.ok) urlIcons.delete(url);
        return r;
      }),
    );
  }
  return urlIcons.get(url)!;
}

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === "undefined") return;
  const s = document.createElement("style");
  s.textContent = PLAYER_CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

const round = (v: number) => Math.round(v * 100) / 100;
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

// One live player per host element. `token` guards against overlapping async renders:
// only the most recent render() call for an element may touch it.
const hosts = new WeakMap<HTMLElement, { token: symbol; player?: Player }>();

/**
 * Create a player inside the target element. Shows error messages if there are diagnostic errors.
 * Rendering again into the same element destroys the previous player; if renders overlap,
 * only the latest one wins and superseded calls resolve to undefined without touching the element.
 */
export async function render(el: HTMLElement, source: string, opts: PlayerOptions = {}): Promise<Player | undefined> {
  injectCss();
  const prev = hosts.get(el);
  prev?.player?.destroy();
  const token = Symbol();
  hosts.set(el, { token });
  const stale = () => hosts.get(el)?.token !== token;
  const lang = opts.lang ?? (navigator.language.startsWith("ko") ? "ko" : "en");
  const { doc, diagnostics } = parse(source);
  el.replaceChildren();
  if (diagnostics.some((d) => d.severity === "error")) {
    const pre = document.createElement("pre");
    pre.className = "ene-error";
    pre.textContent = formatAll(source, diagnostics, lang);
    el.appendChild(pre);
    return undefined;
  }
  const needIcons = [...doc.nodes.values()].some((n) => n.icon);
  const packs = needIcons ? await loadPacks() : [];
  if (stale()) return undefined;
  const icons = new Map<string, ResolvedIcon>();
  const refs = [...new Set([...doc.nodes.values()].map((n) => n.icon).filter((i): i is string => !!i))];
  for (const ref of refs.filter((r) => !isIconUrl(r))) {
    const ic = resolveIcon(ref, packs);
    if (ic) icons.set(ref, ic);
  }
  const urlRefs = refs.filter(isIconUrl);
  const results = await Promise.all(urlRefs.map(loadUrlIcon));
  if (stale()) return undefined;
  results.forEach((r, i) => {
    if (r.ok) icons.set(urlRefs[i], r.icon);
    else console.warn(`ene: cannot load icon ${urlRefs[i]}: ${r.reason}`);
  });
  const iconWarnings = checkIcons(doc, packs);
  if (iconWarnings.length) console.warn(formatAll(source, iconWarnings, lang));
  const clampChoices = (c: number[]) => c.map((v) => (Number.isInteger(v) && v >= 0 ? v : 0));
  let choices: number[] = clampChoices(opts.choices ?? []);
  let tl = buildTimeline(doc, { choices });
  let lay: Layout;
  try {
    lay = doc.kind === "sequence" ? layoutSequence(doc, tl) : await computeLayout(doc, tl, { elk: await loadElk() });
  } catch (e) {
    if (stale()) return undefined;
    el.replaceChildren();
    const pre = document.createElement("pre");
    pre.className = "ene-error";
    pre.textContent = `ene: ${(e as Error).message}`;
    el.appendChild(pre);
    return undefined;
  }
  if (stale()) return undefined;
  el.replaceChildren();
  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const root = document.createElement("div");
  root.className = "ene-player";
  root.tabIndex = 0;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", doc.title ?? "ene diagram");

  const offY = doc.title ? TITLE_H : 0;
  const theme: ThemeName = [opts.theme, doc.theme].find((t): t is ThemeName => !!t && isTheme(t)) ?? "default";
  const svg = svgEl("svg", { role: "img", class: `ene ${themeClass(theme)}` });
  const staticG = svgEl("g", { transform: `translate(0 ${offY})` });
  let staticNodes: { id: string; el: SVGGElement }[] = [],
    staticEdges: { e: Layout["edges"][number]; el: SVGPathElement }[] = [];
  const focus = opts.focus === undefined || opts.focus === "auto" ? doc.nodes.size >= FOCUS_AUTO_NODES : opts.focus;
  if (focus) root.classList.add("ene-focus");
  // ---- zoom and pan: the view box shows a part of the diagram; the element keeps its size ----
  const view = { zoom: 1, x: 0, y: 0 };
  let onZoom = () => {};
  function applyView() {
    const W = lay.width,
      H = lay.height + offY;
    const w = W / view.zoom,
      h = H / view.zoom;
    view.x = Math.min(W - w, Math.max(0, view.x));
    view.y = Math.min(H - h, Math.max(0, view.y));
    svg.setAttribute("viewBox", `${round(view.x)} ${round(view.y)} ${round(w)} ${round(h)}`);
    // `100%` would follow the view box, so the background gets the size of the whole diagram
    const bg = svg.querySelector(":scope > rect.bg");
    bg?.setAttribute("width", String(W));
    bg?.setAttribute("height", String(H));
    svg.classList.toggle("ene-zoomed", view.zoom > 1);
    onZoom();
  }
  /** Zoom to `z`, keeping the point at fraction (fx, fy) of the view where it is */
  function zoomTo(z: number, fx = 0.5, fy = 0.5) {
    const next = Math.min(MAX_ZOOM, Math.max(1, Number.isFinite(z) ? z : 1));
    const W = lay.width,
      H = lay.height + offY;
    const px = view.x + (W / view.zoom) * fx,
      py = view.y + (H / view.zoom) * fy;
    view.zoom = next;
    view.x = px - (W / next) * fx;
    view.y = py - (H / next) * fy;
    applyView();
  }
  function drawStatic() {
    applyView();
    svg.setAttribute("width", String(lay.width));
    svg.setAttribute("height", String(lay.height + offY));
    staticG.innerHTML =
      lay.groups.map(groupMarkup).join("") +
      sequenceMarkup(lay) +
      lay.edges.map((e) => `<path d="${e.d}" class="edge"/>`).join("") +
      lay.nodes.map((n) => `<g class="ene-n">${nodeMarkup(n, icons)}</g>`).join("");
    const nodeEls = staticG.querySelectorAll<SVGGElement>("g.ene-n"),
      edgeEls = staticG.querySelectorAll<SVGPathElement>("path.edge");
    staticNodes = lay.nodes.map((n, i) => ({ id: n.id, el: nodeEls[i] })).filter((x) => x.el);
    staticEdges = lay.edges.map((e, i) => ({ e, el: edgeEls[i] })).filter((x) => x.el);
  }
  svg.innerHTML =
    `<style>${STYLE}${themeCss(theme)}</style>${ARROW_DEFS}<rect width="100%" height="100%" class="bg"/>` +
    (doc.title ? `<text x="40" y="34" class="t">${esc(doc.title)}</text>` : "");
  svg.appendChild(staticG);
  drawStatic();
  const dyn = svgEl("g", { transform: `translate(0 ${offY})` });
  svg.appendChild(dyn);
  root.appendChild(svg);
  // Caption with the note of the current step (same place for flow and sequence diagrams)
  const noteEl = document.createElement("div");
  noteEl.className = "ene-note";
  noteEl.setAttribute("aria-live", "polite");
  // Only diagrams with notes get the caption; its height is kept so the layout does not jump between steps
  if (hasNotes(doc.body)) root.appendChild(noteEl);

  const ko = lang === "ko";
  // ---- seek bar: drag to any time; it follows playback ----
  const seek = document.createElement("input");
  seek.type = "range";
  seek.className = "ene-seek";
  seek.min = "0";
  seek.step = "0.01";
  seek.setAttribute("aria-label", ko ? "재생 위치" : "Position");
  seek.addEventListener("input", () => {
    ctl.pause();
    ctl.seek(Number(seek.value));
    draw();
  });
  root.appendChild(seek);

  // ---- controls ----
  const bar = document.createElement("div");
  bar.className = "ene-bar";
  const btn = (label: string, title: string, fn: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", () => {
      fn();
      draw();
      syncLoop();
    });
    bar.appendChild(b);
    return b;
  };
  btn("⏮", ko ? "처음으로" : "Restart", () => ctl.restart());
  btn("◀", ko ? "이전 단계" : "Previous step", () => {
    ctl.pause();
    ctl.prev();
  });
  const playBtn = btn("▶", ko ? "재생/정지" : "Play/Pause", () => ctl.toggle());
  btn("▶▶", ko ? "다음 단계" : "Next step", () => {
    ctl.pause();
    ctl.next();
  });
  const rateSel = document.createElement("select");
  rateSel.setAttribute("aria-label", ko ? "속도" : "Speed");
  for (const r of [0.5, 1, 2]) rateSel.add(new Option(`${r}×`, String(r), r === 1, r === 1));
  rateSel.addEventListener("change", () => ctl.setRate(Number(rateSel.value)));
  bar.appendChild(rateSel);
  // One control per branch, indexed like tl.branches (an `opt` checkbox or an arm menu)
  const branchCtls: (HTMLSelectElement | HTMLInputElement)[] = [];
  const syncSels = () =>
    branchCtls.forEach((c, bi) => {
      // Only arm 1 skips an opt; an out-of-range choice plays arm 0 (buildTimeline's fallback), so it shows checked
      if (c instanceof HTMLInputElement) {
        c.checked = choices[bi] !== 1;
        return;
      }
      c.value = String(choices[bi] ?? 0);
      if (c.selectedIndex < 0) c.value = "0";
    });
  const pick = (bi: number, arm: number) => {
    choices[bi] = arm;
    for (let i = 0; i < bi; i++) choices[i] ??= 0;
    rebuild();
    opts.onChoicesChange?.([...choices]);
  };
  tl.branches.forEach((b, bi) => {
    if (b.optional) {
      // `opt`: a toggle; checked = the steps play (arm 0), unchecked = skipped (arm 1)
      const lab = document.createElement("label");
      lab.className = "ene-opt";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = choices[bi] !== 1;
      branchCtls[bi] = box;
      box.addEventListener("change", () => pick(bi, box.checked ? 0 : 1));
      lab.append(box, b.arms[0] || "opt");
      bar.appendChild(lab);
      return;
    }
    const sel = document.createElement("select");
    branchCtls[bi] = sel;
    sel.setAttribute("aria-label", `${ko ? "분기" : "Branch"} ${bi + 1}`);
    b.arms.forEach((a, ai) => {
      sel.add(new Option(a || `${ko ? "갈래" : "arm"} ${ai + 1}`, String(ai)));
    });
    sel.addEventListener("change", () => pick(bi, Number(sel.value)));
    bar.appendChild(sel);
  });
  if (opts.zoom !== false) {
    const out = btn("−", ko ? "축소" : "Zoom out", () => zoomTo(view.zoom / ZOOM_STEP));
    const inn = btn("+", ko ? "확대" : "Zoom in", () => zoomTo(view.zoom * ZOOM_STEP));
    onZoom = () => {
      out.disabled = view.zoom <= 1;
      inn.disabled = view.zoom >= MAX_ZOOM;
    };
    onZoom();
    // Ctrl/⌘ + wheel (and trackpad pinch) zooms at the pointer; a plain wheel still scrolls the page
    svg.addEventListener(
      "wheel",
      (ev) => {
        if (!ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        const r = svg.getBoundingClientRect();
        const fx = r.width ? (ev.clientX - r.left) / r.width : 0.5,
          fy = r.height ? (ev.clientY - r.top) / r.height : 0.5;
        zoomTo(view.zoom * Math.exp(-ev.deltaY / 200), fx, fy);
      },
      { passive: false },
    );
    // Drag to pan while zoomed in
    let drag: { id: number; x: number; y: number } | undefined;
    svg.addEventListener("pointerdown", (ev) => {
      if (view.zoom <= 1 || ev.button !== 0) return;
      drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
      svg.setPointerCapture?.(ev.pointerId);
      svg.classList.add("ene-panning");
    });
    svg.addEventListener("pointermove", (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const r = svg.getBoundingClientRect();
      if (r.width && r.height) {
        view.x -= ((ev.clientX - drag.x) / r.width) * (lay.width / view.zoom);
        view.y -= ((ev.clientY - drag.y) / r.height) * ((lay.height + offY) / view.zoom);
      }
      drag.x = ev.clientX;
      drag.y = ev.clientY;
      applyView();
    });
    const endDrag = (ev: PointerEvent) => {
      if (!drag || ev.pointerId !== drag.id) return;
      drag = undefined;
      svg.classList.remove("ene-panning");
    };
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointercancel", endDrag);
  }
  const stepText = document.createElement("span");
  stepText.className = "ene-step";
  stepText.setAttribute("aria-live", "polite");
  bar.appendChild(stepText);
  root.appendChild(bar);
  el.appendChild(root);

  root.addEventListener("keydown", (ev) => {
    // Form controls (the `opt` checkbox, menus) keep their own keys
    const target = ev.target as HTMLElement | null;
    // The seek bar is the exception: on it Space and the arrows work as everywhere else in the player
    if (target?.tagName === "SELECT" || (target?.tagName === "INPUT" && target !== seek)) return;
    if (ev.key === " ") {
      ctl.toggle();
      ev.preventDefault();
    } else if (ev.key === "ArrowRight") {
      ctl.pause();
      ctl.next();
      ev.preventDefault();
    } else if (ev.key === "ArrowLeft") {
      ctl.pause();
      ctl.prev();
      ev.preventDefault();
    } else if (opts.zoom !== false && (ev.key === "+" || ev.key === "=" || ev.key === "-" || ev.key === "0")) {
      zoomTo(ev.key === "0" ? 1 : ev.key === "-" ? view.zoom / ZOOM_STEP : view.zoom * ZOOM_STEP);
      ev.preventDefault();
    } else return;
    draw();
    syncLoop();
  });

  // ---- dynamic elements ----
  let ctl!: Controller;
  let items: ReturnType<typeof buildItems>;
  function buildItems(t: Timeline, l: Layout) {
    dyn.replaceChildren();
    const byNode = new Map(l.nodes.map((n) => [n.id, n]));
    const uses = edgeUses(t);
    const hl: SVGPathElement[] = [],
      lbl: SVGTextElement[] = [],
      dots: SVGCircleElement[] = [],
      xs: SVGTextElement[] = [];
    const list = t.steps.flatMap((s) =>
      s.edges.map((e, k) => {
        const le = edgeFor(l, s.index, k, e.edgeIndex)!;
        const p = svgEl("path", { d: le.d, class: `hl ${e.kind}`, "marker-end": "url(#ene-ah)" });
        hl.push(p);
        dyn.appendChild(p);
        const nextUse = le.step !== undefined ? Infinity : nextUseAfter(uses, e.edgeIndex, s.start, Infinity);
        return { s, e, le, p, nextUse, len: p.getTotalLength() };
      }),
    );
    for (const it of list) {
      const tx = svgEl("text", { x: it.le.mid.x, y: it.le.mid.y - 6, class: "lbl" });
      tx.textContent = it.e.label ? `${it.s.index + 1}. ${it.e.label}` : "";
      lbl.push(tx);
      dyn.appendChild(tx);
    }
    for (const it of list) {
      const c = svgEl("circle", { r: 7, class: `dot ${it.e.kind}` });
      dots.push(c);
      dyn.appendChild(c);
      const n = byNode.get(it.e.to)!;
      const endPt = it.le.step !== undefined ? it.p.getPointAtLength(it.len) : undefined;
      const x = svgEl(
        "text",
        endPt ? { x: endPt.x, y: endPt.y + 4, class: "x" } : { x: n.x + n.w / 2, y: n.y - 8, class: "x" },
      );
      x.textContent = it.e.kind === "fail" ? "✕" : "";
      xs.push(x);
      dyn.appendChild(x);
    }
    return { list, hl, lbl, dots, xs };
  }

  function draw() {
    const t = ctl.time;
    // Focus: while a step plays, everything outside it is dimmed; at the end the whole diagram shows
    const live = focus && t < tl.total - 1e-9 ? tl.steps[ctl.currentStep()] : undefined;
    if (focus) {
      const ids = new Set(live?.edges.flatMap((e) => [e.from, e.to]));
      const paths = new Set(live?.edges.map((e, k) => edgeFor(lay, live.index, k, e.edgeIndex)));
      for (const n of staticNodes) n.el.classList.toggle("ene-dim", !!live && !ids.has(n.id));
      for (const e of staticEdges) e.el.classList.toggle("ene-dim", !!live && !paths.has(e.e));
    }
    const on = (s: Timeline["steps"][number]) => (live && s !== live ? String(DIM) : "1");
    items.list.forEach((it, i) => {
      const t0 = it.s.start,
        t1 = arrivalTime(t0, it.e.duration);
      const started = t >= t0 - 1e-9;
      items.hl[i].style.opacity = started ? on(it.s) : "0";
      items.lbl[i].style.opacity = started && t < it.nextUse - 1e-9 ? on(it.s) : "0";
      items.xs[i].style.opacity = t >= t1 ? on(it.s) : "0";
      const moving = started && t < t1;
      items.dots[i].style.opacity = moving ? "1" : "0";
      if (moving) {
        const pt = it.p.getPointAtLength(it.len * ((t - t0) / (t1 - t0)));
        items.dots[i].setAttribute("cx", String(pt.x));
        items.dots[i].setAttribute("cy", String(pt.y));
      }
    });
    playBtn.textContent = ctl.playing ? "⏸" : "▶";
    seek.value = String(Math.min(t, tl.total));
    const si = ctl.currentStep();
    const step = tl.steps[si];
    stepText.textContent = step
      ? `${si + 1}/${tl.steps.length} · ${step.edges.map((e) => `${e.from} → ${e.to}${e.label ? ` ${e.label}` : ""}`).join(", ")}`
      : "";
    const note = step?.note ?? "";
    if (noteEl.textContent !== note) noteEl.textContent = note;
  }

  function rebuild() {
    tl = buildTimeline(doc, { choices });
    // Sequence rows change with branches, so re-lay out
    if (doc.kind === "sequence" && ctl) {
      lay = layoutSequence(doc, tl);
      drawStatic();
    }
    const wasPlaying = ctl ? ctl.playing : (opts.autoplay ?? true) && !reduce;
    ctl = createController(tl, { loop: opts.loop ?? true });
    seek.max = String(tl.total);
    // Resume the frame loop even when playback is started through the exposed controller
    const play = ctl.play.bind(ctl),
      toggle = ctl.toggle.bind(ctl);
    ctl.play = () => {
      play();
      syncLoop();
    };
    ctl.toggle = () => {
      toggle();
      syncLoop();
    };
    if (reduce) ctl.time = tl.total;
    if (wasPlaying) ctl.play();
    items = buildItems(tl, lay);
    draw();
  }
  // Frame loop runs only while playing; it stops itself when playback pauses or ends
  let last = 0,
    raf = 0,
    alive = true;
  const frame = (now: number) => {
    raf = 0;
    if (!alive || !ctl.playing) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    ctl.tick(dt);
    draw();
    if (ctl.playing) raf = requestAnimationFrame(frame);
  };
  function syncLoop() {
    if (!alive || raf || !ctl?.playing) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  rebuild();
  if (opts.step !== undefined) {
    ctl.pause();
    ctl.goto(opts.step - 1);
    draw();
  }
  syncSels();
  syncLoop();

  const player: Player = {
    get controller() {
      return ctl;
    },
    get choices() {
      return [...choices];
    },
    setChoices(c) {
      if (!alive) return;
      choices = clampChoices(c);
      rebuild();
      syncSels();
      syncLoop();
    },
    get step() {
      return ctl.currentStep() + 1;
    },
    goto(step) {
      if (!alive) return;
      ctl.pause();
      ctl.goto(step - 1);
      draw();
    },
    get zoom() {
      return view.zoom;
    },
    setZoom(zoom) {
      if (alive) zoomTo(zoom);
    },
    toSvg() {
      return renderSvg(lay, tl, { title: doc.title, icons, theme, lang });
    },
    destroy() {
      if (!alive) return;
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (hosts.get(el)?.player === player) hosts.delete(el);
      if (root.parentNode === el) el.replaceChildren();
    },
  };
  hosts.get(el)!.player = player;
  return player;
}

type Body = Parameters<typeof buildTimeline>[0]["body"];
const hasNotes = (body: Body): boolean =>
  body.some((s) =>
    s.type === "step"
      ? s.note !== undefined
      : s.type === "loop"
        ? hasNotes(s.body)
        : s.type === "branch"
          ? s.arms.some((a) => hasNotes(a.body))
          : false,
  );

/**
 * Replace every `<pre class="ene">` on the page with a player.
 * Resolves to the created players (diagrams with errors are skipped) so callers can destroy them.
 */
const stepOf = (v: string | undefined) =>
  v !== undefined && /^\d+$/.test(v) && Number(v) >= 1 ? Number(v) : undefined;

/**
 * A link to a step of a diagram on the page: `#ene-step=7` (step 7 of the first diagram) or `#ene-step=2.7`
 * (step 7 of the second diagram, which is also scrolled into view). Numbers start at 1.
 */
export function parseStepLink(hash: string): { diagram: number; step: number; explicit: boolean } | undefined {
  const m = /(?:^#|&)ene-step=(?:(\d+)\.)?(\d+)(?:&|$)/.exec(hash);
  if (!m) return undefined;
  const diagram = m[1] === undefined ? 1 : Number(m[1]),
    step = Number(m[2]);
  return diagram >= 1 && step >= 1 ? { diagram, step, explicit: m[1] !== undefined } : undefined;
}

export async function autoRun(selector = "pre.ene", opts: PlayerOptions = {}): Promise<Player[]> {
  const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
  const players: Player[] = [];
  const link = typeof location !== "undefined" ? parseStepLink(location.hash) : undefined;
  for (const pre of els) {
    const src = pre.textContent ?? "";
    const host = document.createElement("div");
    pre.replaceWith(host);
    // <pre class="ene" data-focus="on|off|auto"> overrides the page-wide option
    const f = pre.dataset.focus;
    const focus = f === "on" || f === "" ? true : f === "off" ? false : f === "auto" ? "auto" : opts.focus;
    const th = pre.dataset.theme;
    // <pre class="ene" data-step="3"> opens paused at step 3; a `#ene-step=` link (below) wins over it
    const linked = link && link.diagram === els.indexOf(pre) + 1 ? link.step : undefined;
    const step = linked ?? stepOf(pre.dataset.step);
    const p = await render(host, src, {
      ...opts,
      focus,
      ...(th && isTheme(th) ? { theme: th } : {}),
      ...(step !== undefined ? { step } : {}),
    });
    if (p) players.push(p);
    if (p && linked !== undefined && link?.explicit) host.scrollIntoView?.({ block: "center" });
  }
  return players;
}
