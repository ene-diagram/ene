import { buildTimeline, checkIcons, formatAll, isIconUrl, parse, resolveIcon, type IconPack, type Lang, type ResolvedIcon, type Timeline } from "@ene/core";
import { edgeFor, layout as computeLayout, layoutSequence, type ElkApi, type Layout } from "@ene/layout";
import { ARROW_DEFS, STYLE, esc, groupMarkup, iconFromSvgText, nodeMarkup, sequenceMarkup } from "@ene/svg";
import { createController, type Controller } from "./controller.js";

export interface PlayerOptions { lang?: Lang; autoplay?: boolean; loop?: boolean }

// ---- ELK 지연 로딩: ene.js 옆의 ene-elk.js 를 처음 필요할 때 한 번만 불러온다 ----
let elkUrl: string | undefined;
let elkPromise: Promise<ElkApi> | undefined;
/** ene-elk.js 위치 지정 (기본: ene.js 와 같은 폴더) */
export function setElkUrl(url: string): void { elkUrl = url; }
function loadElk(): Promise<ElkApi> {
  const w = window as unknown as { ELK?: new () => ElkApi };
  if (w.ELK) return Promise.resolve(new w.ELK());
  elkPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = elkUrl ?? "ene-elk.js";
    s.onload = () => (w.ELK ? resolve(new w.ELK()) : reject(new Error("ene-elk.js did not define ELK")));
    s.onerror = () => { elkPromise = undefined; reject(new Error(`cannot load ${s.src}`)); };
    document.head.appendChild(s);
  });
  return elkPromise;
}
export interface Player { controller: Controller; setChoices(choices: number[]): void; destroy(): void }

const NS = "http://www.w3.org/2000/svg";
const TITLE_H = 44;

const PLAYER_CSS = `
.ene-player{display:inline-flex;flex-direction:column;gap:8px;max-width:100%;outline:none;font-family:Pretendard,-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif}
.ene-player:focus-visible{box-shadow:0 0 0 2px #3e63dd;border-radius:10px}
.ene-player svg{max-width:100%;height:auto;border-radius:10px}
.ene-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:13px;color:#3a4048}
.ene-bar button,.ene-bar select{font:inherit;padding:4px 10px;border:1px solid #c1c8d2;border-radius:6px;background:#fff;color:#1c2024;cursor:pointer}
.ene-bar button:hover{background:#f1f3f5}
.ene-step{margin-left:6px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px}
.ene-error{color:#e5484d;background:#fff5f5;border:1px solid #ffd1d1;border-radius:8px;padding:12px;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre;overflow:auto}
@media (prefers-color-scheme: dark){.ene-bar{color:#b0b4ba}.ene-bar button,.ene-bar select{background:#1c1d21;color:#edeef0;border-color:#3b3e45}.ene-error{background:#2a1215;border-color:#5c1a1f;color:#ff9592}}`;

export interface IconPackSource { name?: string; pack?: IconPack; loader?: () => Promise<IconPack> }
const packSources: IconPackSource[] = [];
let packsPromise: Promise<IconPack[]> | undefined;
const urlIcons = new Map<string, Promise<ResolvedIcon | undefined>>();

/** 아이콘 팩 등록 (Iconify JSON). loader 는 아이콘이 처음 필요할 때 한 번만 불린다 */
export function registerIconPacks(sources: IconPackSource[]): void {
  packSources.push(...sources);
  packsPromise = undefined;
}
async function loadPacks(): Promise<IconPack[]> {
  packsPromise ??= Promise.all(packSources.map(async (s) => {
    try { return s.pack ?? (await s.loader?.()); } catch { return undefined; }
  })).then((ps) => ps.filter((p): p is IconPack => !!p));
  return packsPromise;
}
function loadUrlIcon(url: string): Promise<ResolvedIcon | undefined> {
  if (!urlIcons.has(url))
    urlIcons.set(url, fetch(url).then((r) => (r.ok ? r.text() : Promise.reject())).then(iconFromSvgText).catch(() => undefined));
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

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/** 대상 요소 안에 플레이어를 만든다. 진단 오류가 있으면 오류 메시지를 보여 준다 */
export async function render(el: HTMLElement, source: string, opts: PlayerOptions = {}): Promise<Player | undefined> {
  injectCss();
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
  const icons = new Map<string, ResolvedIcon>();
  for (const n of doc.nodes.values()) {
    if (!n.icon || icons.has(n.icon)) continue;
    const ic = isIconUrl(n.icon) ? await loadUrlIcon(n.icon) : resolveIcon(n.icon, packs);
    if (ic) icons.set(n.icon, ic);
  }
  const iconWarnings = checkIcons(doc, packs);
  if (iconWarnings.length) console.warn(formatAll(source, iconWarnings, lang));
  let choices: number[] = [];
  let tl = buildTimeline(doc, { choices });
  let lay: Layout;
  try { lay = doc.kind === "sequence" ? layoutSequence(doc, tl) : await computeLayout(doc, tl, { elk: await loadElk() }); }
  catch (e) {
    const pre = document.createElement("pre");
    pre.className = "ene-error";
    pre.textContent = `ene: ${(e as Error).message}`;
    el.appendChild(pre);
    return undefined;
  }
  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const root = document.createElement("div");
  root.className = "ene-player";
  root.tabIndex = 0;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", doc.title ?? "ene diagram");

  const offY = doc.title ? TITLE_H : 0;
  const svg = svgEl("svg", { role: "img" });
  const staticG = svgEl("g", { transform: `translate(0 ${offY})` });
  function drawStatic() {
    svg.setAttribute("viewBox", `0 0 ${lay.width} ${lay.height + offY}`);
    svg.setAttribute("width", String(lay.width));
    svg.setAttribute("height", String(lay.height + offY));
    staticG.innerHTML = lay.groups.map(groupMarkup).join("") + sequenceMarkup(lay) +
      lay.edges.map((e) => `<path d="${e.d}" class="edge"/>`).join("") +
      lay.nodes.map((n) => nodeMarkup(n, icons)).join("");
  }
  svg.innerHTML =
    `<style>${STYLE}</style>${ARROW_DEFS}<rect width="100%" height="100%" class="bg"/>` +
    (doc.title ? `<text x="40" y="34" class="t">${esc(doc.title)}</text>` : "");
  svg.appendChild(staticG);
  drawStatic();
  const dyn = svgEl("g", { transform: `translate(0 ${offY})` });
  svg.appendChild(dyn);
  root.appendChild(svg);

  // ---- 컨트롤 ----
  const bar = document.createElement("div");
  bar.className = "ene-bar";
  const btn = (label: string, title: string, fn: () => void) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.title = title; b.setAttribute("aria-label", title);
    b.addEventListener("click", () => { fn(); draw(); });
    bar.appendChild(b);
    return b;
  };
  const ko = lang === "ko";
  btn("⏮", ko ? "처음으로" : "Restart", () => ctl.restart());
  btn("◀", ko ? "이전 단계" : "Previous step", () => { ctl.pause(); ctl.prev(); });
  const playBtn = btn("▶", ko ? "재생/정지" : "Play/Pause", () => ctl.toggle());
  btn("▶▶", ko ? "다음 단계" : "Next step", () => { ctl.pause(); ctl.next(); });
  const rateSel = document.createElement("select");
  rateSel.setAttribute("aria-label", ko ? "속도" : "Speed");
  for (const r of [0.5, 1, 2]) rateSel.add(new Option(`${r}×`, String(r), r === 1, r === 1));
  rateSel.addEventListener("change", () => ctl.setRate(Number(rateSel.value)));
  bar.appendChild(rateSel);
  tl.branches.forEach((b, bi) => {
    const sel = document.createElement("select");
    sel.setAttribute("aria-label", `${ko ? "분기" : "Branch"} ${bi + 1}`);
    b.arms.forEach((a, ai) => sel.add(new Option(a || `${ko ? "갈래" : "arm"} ${ai + 1}`, String(ai))));
    sel.addEventListener("change", () => { choices[bi] = Number(sel.value); rebuild(); });
    bar.appendChild(sel);
  });
  const stepText = document.createElement("span");
  stepText.className = "ene-step";
  stepText.setAttribute("aria-live", "polite");
  bar.appendChild(stepText);
  root.appendChild(bar);
  el.appendChild(root);

  root.addEventListener("keydown", (ev) => {
    if (ev.key === " ") { ctl.toggle(); ev.preventDefault(); }
    else if (ev.key === "ArrowRight") { ctl.pause(); ctl.next(); ev.preventDefault(); }
    else if (ev.key === "ArrowLeft") { ctl.pause(); ctl.prev(); ev.preventDefault(); }
    else return;
    draw();
  });

  // ---- 동적 요소 ----
  let ctl: Controller;
  let items: ReturnType<typeof buildItems>;
  function buildItems(t: Timeline, l: Layout) {
    dyn.replaceChildren();
    const byNode = new Map(l.nodes.map((n) => [n.id, n]));
    const uses = new Map<number, number[]>();
    t.steps.forEach((s) => s.edges.forEach((e) => uses.set(e.edgeIndex, [...(uses.get(e.edgeIndex) ?? []), s.start])));
    const hl: SVGPathElement[] = [], lbl: SVGTextElement[] = [], dots: SVGCircleElement[] = [], xs: SVGTextElement[] = [];
    const list = t.steps.flatMap((s) => s.edges.map((e, k) => {
      const le = edgeFor(l, s.index, k, e.edgeIndex)!;
      const p = svgEl("path", { d: le.d, class: `hl ${e.kind}`, "marker-end": "url(#ene-ah)" }); hl.push(p); dyn.appendChild(p);
      const nextUse = le.step !== undefined ? Infinity : (uses.get(e.edgeIndex) ?? []).find((x) => x > s.start) ?? Infinity;
      return { s, e, le, p, nextUse, len: p.getTotalLength() };
    }));
    for (const it of list) {
      const tx = svgEl("text", { x: it.le.mid.x, y: it.le.mid.y - 6, class: "lbl" });
      tx.textContent = it.e.label ? `${it.s.index + 1}. ${it.e.label}` : "";
      lbl.push(tx); dyn.appendChild(tx);
    }
    for (const it of list) {
      const c = svgEl("circle", { r: 7, class: `dot ${it.e.kind}` }); dots.push(c); dyn.appendChild(c);
      const n = byNode.get(it.e.to)!;
      const endPt = it.le.step !== undefined ? it.p.getPointAtLength(it.len) : undefined;
      const x = svgEl("text", endPt ? { x: endPt.x, y: endPt.y + 4, class: "x" } : { x: n.x + n.w / 2, y: n.y - 8, class: "x" }); x.textContent = it.e.kind === "fail" ? "✕" : "";
      xs.push(x); dyn.appendChild(x);
    }
    return { list, hl, lbl, dots, xs };
  }

  function draw() {
    const t = ctl.time;
    items.list.forEach((it, i) => {
      const t0 = it.s.start, t1 = t0 + it.e.duration * 0.85;
      const started = t >= t0 - 1e-9;
      items.hl[i].style.opacity = started ? "1" : "0";
      items.lbl[i].style.opacity = started && t < it.nextUse - 1e-9 ? "1" : "0";
      items.xs[i].style.opacity = t >= t1 ? "1" : "0";
      const moving = started && t < t1;
      items.dots[i].style.opacity = moving ? "1" : "0";
      if (moving) {
        const pt = it.p.getPointAtLength(it.len * ((t - t0) / (t1 - t0)));
        items.dots[i].setAttribute("cx", String(pt.x));
        items.dots[i].setAttribute("cy", String(pt.y));
      }
    });
    playBtn.textContent = ctl.playing ? "⏸" : "▶";
    const si = ctl.currentStep();
    const step = tl.steps[si];
    stepText.textContent = step
      ? `${si + 1}/${tl.steps.length} · ${step.edges.map((e) => `${e.from} → ${e.to}${e.label ? ` ${e.label}` : ""}`).join(", ")}`
      : "";
  }

  function rebuild() {
    tl = buildTimeline(doc, { choices });
    // 시퀀스는 분기에 따라 행이 바뀌므로 다시 배치한다
    if (doc.kind === "sequence" && ctl) { lay = layoutSequence(doc, tl); drawStatic(); }
    const wasPlaying = ctl ? ctl.playing : (opts.autoplay ?? true) && !reduce;
    ctl = createController(tl, { loop: opts.loop ?? true });
    if (reduce) ctl.time = tl.total;
    if (wasPlaying) ctl.play();
    items = buildItems(tl, lay);
    draw();
  }
  rebuild();

  let last = performance.now(), raf = 0, alive = true;
  const frame = (now: number) => {
    if (!alive) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (ctl.playing) { ctl.tick(dt); draw(); }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    get controller() { return ctl; },
    setChoices(c) { choices = [...c]; rebuild(); },
    destroy() { alive = false; cancelAnimationFrame(raf); el.replaceChildren(); },
  };
}

/** 페이지의 `<pre class="ene">` 를 모두 플레이어로 바꾼다 */
export async function autoRun(selector = "pre.ene", opts: PlayerOptions = {}): Promise<void> {
  const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
  for (const pre of els) {
    const src = pre.textContent ?? "";
    const host = document.createElement("div");
    pre.replaceWith(host);
    await render(host, src, opts);
  }
}
