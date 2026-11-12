import { readFileSync, writeFileSync } from "node:fs";
import { buildTimeline, formatAll, parse, type Lang } from "@ene/core";
import { layout } from "@ene/layout";
import { renderSvg } from "@ene/svg";

const USAGE = "usage: ene <input.ene> [-o out.svg] [--lang en|ko] [--choice 0,1]";

export async function main(argv: string[]): Promise<number> {
  let input: string | undefined, out: string | undefined, lang: Lang = "en", choices: number[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") out = argv[++i];
    else if (a === "--lang") lang = argv[++i] === "ko" ? "ko" : "en";
    else if (a === "--choice") choices = (argv[++i] ?? "").split(",").map(Number);
    else if (a === "-h" || a === "--help") { console.log(USAGE); return 0; }
    else if (!input) input = a;
    else { console.error(USAGE); return 2; }
  }
  if (!input) { console.error(USAGE); return 2; }
  const src = readFileSync(input, "utf8");
  const { doc, diagnostics } = parse(src);
  if (diagnostics.length) console.error(formatAll(src, diagnostics, lang) + "\n");
  if (diagnostics.some((d) => d.severity === "error")) return 1;
  const tl = buildTimeline(doc, { choices });
  const svg = renderSvg(await layout(doc, tl), tl, { title: doc.title });
  const target = out ?? input.replace(/\.[^./\\]+$/, "") + ".svg";
  writeFileSync(target, svg);
  console.log(`✅ ${target} (${tl.steps.length} steps, ${tl.total.toFixed(1)}s)`);
  return 0;
}
