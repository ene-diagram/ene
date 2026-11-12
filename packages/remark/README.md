# @ene-diagram/remark

Render ```` ```ene ```` code blocks in Markdown and MDX, the way ```` ```mermaid ```` works on many docs sites.

- **static** (default): the diagram is rendered at build time into an inline, self-playing SVG. No client JavaScript, no DOM needed during the build.
- **live**: the block becomes `<pre class="ene">` for the [browser player](../../README.md#in-a-web-page) (play, pause, step, pick a branch).

```sh
npm install -D @ene-diagram/remark
```

````md
```ene title="Checkout" choice=1
user -> api : POST /order
api -> pay : charge
branch ok
  pay --> api : paid
else declined
  pay -x api : declined
end
```
````

## Options

```js
import remarkEne from "@ene-diagram/remark";

remarkEne({
  mode: "static",      // or "live"
  choice: [0],         // default branch arms for static SVGs (like `ene --choice 0`)
  title: undefined,    // override every diagram's title
  icons: [pack],       // icon packs (Iconify JSON, see `ene icons`)
  network: false,      // fetch https:// icons at build time (off by default)
  allowHosts: [],      // with network: only these hosts
  failOnError: false,  // true: fail the build on diagram errors
  script: "https://cdn.jsdelivr.net/npm/@ene-diagram/player@0.1/dist/ene.js", // live mode; false to load it yourself
  mdx: undefined,      // auto-detected; force true/false if needed
  className: "ene-diagram",
  lang: "en",          // diagnostic language: "en" | "ko"
});
```

Per block, the fence meta can set `title="..."`, `choice=1,0`, and `live` or `static`.

**Errors.** A block with errors is replaced by a visible `<div class="ene-error">` that shows the diagnostics, and a message is added to the file (`vfile.messages`). With `failOnError: true` the build fails instead.

**Security.** All text from diagram source is escaped. Icons from packs are embedded as isolated data-URI images. Remote icons are only fetched with `network: true`; local file icons (`./x.svg`) are not read — use an icon pack.

**Multiple diagrams on a page.** Element ids and the stylesheet of each inline SVG are scoped to that SVG, so diagrams do not affect each other or the page.

**MDX.** In MDX the plugin emits `<div dangerouslySetInnerHTML>` instead of raw HTML, and never adds a `<script>` in live mode (React does not run it). Load the player once from your layout instead.

## Astro

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import remarkEne from "@ene-diagram/remark";

export default defineConfig({
  markdown: { remarkPlugins: [[remarkEne, { failOnError: true }]] },
});
```

`@astrojs/mdx` inherits `markdown.remarkPlugins`, so `.mdx` pages work too.

## Next.js (MDX)

```js
// next.config.mjs
import createMDX from "@next/mdx";
import remarkEne from "@ene-diagram/remark";

const withMDX = createMDX({ options: { remarkPlugins: [[remarkEne, {}]] } });
export default withMDX({ pageExtensions: ["ts", "tsx", "md", "mdx"] });
```

With Turbopack, plugins must be passed by name: `remarkPlugins: [["@ene-diagram/remark", {}]]`.
For live mode, add the player with `next/script` in your layout:
`<Script src="https://cdn.jsdelivr.net/npm/@ene-diagram/player@0.1/dist/ene.js" strategy="afterInteractive" />`.
After client-side navigation, call `window.ene.autoRun()` to pick up new blocks.

## Docusaurus

```js
// docusaurus.config.js
import remarkEne from "@ene-diagram/remark";

export default {
  presets: [["classic", { docs: { remarkPlugins: [[remarkEne, { mdx: true }]] } }]],
  // live mode: scripts: [{ src: "https://cdn.jsdelivr.net/npm/@ene-diagram/player@0.1/dist/ene.js", defer: true }],
};
```

Docusaurus parses `.md` files as MDX as well; `mdx: true` makes that explicit. Add the plugin to `blog` and `pages` the same way if you need it there.

## VitePress (markdown-it)

VitePress uses markdown-it, which renders synchronously, so the markdown-it plugin uses the live player:

```js
// .vitepress/config.mjs
import { defineConfig } from "vitepress";
import markdownItEne from "@ene-diagram/remark/markdown-it";

export default defineConfig({
  markdown: { config: (md) => md.use(markdownItEne, { script: false }) },
  head: [["script", { src: "https://cdn.jsdelivr.net/npm/@ene-diagram/player@0.1/dist/ene.js", defer: "" }]],
});
```

Use `script: false` in VitePress: a `<script>` in Markdown is treated as a Vue component script. The block carries `v-pre`, so `{{ }}` in labels is left alone. After client-side navigation, call `window.ene.autoRun()` (for example in a theme `onAfterRouteChange` hook).

For static SVGs on a markdown-it site, render ahead of time with the CLI (`ene file.ene -o file.svg`) or with `renderEne` from this package, and reference the SVG as an image.

## API

- `remarkEne(options)` — the remark plugin (default export).
- `renderEne(source, options)` → `{ ok: true, svg, warnings } | { ok: false, error, warnings }` — build-time render without remark.
- `markdownItEne(md, options)` — from `@ene-diagram/remark/markdown-it`.
