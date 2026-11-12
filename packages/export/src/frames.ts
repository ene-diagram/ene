// Turns an exported ene SVG (SMIL: <animate> on opacity, <animateMotion> along a path) into
// static frames. Each frame is computed from the animation values, not captured from a running
// clock, so the result is the same on every machine and in every browser.

export type Theme = "auto" | "light" | "dark";

const DARK = /@media \(prefers-color-scheme: dark\)\{(svg\{[^}]*\})\}/;
const REDUCED = /@media \(prefers-reduced-motion: reduce\)\{[^{}]*(\{[^}]*\}[^{}]*)*\}/;

/** Fix the colour scheme: `light` drops the dark-mode rule, `dark` applies it unconditionally, `auto` keeps it */
export function applyTheme(svg: string, theme: Theme): string {
  if (theme === "light") return svg.replace(DARK, "");
  if (theme === "dark") return svg.replace(DARK, "$1");
  return svg;
}

/** Frames show motion even when the exporting user prefers reduced motion */
export const stripReducedMotion = (svg: string) => svg.replace(REDUCED, "");

/** Value of a linear SMIL animation at fraction f of its duration (repeated keyTimes are jumps) */
export function sample(values: number[], keyTimes: number[], f: number): number {
  const n = Math.min(values.length, keyTimes.length);
  if (n === 0) return NaN;
  if (n === 1 || f <= keyTimes[0]) return values[0];
  let i = n - 2;
  while (i > 0 && keyTimes[i] > f) i--;
  const a = keyTimes[i], b = keyTimes[i + 1];
  if (f >= b) return values[i + 1];
  return b > a ? values[i] + (values[i + 1] - values[i]) * ((f - a) / (b - a)) : values[i + 1];
}

const nums = (s: string | null) => (s ?? "").split(";").map((x) => Number(x.trim()));
const seconds = (s: string | null) => { const m = /^([\d.]+)s$/.exec((s ?? "").trim()); return m ? Number(m[1]) : NaN; };

/** Length of one loop: the longest `dur` in the document */
export function loopLength(svg: string): number {
  let max = 0;
  for (const m of svg.matchAll(/\sdur="([\d.]+)s"/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Pixel size from the root element's width/height */
export function svgSize(svg: string): { width: number; height: number } {
  const root = svg.match(/<svg\b[^>]*>/)?.[0] ?? "";
  const width = Number(root.match(/\swidth="([\d.]+)"/)?.[1]), height = Number(root.match(/\sheight="([\d.]+)"/)?.[1]);
  if (!(width > 0) || !(height > 0)) throw new Error("cannot read the size of the SVG (no width/height on the root element)");
  return { width: Math.ceil(width), height: Math.ceil(height) };
}

/** Point at `fraction` (0..1) along the path with this id */
export type PointAt = (pathId: string, fraction: number) => { x: number; y: number } | undefined;

/**
 * Freeze `root` (an ene SVG element, modified in place) at time `t` seconds: every animated value is
 * written as a plain attribute and the animation elements are removed.
 */
export function freeze(root: Element, t: number, pointAt: PointAt): void {
  for (const a of Array.from(root.getElementsByTagName("animate"))) {
    const dur = seconds(a.getAttribute("dur")), attr = a.getAttribute("attributeName");
    const target = a.parentElement;
    if (target && attr && dur > 0) {
      const v = sample(nums(a.getAttribute("values")), nums(a.getAttribute("keyTimes")), (t % dur) / dur);
      if (Number.isFinite(v)) target.setAttribute(attr, String(Math.round(v * 1000) / 1000));
    }
    a.remove();
  }
  for (const a of Array.from(root.getElementsByTagName("animateMotion"))) {
    const dur = seconds(a.getAttribute("dur")), target = a.parentElement;
    const mpath = a.getElementsByTagName("mpath")[0];
    const href = (mpath?.getAttribute("href") ?? mpath?.getAttribute("xlink:href") ?? "").replace(/^#/, "");
    if (target && href && dur > 0) {
      const p = sample(nums(a.getAttribute("keyPoints")), nums(a.getAttribute("keyTimes")), (t % dur) / dur);
      const pt = Number.isFinite(p) ? pointAt(href, Math.min(1, Math.max(0, p))) : undefined;
      if (pt) target.setAttribute("transform", `translate(${pt.x.toFixed(2)} ${pt.y.toFixed(2)})`);
    }
    a.remove();
  }
}

/** Time of each frame: frame i shows i / fps; the loop end is not sampled (it equals frame 0) */
export function frameTimes(seconds: number, fps: number): number[] {
  const n = Math.max(1, Math.round(seconds * fps));
  return Array.from({ length: n }, (_, i) => i / fps);
}
