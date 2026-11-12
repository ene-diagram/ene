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
export interface ResolvedIcon { body: string; width: number; height: number }

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
    const names = packs.filter((p) => p.prefix === prefix)
      .flatMap((p) => [...Object.keys(p.icons), ...Object.keys(p.aliases ?? {})].map((k) => `${p.prefix}:${k}`));
    const sug = suggest(n.icon, names);
    out.push({ code: "W104", severity: "warning", span: n.span, args: sug ? { name: n.icon, suggestion: sug } : { name: n.icon } });
  }
  return out;
}
