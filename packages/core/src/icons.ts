import { suggest } from "./diagnostics.js";
import type { Diagnostic, Document } from "./types.js";

/** Subset of the Iconify JSON format (https://iconify.design/docs/types/iconify-json.html) */
export interface IconPack {
  prefix: string;
  icons: Record<string, { body: string; width?: number; height?: number }>;
  aliases?: Record<string, { parent: string }>;
  width?: number;
  height?: number;
}
export interface ResolvedIcon {
  body: string;
  width: number;
  height: number;
}

/** `http(s):`, `data:`, `/`, `./`, `../` means an SVG address, not a pack name */
export const isIconUrl = (ref: string) => /^(https?:|data:|\.{0,2}\/)/.test(ref);

export function resolveIcon(ref: string, packs: IconPack[]): ResolvedIcon | undefined {
  const c = ref.indexOf(":");
  if (c < 0 || isIconUrl(ref)) return undefined;
  const prefix = ref.slice(0, c);
  let name = ref.slice(c + 1);
  const pack = packs.find((p) => p.prefix === prefix);
  if (!pack) return undefined;
  for (let hop = 0; hop < 5 && !pack.icons[name] && pack.aliases?.[name]; hop++) name = pack.aliases[name].parent;
  const icon = pack.icons[name];
  if (!icon) return undefined;
  return { body: icon.body, width: icon.width ?? pack.width ?? 16, height: icon.height ?? pack.height ?? 16 };
}

/** W104 for each icon not found in the registered packs (URL icons are not checked) */
export function checkIcons(doc: Document, packs: IconPack[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const n of doc.nodes.values()) {
    if (!n.icon || isIconUrl(n.icon) || resolveIcon(n.icon, packs)) continue;
    const prefix = n.icon.split(":", 1)[0];
    const names = packs
      .filter((p) => p.prefix === prefix)
      .flatMap((p) => [...Object.keys(p.icons), ...Object.keys(p.aliases ?? {})].map((k) => `${p.prefix}:${k}`));
    const sug = suggest(n.icon, names);
    out.push({
      code: "W104",
      severity: "warning",
      span: n.span,
      args: sug ? { name: n.icon, suggestion: sug } : { name: n.icon },
      // The icon is written in an included file: report it there, not on the same line number of the diagram
      ...(n.from ? { file: n.from.file, lineText: n.from.lineText, ...(n.from.at ? { at: n.from.at } : {}) } : {}),
    });
  }
  return out;
}

const isDim = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 4096);
/**
 * Structural check for an icon pack loaded from untrusted JSON.
 * Returns a list of human-readable problems (empty = valid).
 */
export function validateIconPack(x: unknown): string[] {
  const errs: string[] = [];
  if (!x || typeof x !== "object" || Array.isArray(x)) return ["pack must be a JSON object"];
  const p = x as Record<string, unknown>;
  if (typeof p.prefix !== "string" || !/^[a-z0-9][a-z0-9-]*$/i.test(p.prefix))
    errs.push('"prefix" must be a non-empty string of letters, digits and "-"');
  if (!isDim(p.width)) errs.push('"width" must be a positive number ≤ 4096');
  if (!isDim(p.height)) errs.push('"height" must be a positive number ≤ 4096');
  if (!p.icons || typeof p.icons !== "object" || Array.isArray(p.icons)) errs.push('"icons" must be an object');
  else
    for (const [name, ic] of Object.entries(p.icons as Record<string, unknown>)) {
      if (errs.length >= 10) {
        errs.push("…");
        break;
      }
      const i = ic as Record<string, unknown> | null;
      if (!i || typeof i !== "object" || typeof i.body !== "string")
        errs.push(`icons.${name}: "body" must be a string`);
      else if (!isDim(i.width) || !isDim(i.height))
        errs.push(`icons.${name}: width/height must be positive numbers ≤ 4096`);
    }
  if (p.aliases !== undefined) {
    if (!p.aliases || typeof p.aliases !== "object" || Array.isArray(p.aliases))
      errs.push('"aliases" must be an object');
    else
      for (const [name, a] of Object.entries(p.aliases as Record<string, unknown>))
        if (!a || typeof (a as { parent?: unknown }).parent !== "string") {
          errs.push(`aliases.${name}: "parent" must be a string`);
          break;
        }
  }
  return errs;
}
