// ene GitHub Action: render .ene files to SVG, check them, then commit the SVGs or fail when stale.
// All inputs arrive as environment variables; every command runs through execFileSync with an
// argument array (no shell), so input values are never parsed as shell code.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Split an input on newlines and on commas outside `{...}`, trimming blanks */
export function list(v) {
  const out = [];
  let cur = "", depth = 0;
  for (const c of v ?? "") {
    if (c === "{") depth++;
    else if (c === "}" && depth) depth--;
    if (c === "\n" || (c === "," && !depth)) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Glob → RegExp. Supports `**`, `*`, `?` and `{a,b}`; paths use `/` */
export function globToRegExp(glob) {
  let re = "", i = 0, brace = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i += 2;
      if (glob[i] === "/") { re += "(?:.*/)?"; i++; } else re += ".*";
      continue;
    }
    if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") { re += "(?:"; brace++; }
    else if (c === "}" && brace) { re += ")"; brace--; }
    else if (c === "," && brace) re += "|";
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
    i++;
  }
  return new RegExp(`^${re}$`);
}

/** The directory part of a glob before its first wildcard: `docs/diagrams/**\/*.ene` → `docs/diagrams` */
export function globBase(glob) {
  const parts = glob.split("/");
  const fixed = [];
  for (const p of parts.slice(0, -1)) { if (/[*?{]/.test(p)) break; fixed.push(p); }
  return fixed.join("/");
}

/**
 * Pair each matching .ene file with its SVG path.
 * Without outputDir the SVG sits next to the source; with it, the path below the glob's base is kept.
 */
export function plan(files, globs, outputDir) {
  const seen = new Map();
  for (const g of globs) {
    const re = globToRegExp(g.replace(/^\.\//, ""));
    const base = globBase(g.replace(/^\.\//, ""));
    for (const f of files) {
      if (!f.endsWith(".ene") || seen.has(f) || !re.test(f)) continue;
      const svg = f.replace(/\.ene$/, ".svg");
      const rel = base && svg.startsWith(base + "/") ? svg.slice(base.length + 1) : svg;
      seen.set(f, outputDir ? join(outputDir, rel).split(sep).join("/") : svg);
    }
  }
  const bySvg = new Map();
  for (const [src, out] of seen) {
    if (bySvg.has(out)) throw new Error(`${bySvg.get(out)} and ${src} would both be written to ${out}; use separate output-dir runs or rename one`);
    bySvg.set(out, src);
  }
  return [...seen].map(([src, out]) => ({ src, out })).sort((a, b) => a.src.localeCompare(b.src));
}

/** Escape for workflow commands: https://github.com/actions/toolkit/blob/main/packages/core/src/command.ts */
const escData = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escProp = (s) => escData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** One `::error`/`::warning` annotation for a diagnostic from `ene check --json` */
export function annotation(file, d) {
  const level = d.severity === "error" ? "error" : "warning";
  const msg = d.hint ? `${d.message} (${d.hint})` : d.message;
  return `::${level} file=${escProp(file)},line=${Number(d.line) || 1},col=${Number(d.col) || 1},title=${escProp(`ene ${d.code}`)}::${escData(msg)}`;
}

/** Only plain npm versions, ranges and dist-tags are accepted */
export const validVersion = (v, platform = process.platform) =>
  // Windows runs npm through cmd.exe, where | < > ^ and spaces mean something: allow only exact versions, x-ranges and tags there
  (platform === "win32" ? /^[\w.*+-]+$/ : /^[\w.^~<>=*|+-]+( [\w.^~<>=*|+-]+)*$/).test(v) && !v.startsWith("-");

function gitFiles() {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", maxBuffer: 64 << 20 });
  return [...new Set(out.split("\0").filter(Boolean))];
}

function setOutput(name, value) {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  const delim = `ENE_${Math.random().toString(36).slice(2)}`;
  appendFileSync(f, `${name}<<${delim}\n${value}\n${delim}\n`);
}

function installCli(version) {
  if (!validVersion(version)) throw new Error(`invalid version input: ${JSON.stringify(version)}`);
  const dir = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "ene-cli-"));
  execFileSync("npm", ["install", "--no-save", "--no-audit", "--no-fund", "--ignore-scripts", "--prefix", dir, `@ene-diagram/cli@${version}`], { stdio: ["ignore", "inherit", "inherit"], shell: process.platform === "win32" });
  return join(dir, "node_modules", "@ene-diagram", "cli", "bin", "ene.mjs");
}

/**
 * Branch to push commit-mode changes to: the checked-out branch, or undefined on a detached checkout.
 * Detached is the default for pull_request runs, where HEAD is GitHub's synthetic merge commit; committing on
 * top of it would push base-branch changes into the PR branch, so commit mode refuses there.
 */
export function pushBranch() {
  try {
    return execFileSync("git", ["symbolic-ref", "-q", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch { return undefined; }
}

export function main(env = process.env) {
  const mode = env.ENE_MODE || "check";
  if (mode !== "check" && mode !== "commit") { console.log(`::error::mode must be check or commit, got ${escData(mode)}`); return 1; }
  const choice = (env.ENE_CHOICE || "").trim();
  if (choice && !/^\d+(,\d+)*$/.test(choice)) { console.log(`::error::choice must look like 0,1`); return 1; }
  const outputDir = (env.ENE_OUTPUT_DIR || "").trim();
  if (outputDir && (resolve(outputDir) + sep).indexOf(resolve(".") + sep) !== 0) { console.log(`::error::output-dir must be inside the workspace`); return 1; }

  // Decide where commit mode pushes before writing anything, so a refusal leaves the checkout untouched
  const target = mode === "commit" ? pushBranch() : undefined;
  if (mode === "commit" && !target) { console.log("::error::ene: commit mode needs a checked-out branch, but HEAD is detached (on pull_request runs it is a merge commit). Use actions/checkout with ref: ${{ github.head_ref }}, or mode: check"); return 1; }

  let jobs;
  try { jobs = plan(gitFiles(), list(env.ENE_FILES || "**/*.ene"), outputDir); }
  catch (e) { console.log(`::error::${escData(e.message)}`); return 1; }
  if (!jobs.length) { console.log("::warning::no .ene files matched"); setOutput("changed", ""); return 0; }
  console.log(`ene: ${jobs.length} file(s)`);

  const cli = env.ENE_CLI_PATH ? resolve(env.ENE_CLI_PATH) : installCli(env.ENE_VERSION || "0.1");
  const ene = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
  const packs = list(env.ENE_ICONS);
  const iconArgs = packs.flatMap((p) => ["--icons", p]);
  const renderArgs = [...iconArgs, ...(choice ? ["--choice", choice] : []), ...(env.ENE_NETWORK === "true" ? [] : ["--no-network"])];

  let failed = false;
  // 1. ene check --json → annotations
  for (const { src } of jobs) {
    const r = ene(["check", src, "--json", ...iconArgs]);
    let diags;
    try { diags = JSON.parse(r.stdout || "[]"); } catch { diags = null; }
    if (!Array.isArray(diags)) { console.log(`::error file=${escProp(src)}::${escData((r.stderr || r.stdout || "ene check failed").trim())}`); failed = true; continue; }
    for (const d of diags) console.log(annotation(src, d));
    if (r.status !== 0) failed = true;
  }
  // 2. ene fmt --check
  if (env.ENE_FMT_CHECK !== "false") {
    const r = ene(["fmt", "--check", ...jobs.map((j) => j.src)]);
    for (const line of (r.stderr || "").split("\n")) {
      const m = /^not formatted: (.+)$/.exec(line.trim());
      if (m) console.log(`::error file=${escProp(m[1])},title=ene fmt::not formatted (run ene fmt --write ${escData(m[1])})`);
      else if (line.trim()) console.log(line);
    }
    if (r.status !== 0) failed = true;
  }
  // 3. Render to a temp dir and compare with the committed SVGs
  const tmp = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "ene-out-"));
  const changed = [];
  try {
    jobs.forEach(({ src, out }, i) => {
      const t = join(tmp, `${i}.svg`);
      const r = ene([src, "-o", t, ...renderArgs]);
      if (r.stderr.trim()) console.log(r.stderr.trim());
      if (r.status !== 0 || !existsSync(t)) { console.log(`::error file=${escProp(src)}::cannot render ${escData(src)}`); failed = true; return; }
      const next = readFileSync(t);
      if (existsSync(out) && readFileSync(out).equals(next)) return;
      changed.push(out);
      if (mode === "check") console.log(`::error file=${escProp(existsSync(out) ? out : src)},title=ene::${escData(out)} is ${existsSync(out) ? "stale" : "missing"} (regenerate with: ene ${escData(src)} -o ${escData(out)})`);
      else { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, next); }
    });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  setOutput("changed", changed.join("\n"));

  if (mode === "check") {
    if (changed.length) failed = true;
    console.log(changed.length ? `ene: ${changed.length} SVG(s) out of date` : failed ? "ene: failed" : "ene: all SVGs are up to date");
    return failed ? 1 : 0;
  }
  if (failed) { console.log("::error::ene check failed; not committing"); return 1; }
  if (!changed.length) { console.log("ene: nothing to commit"); return 0; }
  const git = (args) => execFileSync("git", args, { stdio: "inherit" });
  git(["add", "--", ...changed]);
  const name = env.GIT_COMMITTER_NAME || "github-actions[bot]";
  const email = env.GIT_COMMITTER_EMAIL || "41898282+github-actions[bot]@users.noreply.github.com";
  git(["-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-m", env.ENE_COMMIT_MESSAGE || "chore: regenerate ene diagrams", "--", ...changed]);
  git(["push", "origin", `HEAD:refs/heads/${target}`]);
  console.log(`ene: committed ${changed.length} SVG(s)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
