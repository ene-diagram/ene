import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { buildTimeline, checkIcons, formatAll, isIconUrl, parse, resolveIcon, validateIconPack, type IconPack, type Lang, type ResolvedIcon } from "@ene/core";
import { layout, layoutSequence } from "@ene/layout";
import { ICON_DEFAULTS, fetchIcon, iconFromUntrustedSvg, renderSvg, type IconLoadResult } from "@ene/svg";

const USAGE = `usage: ene <input.ene> [-o out.svg] [--lang en|ko] [--choice 0,1] [--icons pack.json ...]
                 [--no-network] [--allow-host host ...]
       ene icons <svg-dir> --prefix <name> [-o pack.json]`;

/** "Arch_AWS-Lambda_48.svg" → "aws-lambda" */
export const iconName = (file: string) =>
  basename(file, ".svg").replace(/^(Arch|Res|Arch-Category)_/, "").replace(/_(16|32|48|64)$/, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function iconsCommand(argv: string[]): number {
  let dir: string | undefined, prefix: string | undefined, out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--prefix") prefix = argv[++i];
    else if (argv[i] === "-o") out = argv[++i];
    else if (!dir) dir = argv[i];
    else { console.error(USAGE); return 2; }
  }
  if (!dir || !prefix) { console.error(USAGE); return 2; }
  const pack: IconPack = { prefix, icons: {} };
  for (const f of readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".svg")).sort()) {
    const text = readFileSync(join(dir, f), "utf8");
    const vb = text.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    const inner = text.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
    if (!vb || !inner) { console.error(`warning: skipped ${f} (no viewBox)`); continue; }
    pack.icons[iconName(f)] = { body: inner[1].trim(), width: Number(vb[1]), height: Number(vb[2]) };
  }
  const target = out ?? `${prefix}.json`;
  writeFileSync(target, JSON.stringify(pack));
  console.log(`✅ ${target} (${Object.keys(pack.icons).length} icons)`);
  return 0;
}

interface NetPolicy { network: boolean; allowHosts?: string[] }
async function loadIcon(ref: string, base: string, net: NetPolicy): Promise<IconLoadResult> {
  if (/^https?:/.test(ref)) {
    if (!net.network) return { ok: false, reason: "network access disabled (--no-network)" };
    return fetchIcon(ref, { allowHosts: net.allowHosts });
  }
  if (ref.startsWith("data:")) return { ok: false, reason: "data: URLs are only supported in the browser player" };
  const file = resolve(base, ref);
  try {
    const size = statSync(file).size;
    if (size > ICON_DEFAULTS.maxBytes) return { ok: false, reason: `file too large (${size} > ${ICON_DEFAULTS.maxBytes} bytes)` };
    return iconFromUntrustedSvg(readFileSync(file, "utf8"));
  } catch (e) { return { ok: false, reason: `cannot read ${file} (${(e as NodeJS.ErrnoException).code ?? "unknown"})` }; }
}

export async function main(argv: string[]): Promise<number> {
  if (argv[0] === "icons") return iconsCommand(argv.slice(1));
  const packFiles: string[] = [];
  const net: NetPolicy = { network: true };
  let input: string | undefined, out: string | undefined, lang: Lang = "en", choices: number[] = [];
  const bad = () => { console.error(USAGE); return 2; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (i + 1 < argv.length && !argv[i + 1].startsWith("-") ? argv[++i] : undefined);
    if (a === "-o" || a === "--out") { out = val(); if (!out) return bad(); }
    else if (a === "--lang") { const v = val(); if (v !== "en" && v !== "ko") return bad(); lang = v; }
    else if (a === "--choice") {
      const v = val(); if (!v || !/^\d+(,\d+)*$/.test(v)) return bad();
      choices = v.split(",").map(Number);
    }
    else if (a === "--icons") { const v = val(); if (!v) return bad(); packFiles.push(v); }
    else if (a === "--no-network") net.network = false;
    else if (a === "--allow-host") { const v = val(); if (!v) return bad(); (net.allowHosts ??= []).push(v); }
    else if (a === "-h" || a === "--help") { console.log(USAGE); return 0; }
    else if (a.startsWith("-") || input) return bad();
    else input = a;
  }
  if (!input) return bad();
  let src: string;
  try { src = readFileSync(input, "utf8"); }
  catch (e) { console.error(`error: cannot read ${input} (${(e as NodeJS.ErrnoException).code ?? "unknown"})`); return 1; }
  const { doc, diagnostics } = parse(src);
  const packs: IconPack[] = [];
  for (const f of packFiles) {
    let data: unknown;
    try { data = JSON.parse(readFileSync(f, "utf8")); }
    catch (e) { console.error(`error: cannot load icon pack ${f} (${(e as Error).message})`); return 1; }
    const errs = validateIconPack(data);
    if (errs.length) { console.error(`error: invalid icon pack ${f}:\n  - ${errs.join("\n  - ")}`); return 1; }
    packs.push(data as IconPack);
  }
  diagnostics.push(...checkIcons(doc, packs));
  if (diagnostics.length) console.error(formatAll(src, diagnostics, lang) + "\n");
  if (diagnostics.some((d) => d.severity === "error")) return 1;
  const tl = buildTimeline(doc, { choices });
  choices.forEach((c, i) => {
    const b = tl.branches[i];
    if (!b) console.error(`warning: choice ${c} ignored — there are only ${tl.branches.length} branch(es)`);
    else if (c >= b.arms.length) console.error(`warning: choice ${c} for branch ${i + 1} is out of range (0-${b.arms.length - 1}); using 0`);
  });
  const icons = new Map<string, ResolvedIcon>();
  const refs = [...new Set([...doc.nodes.values()].map((n) => n.icon).filter((i): i is string => !!i))];
  for (const ref of refs.filter((r) => !isIconUrl(r))) { const ic = resolveIcon(ref, packs); if (ic) icons.set(ref, ic); }
  const urlRefs = refs.filter(isIconUrl);
  const results = await Promise.all(urlRefs.map((r) => loadIcon(r, dirname(input!), net)));
  results.forEach((res, i) => {
    if (res.ok) icons.set(urlRefs[i], res.icon);
    else console.error(`warning: cannot load icon ${urlRefs[i]}: ${res.reason}`);
  });
  const lay = doc.kind === "sequence" ? layoutSequence(doc, tl) : await layout(doc, tl);
  const svg = renderSvg(lay, tl, { title: doc.title, icons });
  const target = out ?? input.replace(/\.[^./\\]+$/, "") + ".svg";
  writeFileSync(target, svg);
  console.log(`✅ ${target} (${tl.steps.length} steps, ${tl.total.toFixed(1)}s)`);
  return 0;
}
