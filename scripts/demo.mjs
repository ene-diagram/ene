// Builds the demo page (demo/) and the landing page assets (site/):
// player bundle, icon subset, animated SVGs and demo/index.html.
// Usage: pnpm demo
import { execFileSync } from "node:child_process";
import { copyFileSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const root = new URL("..", import.meta.url).pathname;
const ex = `${root}packages/core/examples/`;
const out = `${root}demo/`;
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
mkdirSync(out, { recursive: true });

run("pnpm", ["exec", "tsc", "-b", "packages/cli"]);
run("pnpm", ["bundle"], `${root}packages/player`);
run("pnpm", ["bundle"], `${root}packages/export`);
for (const f of ["ene.js", "ene-elk.js"]) copyFileSync(`${root}packages/player/dist/${f}`, out + f);
copyFileSync(`${root}packages/export/dist/ene-export.js`, out + "ene-export.js");

const files = readdirSync(ex).filter((f) => f.endsWith(".ene")).sort();
const sources = files.map((f) => [f, readFileSync(ex + f, "utf8")]);

// Only the icons the examples use, from the CC0 @iconify-json/logos pack.
const logos = createRequire(import.meta.url)("@iconify-json/logos/icons.json");
const icons = {};
for (const [, src] of sources)
  for (const m of src.matchAll(/logos:([\w-]+)/g)) {
    const name = logos.icons[m[1]] ? m[1] : logos.aliases?.[m[1]]?.parent;
    if (name) icons[m[1]] = logos.icons[name];
  }
writeFileSync(out + "logos-subset.js",
  `// Example icon pack: a subset of @iconify-json/logos (CC0). ene itself ships no icons.\n` +
  `ene.registerIconPacks([{ pack: ${JSON.stringify({ prefix: "logos", width: logos.width, height: logos.height, icons })} }]);\n`);

const logosPath = createRequire(import.meta.url).resolve("@iconify-json/logos/icons.json");
for (const [f] of sources)
  run("node", [`${root}packages/cli/bin/ene.mjs`, ex + f, "-o", out + f.replace(/\.ene$/, ".svg"), "--icons", logosPath]);

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const broken = "a -> b\nbrnch hit\n  cahce --> a\napi ->\n";
writeFileSync(out + "index.html", `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ene examples</title>
<style>
body{margin:40px;font-family:system-ui,-apple-system,sans-serif;background:#f5f6f8;color:#1c2024}
h1{font-size:22px} h2{font-size:14px;color:#60646c;font-weight:500;margin:0 0 8px}
section{background:#fff;border:1px solid #e0e1e6;border-radius:12px;padding:16px 20px;margin-bottom:16px;overflow:auto}
@media (prefers-color-scheme: dark){body{background:#0b0b0d;color:#edeef0}section{background:#111113;border-color:#2e3036}}
</style></head><body>
<h1>ene examples</h1>
<p>Space play/pause · ←/→ step · pick branches from the dropdown</p>
${sources.map(([f, src]) => `<section><h2>${f}</h2>\n<pre class="ene">${esc(src)}</pre></section>`).join("\n")}
<section><h2>error messages</h2><pre class="ene">${esc(broken)}</pre></section>
<script src="ene.js"></script><script src="logos-subset.js"></script>
</body></html>
`);
// The landing page uses the same bundle, icon subset and one exported SVG.
const site = `${root}site/`;
mkdirSync(site, { recursive: true });
for (const f of ["ene.js", "ene-elk.js", "ene-export.js", "logos-subset.js", "01-order.svg"]) copyFileSync(out + f, site + f);
// The one-page syntax reference doubles as llms.txt and ships with the Claude skill (kept in sync by syntax-doc.test.ts)
for (const f of [`${root}llms.txt`, `${site}llms.txt`, `${root}skills/ene/SYNTAX.md`]) copyFileSync(`${root}SYNTAX.md`, f);
console.log(`demo ready: ${out}index.html · site assets: ${site}`);
