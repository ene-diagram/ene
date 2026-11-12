import { readFileSync, writeFileSync } from "node:fs";
import { buildTimeline, formatAll, parse, type Lang } from "@ene/core";
import { layout } from "@ene/layout";
import { renderSvg } from "@ene/svg";

const USAGE = "usage: ene <input.ene> [-o out.svg] [--lang en|ko] [--choice 0,1]";

export async function main(argv: string[]): Promise<number> {
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
    else if (a === "-h" || a === "--help") { console.log(USAGE); return 0; }
    else if (a.startsWith("-") || input) return bad();
    else input = a;
  }
  if (!input) return bad();
  let src: string;
  try { src = readFileSync(input, "utf8"); }
  catch (e) { console.error(`error: cannot read ${input} (${(e as NodeJS.ErrnoException).code ?? "unknown"})`); return 1; }
  const { doc, diagnostics } = parse(src);
  if (diagnostics.length) console.error(formatAll(src, diagnostics, lang) + "\n");
  if (diagnostics.some((d) => d.severity === "error")) return 1;
  const tl = buildTimeline(doc, { choices });
  choices.forEach((c, i) => {
    const b = tl.branches[i];
    if (!b) console.error(`warning: choice ${c} ignored — there are only ${tl.branches.length} branch(es)`);
    else if (c >= b.arms.length) console.error(`warning: choice ${c} for branch ${i + 1} is out of range (0-${b.arms.length - 1}); using 0`);
  });
  const svg = renderSvg(await layout(doc, tl), tl, { title: doc.title });
  const target = out ?? input.replace(/\.[^./\\]+$/, "") + ".svg";
  writeFileSync(target, svg);
  console.log(`✅ ${target} (${tl.steps.length} steps, ${tl.total.toFixed(1)}s)`);
  return 0;
}
