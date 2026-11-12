import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { buildTimeline, checkIcons, diagnosticToJson, formatAll, isIconUrl, parse, resolveIcon, validateIconPack, type IconPack, type Lang, type ResolvedIcon } from "@ene/core";
import { layout, layoutSequence } from "@ene/layout";
import { iconFromSvgText, renderSvg } from "@ene/svg";

const USAGE = `usage: ene <input.ene> [-o out.svg] [--lang en|ko] [--choice 0,1] [--icons pack.json ...]
       ene check <input.ene> [--json] [--lang en|ko] [--icons pack.json ...]
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

async function loadIcon(ref: string, base: string): Promise<ResolvedIcon | undefined> {
  try {
    if (/^https?:/.test(ref)) { const r = await fetch(ref); return r.ok ? iconFromSvgText(await r.text()) : undefined; }
    if (ref.startsWith("data:")) return undefined;
    return iconFromSvgText(readFileSync(resolve(base, ref), "utf8"));
  } catch { return undefined; }
}

/** `ene check`: parse and check icons without rendering. Exit 1 on errors, 2 on usage errors */
function checkCommand(argv: string[]): number {
  let input: string | undefined, json = false, lang: Lang = "en";
  const packFiles: string[] = [];
  const bad = () => { console.error(USAGE); return 2; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--lang") { const v = argv[++i]; if (v !== "en" && v !== "ko") return bad(); lang = v; }
    else if (a === "--icons") { const v = argv[++i]; if (!v) return bad(); packFiles.push(v); }
    else if (a.startsWith("-") || input) return bad();
    else input = a;
  }
  if (!input) return bad();
  let src: string;
  try { src = readFileSync(input, "utf8"); }
  catch (e) { console.error(`error: cannot read ${input} (${(e as NodeJS.ErrnoException).code ?? "unknown"})`); return 1; }
  const packs: IconPack[] = [];
  for (const f of packFiles) {
    let data: unknown;
    try { data = JSON.parse(readFileSync(f, "utf8")); }
    catch (e) { console.error(`error: cannot load icon pack ${f} (${(e as Error).message})`); return 1; }
    const errs = validateIconPack(data);
    if (errs.length) { console.error(`error: invalid icon pack ${f}:\n  - ${errs.join("\n  - ")}`); return 1; }
    packs.push(data as IconPack);
  }
  const { doc, diagnostics } = parse(src);
  diagnostics.push(...checkIcons(doc, packs));
  diagnostics.sort((a, b) => a.span.line - b.span.line || a.span.col - b.span.col);
  if (json) console.log(JSON.stringify(diagnostics.map((d) => diagnosticToJson(d, lang)), null, 2));
  else if (diagnostics.length) console.error(formatAll(src, diagnostics, lang));
  else console.log(`✅ ${input}: no problems`);
  return diagnostics.some((d) => d.severity === "error") ? 1 : 0;
}

export async function main(argv: string[]): Promise<number> {
  if (argv[0] === "icons") return iconsCommand(argv.slice(1));
  if (argv[0] === "check") return checkCommand(argv.slice(1));
  const packFiles: string[] = [];
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
    else if (a === "-h" || a === "--help") { console.log(USAGE); return 0; }
    else if (a.startsWith("-") || input) return bad();
    else input = a;
  }
  if (!input) return bad();
  let src: string;
  try { src = readFileSync(input, "utf8"); }
  catch (e) { console.error(`error: cannot read ${input} (${(e as NodeJS.ErrnoException).code ?? "unknown"})`); return 1; }
  const { doc, diagnostics } = parse(src);
  let packs: IconPack[];
  try { packs = packFiles.map((f) => JSON.parse(readFileSync(f, "utf8")) as IconPack); }
  catch (e) { console.error(`error: cannot load icon pack (${(e as Error).message})`); return 1; }
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
  for (const n of doc.nodes.values()) {
    if (!n.icon || icons.has(n.icon)) continue;
    const ic = isIconUrl(n.icon) ? await loadIcon(n.icon, dirname(input)) : resolveIcon(n.icon, packs);
    if (ic) icons.set(n.icon, ic);
    else if (isIconUrl(n.icon)) console.error(`warning: cannot load icon ${n.icon}`);
  }
  const lay = doc.kind === "sequence" ? layoutSequence(doc, tl) : await layout(doc, tl);
  const svg = renderSvg(lay, tl, { title: doc.title, icons });
  const target = out ?? input.replace(/\.[^./\\]+$/, "") + ".svg";
  writeFileSync(target, svg);
  console.log(`✅ ${target} (${tl.steps.length} steps, ${tl.total.toFixed(1)}s)`);
  return 0;
}
