import { readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  THEMES,
  VERSION,
  buildTimeline,
  checkIcons,
  createIncluder,
  diagnosticToJson,
  formatAll,
  formatSource,
  fromMermaid,
  isIconUrl,
  isTheme,
  parse,
  type ThemeName,
  resolveIcon,
  validateIconPack,
  type IconPack,
  type Lang,
  type ParseOptions,
  type ResolvedIcon,
} from "@ene-diagram/core";
import { layout, layoutSequence } from "@ene-diagram/layout";
import {
  ICON_DEFAULTS,
  fetchIcon,
  iconFromUntrustedSvg,
  loopSeconds,
  renderSvg,
  type IconLoadResult,
} from "@ene-diagram/svg";

const USAGE = `usage: ene --version
       ene <input.ene|input.mmd|-> [-o out.svg|out.gif|out.mp4|-] [--lang en|ko] [--choice 0,1]
                 [--icons pack.json ...] [--no-network] [--allow-host host ...] [--fps n] [--scale n] [--no-notes]
                 [--theme default|mono|high-contrast]
       ene check <input.ene> [--json] [--lang en|ko] [--icons pack.json ...]
       ene fmt <input.ene ...> [--check | --write]
       ene from-mermaid <input.mmd|input.md|-> [-o out.ene|-]
       ene icons <svg-dir> --prefix <name> [-o pack.json]`;

const realOr = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
/**
 * Parse options that let a diagram `include` files next to it. Paths are relative to the including file
 * (the working folder for stdin) and cannot leave the diagram's folder.
 */
const includeFrom = (file: string | undefined): ParseOptions => {
  // Real path, so nested includes (whose names are real paths) resolve from the same place
  const abs = file === undefined ? undefined : realOr(resolve(file));
  return {
    ...(abs ? { file: abs } : {}),
    include: createIncluder({
      rootDir: abs ? dirname(abs) : process.cwd(),
      path: { resolve, dirname, relative, isAbsolute },
      realPath: (p) => realpathSync(p),
      readFile: (p) => readFileSync(p, "utf8"),
    }),
  };
};

/** "Arch_AWS-Lambda_48.svg" → "aws-lambda" */
export const iconName = (file: string) =>
  basename(file, ".svg")
    .replace(/^(Arch|Res|Arch-Category)_/, "")
    .replace(/_(16|32|48|64)$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function iconsCommand(argv: string[]): number {
  let dir: string | undefined, prefix: string | undefined, out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--prefix") prefix = argv[++i];
    else if (argv[i] === "-o") out = argv[++i];
    else if (!dir) dir = argv[i];
    else {
      console.error(USAGE);
      return 2;
    }
  }
  if (!dir || !prefix) {
    console.error(USAGE);
    return 2;
  }
  const pack: IconPack = { prefix, icons: {} };
  for (const f of readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".svg"))
    .sort()) {
    const text = readFileSync(join(dir, f), "utf8");
    const vb = text.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    const inner = text.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
    if (!vb || !inner) {
      console.error(`warning: skipped ${f} (no viewBox)`);
      continue;
    }
    pack.icons[iconName(f)] = { body: inner[1].trim(), width: Number(vb[1]), height: Number(vb[2]) };
  }
  const target = out ?? `${prefix}.json`;
  writeFileSync(target, JSON.stringify(pack));
  console.log(`✅ ${target} (${Object.keys(pack.icons).length} icons)`);
  return 0;
}

interface NetPolicy {
  network: boolean;
  allowHosts?: string[];
}
async function loadIcon(ref: string, base: string, net: NetPolicy): Promise<IconLoadResult> {
  if (/^https?:/.test(ref)) {
    if (!net.network) return { ok: false, reason: "network access disabled (--no-network)" };
    return fetchIcon(ref, { allowHosts: net.allowHosts });
  }
  if (ref.startsWith("data:")) return { ok: false, reason: "data: URLs are only supported in the browser player" };
  const file = resolve(base, ref);
  try {
    const size = statSync(file).size;
    if (size > ICON_DEFAULTS.maxBytes)
      return { ok: false, reason: `file too large (${size} > ${ICON_DEFAULTS.maxBytes} bytes)` };
    return iconFromUntrustedSvg(readFileSync(file, "utf8"));
  } catch (e) {
    return { ok: false, reason: `cannot read ${file} (${(e as NodeJS.ErrnoException).code ?? "unknown"})` };
  }
}

/** `ene check`: parse and check icons without rendering. Exit 1 on errors, 2 on usage errors */
function checkCommand(argv: string[]): number {
  let input: string | undefined,
    json = false,
    lang: Lang = "en";
  const packFiles: string[] = [];
  const bad = () => {
    console.error(USAGE);
    return 2;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--lang") {
      const v = argv[++i];
      if (v !== "en" && v !== "ko") return bad();
      lang = v;
    } else if (a === "--icons") {
      const v = argv[++i];
      if (!v) return bad();
      packFiles.push(v);
    } else if (a.startsWith("-") || input) return bad();
    else input = a;
  }
  if (!input) return bad();
  let src: string;
  try {
    src = readFileSync(input, "utf8");
  } catch (e) {
    console.error(`error: cannot read ${input} (${(e as NodeJS.ErrnoException).code ?? "unknown"})`);
    return 1;
  }
  const packs: IconPack[] = [];
  for (const f of packFiles) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      console.error(`error: cannot load icon pack ${f} (${(e as Error).message})`);
      return 1;
    }
    const errs = validateIconPack(data);
    if (errs.length) {
      console.error(`error: invalid icon pack ${f}:\n  - ${errs.join("\n  - ")}`);
      return 1;
    }
    packs.push(data as IconPack);
  }
  const { doc, diagnostics } = parse(src, includeFrom(input));
  diagnostics.push(...checkIcons(doc, packs));
  diagnostics.sort((a, b) => a.span.line - b.span.line || a.span.col - b.span.col);
  if (json)
    console.log(
      JSON.stringify(
        diagnostics.map((d) => diagnosticToJson(d, lang)),
        null,
        2,
      ),
    );
  else if (diagnostics.length) console.error(formatAll(src, diagnostics, lang));
  else console.log(`✅ ${input}: no problems`);
  return diagnostics.some((d) => d.severity === "error") ? 1 : 0;
}

/** `ene fmt`: print formatted source, or --write in place, or --check (exit 1 if any file would change) */
function fmtCommand(argv: string[]): number {
  let mode: "print" | "check" | "write" = "print";
  const files: string[] = [];
  for (const a of argv) {
    if (a === "--check") mode = "check";
    else if (a === "--write" || a === "-w") mode = "write";
    else if (a.startsWith("-")) {
      console.error(USAGE);
      return 2;
    } else files.push(a);
  }
  if (!files.length || (mode === "print" && files.length > 1)) {
    console.error(USAGE);
    return 2;
  }
  let changed = 0;
  for (const f of files) {
    let src: string;
    try {
      src = readFileSync(f, "utf8");
    } catch (e) {
      console.error(`error: cannot read ${f} (${(e as NodeJS.ErrnoException).code ?? "unknown"})`);
      return 1;
    }
    const out = formatSource(src);
    if (mode === "print") {
      process.stdout.write(out);
      continue;
    }
    if (out === src) continue;
    changed++;
    if (mode === "check") console.error(`not formatted: ${f}`);
    else {
      writeFileSync(f, out);
      console.log(`formatted ${f}`);
    }
  }
  return mode === "check" && changed ? 1 : 0;
}

/** GIF/MP4 go through the optional @ene-diagram/video package (headless Chrome + ffmpeg) */
async function exportVideo(
  svg: string,
  opts: { out: string; format: "gif" | "mp4"; seconds: number; fps?: number; scale?: number },
  summary: string,
): Promise<number> {
  let mod: typeof import("@ene-diagram/video");
  try {
    mod = await import("@ene-diagram/video");
  } catch {
    console.error("error: GIF/MP4 export needs the @ene-diagram/video package (npm install @ene-diagram/video)");
    return 1;
  }
  const tty = process.stderr.isTTY;
  try {
    const r = await mod.renderVideo(svg, {
      ...opts,
      onFrame: tty ? (done, total) => process.stderr.write(`\rframe ${done}/${total}`) : undefined,
    });
    if (tty) process.stderr.write("\r\x1b[K");
    console.log(`✅ ${opts.out} ${summary.slice(0, -1)}, ${r.frames} frames at ${r.fps} fps, ${r.width}×${r.height})`);
    return 0;
  } catch (e) {
    if (tty) process.stderr.write("\r\x1b[K");
    if (!(e instanceof mod.VideoError)) throw e;
    console.error(`error: ${e.message}`);
    return 1;
  }
}

const isMermaidFile = (f: string) => /\.(mmd|mermaid)$/i.test(f);

/** Convert Mermaid text, printing warnings (and the error) to stderr. undefined = nothing usable */
function convertMermaid(text: string, name: string): string | undefined {
  const r = fromMermaid(text);
  for (const w of r.warnings) console.error(`warning: ${name}:${w.line}: ${w.message}`);
  if (r.error) console.error(`error: ${name}: ${r.error}`);
  return r.error ? undefined : r.source;
}

/** `ene from-mermaid`: Mermaid sequenceDiagram / flowchart → .ene source on stdout or -o. Exit 1 if it cannot be converted */
function fromMermaidCommand(argv: string[]): number {
  let input: string | undefined, out: string | undefined;
  const bad = () => {
    console.error(USAGE);
    return 2;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") {
      out = argv[++i];
      if (!out) return bad();
    } else if ((a.startsWith("-") && a !== "-") || input) return bad();
    else input = a;
  }
  if (!input) return bad();
  const fromStdin = input === "-";
  let text: string;
  try {
    text = readFileSync(fromStdin ? 0 : input, "utf8");
  } catch (e) {
    console.error(
      `error: cannot read ${fromStdin ? "stdin" : input} (${(e as NodeJS.ErrnoException).code ?? "unknown"})`,
    );
    return 1;
  }
  const source = convertMermaid(text, fromStdin ? "stdin" : input);
  if (source === undefined) return 1;
  if (!out || out === "-") process.stdout.write(source);
  else {
    writeFileSync(out, source);
    console.error(`✅ ${out}`);
  }
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  if (argv[0] === "-v" || argv[0] === "--version") {
    console.log(VERSION);
    return 0;
  }
  if (argv[0] === "icons") return iconsCommand(argv.slice(1));
  if (argv[0] === "fmt") return fmtCommand(argv.slice(1));
  if (argv[0] === "check") return checkCommand(argv.slice(1));
  if (argv[0] === "from-mermaid") return fromMermaidCommand(argv.slice(1));
  const packFiles: string[] = [];
  const net: NetPolicy = { network: true };
  let input: string | undefined,
    out: string | undefined,
    lang: Lang = "en",
    choices: number[] = [];
  let fps: number | undefined,
    scale: number | undefined,
    theme: ThemeName | undefined,
    notes = true;
  const bad = () => {
    console.error(USAGE);
    return 2;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // "-" alone is a value (stdin/stdout), not a flag
    const val = () =>
      i + 1 < argv.length && (argv[i + 1] === "-" || !argv[i + 1].startsWith("-")) ? argv[++i] : undefined;
    if (a === "-o" || a === "--out") {
      out = val();
      if (!out) return bad();
    } else if (a === "--lang") {
      const v = val();
      if (v !== "en" && v !== "ko") return bad();
      lang = v;
    } else if (a === "--choice") {
      const v = val();
      if (!v || !/^\d+(,\d+)*$/.test(v)) return bad();
      choices = v.split(",").map(Number);
    } else if (a === "--icons") {
      const v = val();
      if (!v) return bad();
      packFiles.push(v);
    } else if (a === "--fps" || a === "--scale") {
      const v = Number(val());
      if (!(v > 0) || !Number.isFinite(v)) return bad();
      if (a === "--fps") fps = v;
      else scale = v;
    } else if (a === "--theme") {
      const v = val() ?? "";
      if (!isTheme(v)) {
        console.error(`error: unknown theme "${v}" (use one of ${THEMES.join(", ")})`);
        return 2;
      }
      theme = v;
    } else if (a === "--no-network") net.network = false;
    else if (a === "--no-notes") notes = false;
    else if (a === "--allow-host") {
      const v = val();
      if (!v) return bad();
      net.allowHosts ??= [];
      net.allowHosts.push(v);
    } else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      return 0;
    } else if ((a.startsWith("-") && a !== "-") || input) return bad();
    else input = a;
  }
  if (!input) return bad();
  let src: string;
  const fromStdin = input === "-";
  try {
    src = readFileSync(fromStdin ? 0 : input, "utf8");
  } catch (e) {
    console.error(
      `error: cannot read ${fromStdin ? "stdin" : input} (${(e as NodeJS.ErrnoException).code ?? "unknown"})`,
    );
    return 1;
  }
  // A Mermaid sequence diagram or flowchart renders directly: it is converted first (see `ene from-mermaid`)
  if (!fromStdin && isMermaidFile(input)) {
    const converted = convertMermaid(src, input);
    if (converted === undefined) return 1;
    src = converted;
  }
  const { doc, diagnostics } = parse(src, includeFrom(fromStdin ? undefined : input));
  const packs: IconPack[] = [];
  for (const f of packFiles) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      console.error(`error: cannot load icon pack ${f} (${(e as Error).message})`);
      return 1;
    }
    const errs = validateIconPack(data);
    if (errs.length) {
      console.error(`error: invalid icon pack ${f}:\n  - ${errs.join("\n  - ")}`);
      return 1;
    }
    packs.push(data as IconPack);
  }
  diagnostics.push(...checkIcons(doc, packs));
  if (diagnostics.length) console.error(`${formatAll(src, diagnostics, lang)}\n`);
  if (diagnostics.some((d) => d.severity === "error")) return 1;
  const tl = buildTimeline(doc, { choices });
  choices.forEach((c, i) => {
    const b = tl.branches[i];
    if (!b) console.error(`warning: choice ${c} ignored — there are only ${tl.branches.length} branch(es)`);
    else if (c >= b.arms.length)
      console.error(`warning: choice ${c} for branch ${i + 1} is out of range (0-${b.arms.length - 1}); using 0`);
  });
  const icons = new Map<string, ResolvedIcon>();
  const refs = [...new Set([...doc.nodes.values()].map((n) => n.icon).filter((i): i is string => !!i))];
  for (const ref of refs.filter((r) => !isIconUrl(r))) {
    const ic = resolveIcon(ref, packs);
    if (ic) icons.set(ref, ic);
  }
  const urlRefs = refs.filter(isIconUrl);
  const results = await Promise.all(urlRefs.map((r) => loadIcon(r, fromStdin ? process.cwd() : dirname(input!), net)));
  results.forEach((res, i) => {
    if (res.ok) icons.set(urlRefs[i], res.icon);
    else console.error(`warning: cannot load icon ${urlRefs[i]}: ${res.reason}`);
  });
  const lay = doc.kind === "sequence" ? layoutSequence(doc, tl) : await layout(doc, tl);
  // --theme wins over the document's `theme` setting
  const svg = renderSvg(lay, tl, {
    title: doc.title,
    icons,
    notes,
    theme: theme ?? (doc.theme as ThemeName | undefined),
    lang,
  });
  const target = out ?? (fromStdin ? "-" : `${input.replace(/\.[^./\\]+$/, "")}.svg`);
  const summary = `(${tl.steps.length} steps, ${tl.total.toFixed(1)}s)`;
  const video = /\.(gif|mp4)$/i.exec(target)?.[1].toLowerCase() as "gif" | "mp4" | undefined;
  if (!video && (fps !== undefined || scale !== undefined))
    console.error("warning: --fps and --scale only apply to .gif and .mp4 output");
  if (video) return exportVideo(svg, { out: target, format: video, seconds: loopSeconds(tl), fps, scale }, summary);
  if (target === "-") {
    process.stdout.write(svg);
    console.error(`✅ stdout ${summary}`);
  } else {
    writeFileSync(target, svg);
    console.log(`✅ ${target} ${summary}`);
  }
  return 0;
}
