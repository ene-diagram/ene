// Bundle the extension host code into one CJS file and copy the browser player next to the webview script.
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const here = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
await build({
  entryPoints: [here("src/extension.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  outfile: here("dist/extension.js"),
  minify: true,
  sourcemap: false,
  logLevel: "warning",
});
mkdirSync(here("media"), { recursive: true });
for (const f of ["ene.js", "ene-elk.js"]) {
  const src = here(`../player/dist/${f}`);
  if (!existsSync(src)) throw new Error(`missing ${src}: run \`pnpm -C packages/player bundle\` first`);
  copyFileSync(src, here(`media/${f}`));
}
