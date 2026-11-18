import {
  buildTimeline,
  checkIcons,
  enumeratePaths,
  formatAll,
  isIconUrl,
  MAX_PATHS,
  parse,
  resolveIcon,
  type IconPack,
  type Includer,
  type Lang,
  type ResolvedIcon,
} from "@ene-diagram/core";
import { layout, layoutSequence } from "@ene-diagram/layout";
import { esc, fetchIcon, renderSvg, renderSvgPaths, svgParts, type ThemeName } from "@ene-diagram/svg";

export interface RenderOptions {
  /** Diagnostic language (default "en") */
  lang?: Lang;
  /** Branch arms to show in the static SVG, like the CLI's `--choice 0,1`; `"all"` plays every path in turn */
  choice?: number[] | "all";
  /**
   * Reads `include`d files, for example `createIncluder` from `@ene-diagram/core` over `node:fs`. This package
   * reads no files itself, so without it an `include` line is an error
   */
  include?: Includer;
  /** Overrides the diagram's `title` line */
  title?: string;
  /** Icon packs for `icon` names such as `aws:lambda` */
  icons?: IconPack[];
  /** Fetch `https://` icons at build time. Off by default */
  network?: boolean;
  /** With `network`, only fetch from these hosts (redirects are refused) */
  allowHosts?: string[];
}

export type RenderResult =
  | { ok: true; svg: string; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };

/** Render ene source to a self-playing SVG string (no DOM needed) */
export async function renderEne(src: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const lang = opts.lang ?? "en";
  const packs = opts.icons ?? [];
  const { doc, diagnostics } = parse(src, opts.include ? { include: opts.include } : {});
  diagnostics.push(...checkIcons(doc, packs));
  diagnostics.sort((a, b) => a.span.line - b.span.line || a.span.col - b.span.col);
  const warnings: string[] = [];
  if (diagnostics.some((d) => d.severity === "error"))
    return { ok: false, error: formatAll(src, diagnostics, lang), warnings };
  if (diagnostics.length) warnings.push(formatAll(src, diagnostics, lang));
  const all = opts.choice === "all";
  const choices = opts.choice === "all" ? [] : (opts.choice ?? []);
  const tl = buildTimeline(doc, { choices });
  choices.forEach((c, i) => {
    const b = tl.branches[i];
    if (!b) warnings.push(`choice ${c} ignored — there are only ${tl.branches.length} branch(es)`);
    else if (c >= b.arms.length)
      warnings.push(`choice ${c} for branch ${i + 1} is out of range (0-${b.arms.length - 1}); using 0`);
  });
  const icons = new Map<string, ResolvedIcon>();
  const refs = [...new Set([...doc.nodes.values()].map((n) => n.icon).filter((i): i is string => !!i))];
  for (const ref of refs.filter((r) => !isIconUrl(r))) {
    const ic = resolveIcon(ref, packs);
    if (ic) icons.set(ref, ic);
  }
  await Promise.all(
    refs.filter(isIconUrl).map(async (ref) => {
      if (!/^https:/.test(ref))
        return void warnings.push(
          `icon ${ref}: only https:// icons (with network: true) or icon packs are supported here`,
        );
      if (!opts.network)
        return void warnings.push(`icon ${ref}: network access is disabled (set network: true to fetch it)`);
      const r = await fetchIcon(ref, { allowHosts: opts.allowHosts });
      if (r.ok) icons.set(ref, r.icon);
      else warnings.push(`icon ${ref}: ${r.reason}`);
    }),
  );
  const lay = doc.kind === "sequence" ? layoutSequence(doc, tl) : await layout(doc, tl);
  const title = opts.title ?? doc.title;
  const svgOpts = { title, icons, theme: doc.theme as ThemeName | undefined };
  const paths = all ? enumeratePaths(doc) : [];
  if (!paths) warnings.push(`choice all: more than ${MAX_PATHS} paths; showing the first one`);
  const svg =
    paths && paths.length > 1
      ? renderSvgPaths(svgParts(doc, paths, doc.kind === "sequence" ? undefined : lay), svgOpts)
      : renderSvg(lay, tl, svgOpts);
  return { ok: true, svg, warnings };
}

/**
 * Make an SVG safe to inline next to others: prefix every id and its references, and scope the
 * stylesheet to this SVG (its rules use `svg` and short class names that would otherwise leak into
 * the page). Only attribute values and the `<style>` element are touched; diagram text is escaped
 * by the renderer, so it cannot contain `="` and is never rewritten.
 */
export function scopeSvg(svg: string, prefix: string): string {
  const scope = `${prefix}root`;
  return (
    svg
      // Add the scope to the root's class list (it may already carry `ene ene-theme-…`; a second class attribute would be dropped by HTML parsers)
      .replace(/^<svg([^>]*)>/, (_, attrs: string) => {
        const withClass = attrs.replace(/ class="([^"]*)"/, (_m: string, c: string) => ` class="${c} ${scope}"`);
        return `<svg${withClass === attrs ? ` class="${scope}"${attrs}` : withClass}>`;
      })
      .replace(/<style>([\s\S]*?)<\/style>/, (_, css: string) => `<style>${scopeCss(css, scope)}</style>`)
      .replace(/ id="([^"]+)"/g, ` id="${prefix}$1"`)
      .replace(/ href="#([^"]+)"/g, ` href="#${prefix}$1"`)
      .replace(/ (marker-end|marker-start|fill|stroke|clip-path|mask)="url\(#([^)"]+)\)"/g, ` $1="url(#${prefix}$2)"`)
  );
}

/** Prefix each selector in a flat stylesheet (with optional @media blocks) by `.scope` */
export function scopeCss(css: string, scope: string): string {
  return css.replace(/([^{}]+)\{/g, (m, sel: string) => {
    if (sel.trim().startsWith("@")) return m;
    const lead = sel.match(/^\s*/)![0];
    const scoped = sel
      .trim()
      .split(",")
      .map((x) => {
        const t = x.trim();
        return t === "svg" || (t.startsWith("svg") && !/^svg[\w-]/.test(t))
          ? `svg.${scope}${t.slice(3)}`
          : `.${scope} ${t}`;
      })
      .join(",");
    return `${lead}${scoped}{`;
  });
}

/** Short deterministic hash (FNV-1a) used for id prefixes */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** Escape text for HTML content and attribute values */
export const escapeHtml = esc;

/** Visible error box (all text escaped) */
export const errorHtml = (message: string) =>
  `<div class="ene-error" role="alert" style="border:1px solid #e5484d;border-radius:6px;padding:8px 12px;color:#e5484d;overflow:auto">` +
  `<strong>ene diagram error</strong><pre style="margin:6px 0 0;white-space:pre-wrap">${esc(message)}</pre></div>`;

export const DEFAULT_PLAYER_URL = "https://cdn.jsdelivr.net/npm/@ene-diagram/player@0.2/dist/ene.js";

/**
 * Parse a fence's info-string meta: `title="Checkout" choice=1,0` (or `choice=all`).
 * Unknown keys are ignored.
 */
export function parseMeta(meta: string | null | undefined): {
  title?: string;
  choice?: number[] | "all";
  mode?: "static" | "live";
} {
  const out: { title?: string; choice?: number[] | "all"; mode?: "static" | "live" } = {};
  if (!meta) return out;
  const re = /([a-zA-Z]+)=(?:"([^"]*)"|'([^']*)'|(\S+))|\b(live|static)\b/g;
  for (const m of meta.matchAll(re)) {
    if (m[5]) {
      out.mode = m[5] as "static" | "live";
      continue;
    }
    const key = m[1],
      val = m[2] ?? m[3] ?? m[4] ?? "";
    if (key === "title") out.title = val;
    else if (key === "choice" && val === "all") out.choice = "all";
    else if (key === "choice" && /^\d+(,\d+)*$/.test(val)) out.choice = val.split(",").map(Number);
  }
  return out;
}

/** Source for the live player: a meta title is added only when the source has no `title` line */
export function liveSource(src: string, title?: string): string {
  if (!title || /^\s*title\s/m.test(src)) return src;
  return `title ${title.replace(/[\r\n]+/g, " ")}\n${src}`;
}
