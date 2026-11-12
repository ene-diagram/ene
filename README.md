<h1 align="center">ene</h1>

<p align="center">
Write data flows as text. Watch the data move.
</p>

<p align="center">
<a href="./README.ko.md">한국어</a>
</p>

---

## Table of content

- [About](#about)
- [Examples](#examples)
- [Getting started](#getting-started)
- [Usage](#usage)
- [Syntax](#syntax)
- [Release](#release)
- [Related projects](#related-projects)
- [Contributors](#contributors)
- [Security](#security)

## About

Architecture diagrams show **what is connected**. They rarely show **what happens** — which request goes first, where it waits, where it fails, which path a cache miss takes.

ene turns a few lines of text into a diagram where the data actually travels along the arrows. Diagrams come with a player — play, pause, step, change speed, and pick a branch to replay a different path. They can also be exported as self-playing SVGs that work anywhere an image works, including GitHub READMEs.

## Examples

**The following are some examples of the diagrams and features ene supports.**

### Flow

```
title Order request
user[User] -> api[API Server] : POST /order
api -> cache[Redis] : check stock
cache --> api : miss
api -> db[MySQL] : SELECT stock & api -> pay[Payment] : charge
db --> api : in stock
pay -x api : timeout
api --> user : 502 retry later
```

![Order request](demo/01-order.svg)

### Branches

```
title Cache hit / miss
client[Client] -> api[API] : GET /product/42
api -> redis[Redis] : GET product:42
branch cache hit
  redis --> api : product
else cache miss
  redis --> api : nil
  api -> db[MySQL] : SELECT
  db --> api : product
  api -> redis : SET product:42
end
api --> client : 200
```

![Cache hit / miss](demo/03-cache.svg)

### Waits and retries

```
title Payment retry
order[Order Service] -> pg[Payment Gateway] : authorize
pg -x order : timeout
wait 1
order -> pg : authorize (retry 1)
pg -x order : 503
wait 2
order -> pg : authorize (retry 2)
pg --> order : approved
order -> ledger[Ledger] : record payment
```

![Payment retry](demo/07-payment-retry.svg)

### Groups, shapes and icons

```
title Order service in a VPC
user[User]{icon: logos:chrome, shape: circle} -> alb[ALB]{icon: logos:aws-elb} : HTTPS
alb -> api[Order API]{icon: logos:aws-ec2} : /orders
api -> cache[Redis]{icon: logos:redis, shape: db} : check stock
cache --> api : hit
api -> db[Orders DB]{icon: logos:aws-rds, shape: db, color: #f59e0b} : INSERT
db --> api : OK
api -> q[SQS]{icon: logos:aws-sqs, shape: queue} : order.created
q -> worker[Worker]{icon: logos:aws-lambda} : consume
worker -> mail[SES]{icon: logos:aws-ses} : confirmation email
api --> user : 201
group vpc[VPC 10.0.0.0/16]{color: #8b5cf6} : alb api cache db worker
group pub[Public subnet]{color: #22c55e} in vpc : alb
group priv[Private subnet]{color: #3b82f6} in vpc : api cache db worker
```

![Order service in a VPC](demo/13-vpc.svg)

### Sequence diagram

```
diagram sequence
title Checkout sequence
user[User] -> api[Order API] : POST /checkout
api -> redis[Redis]{shape: db} : check stock
branch in stock
  redis --> api : OK
  api -> pg[Payment Provider] : authorize
  pg --> api : approved
  api --> user : 201
else sold out
  redis -x api : sold out
  api --> user : 409
end
```

![Checkout sequence](demo/14-sequence-checkout.svg)

More examples in [`packages/core/examples`](packages/core/examples).

## Getting started

**Requirements:** Node.js 20 or newer.

```bash
npm install -g @ene-diagram/cli

printf 'user -> api : GET /\napi --> user : 200\n' > flow.ene
ene flow.ene -o flow.svg
```

Or run it once without installing: `npx @ene-diagram/cli flow.ene -o flow.svg`.

### From source

Needs pnpm 10 as well (`corepack enable` picks the pinned version from `package.json`).

```bash
git clone https://github.com/ene-diagram/ene.git
cd ene
pnpm install
pnpm build          # compiles all packages and the browser bundle

printf 'user -> api : GET /\napi --> user : 200\n' > flow.ene
node packages/cli/bin/ene.mjs flow.ene -o flow.svg
```

To call it as `ene`, add an alias: `alias ene="node $PWD/packages/cli/bin/ene.mjs"`.

`pnpm test` and `pnpm typecheck` run the checks; `pnpm demo` rebuilds `demo/` and `site/`.

## Usage

### In a web page

```html
<pre class="ene">
user -> api : GET /
api --> user : 200
</pre>

<script src="ene.js"></script>
```

Every `<pre class="ene">` on the page becomes a player. Click it and use <kbd>Space</kbd> to play or pause, <kbd>←</kbd> <kbd>→</kbd> to step.

### As an image

```bash
ene flow.ene -o flow.svg
cat flow.ene | ene - > flow.svg   # "-" reads stdin; output goes to stdout
ene flow.ene -o -                # write the SVG to stdout
ene flow.ene -o flow.svg --no-notes   # leave out the `note` captions
```

For places that do not play animated SVG (Slack, Notion, slides, social posts), export a GIF or MP4. The format comes from the extension:

```bash
ene flow.ene -o flow.gif                       # 20 fps
ene flow.ene -o flow.mp4 --choice 1            # 30 fps, 2× pixel density
ene flow.ene -o flow.gif --fps 12 --scale 2    # smaller file / sharper frames
```

This plays one loop of the SVG in headless Chrome and encodes the frames with ffmpeg, so both must be installed (Chrome, Chromium or Edge; `brew install ffmpeg`). `ENE_CHROME` and `ENE_FFMPEG` point at specific executables. It needs Node.js 22 or newer and the `@ene-diagram/video` package, which is optional so that SVG-only installs stay small.

Check a file without rendering (exit 1 on errors). `--json` prints diagnostics for tools and AI agents:

```bash
ene check flow.ene --json
# [{"code":"E401","severity":"error","line":3,"col":5,"length":5,"message":"unknown node \"cahce\"","hint":"did you mean \"cache\"?","suggestion":"cache"}]
```

Format sources canonically (comments are kept; a rewrite that would change the meaning is skipped):

```bash
ene fmt flow.ene            # print
ene fmt --write *.ene       # in place
ene fmt --check *.ene       # exit 1 if any file is not formatted (CI)
```

The SVG loops on its own — no script needed — and respects dark mode and reduced motion.

### Use in a blog

**Hosts that allow a script** (your own site, a Tistory skin, self-hosted WordPress): load the player from a CDN. The major version is pinned, so fixes arrive without breaking changes:

```html
<script src="https://cdn.jsdelivr.net/npm/@ene-diagram/player@0.1/dist/ene.js"></script>
<pre class="ene">
user -> api : POST /order
api --> user : 201
</pre>
```

`https://unpkg.com/@ene-diagram/player@0.1/dist/ene.js` works the same way. `ene.js` (~64 KB) loads `ene-elk.js` (~1.6 MB) from the same folder the first time it draws a flow diagram; pages with only `diagram sequence` diagrams never download it.

**Markdown-only hosts** (no scripts): upload an image instead. Use the SVG (`ene flow.ene -o flow.svg`) where the host keeps SVG animation, otherwise a GIF (`-o flow.gif`).

| Host | Route | Status |
|---|---|---|
| Self-built sites (Astro, Next, Hugo, Jekyll) | CDN script in the layout | the script works in any HTML page; framework plugins are tracked in #52 |
| Tistory (skin HTML), self-hosted WordPress | CDN script | untested |
| velog, Medium, dev.to, Brunch | GIF upload; SVG upload support unknown | untested |
| Hosts that accept iframes | playground embed view (#47) | not available yet |

Entries marked untested have not been checked on the host yet; reports are welcome.

### From Mermaid

Already have a Mermaid `sequenceDiagram`, `flowchart` or `graph`? Convert it, or render it directly:

```bash
ene from-mermaid diagram.mmd > diagram.ene   # editable .ene source
ene from-mermaid README.md -o flow.ene       # takes the first ```mermaid block it can convert in a Markdown file
ene diagram.mmd -o diagram.svg               # convert and render in one go
```

Messages, participants, `alt`/`else`, `opt` (and `break`, as `opt`), `loop`, `par` and the async arrow `-)` (as `~>`) are converted. A `Note` becomes a `note` on the message above it (a comment if there is none), and constructs with no equivalent (activation bars, `rect`, `box`, links) are dropped — each with a warning that names the line. A Mermaid `loop` has no count, so it becomes `loop 2` unless its label has a number.

A `flowchart` / `graph` becomes a flow diagram: nodes keep their labels and the shapes ene has (`(( ))` circle, `( )` / `([ ])` round, `[( )]` db; others are drawn as boxes with a warning), each link becomes one step in source order (`|label|` and `-- label -->` become labels, dotted links become `-->`, `--x` becomes `-x`), and `subgraph` becomes `group` (nested ones use `in`). Styles, classes, click handlers and links to a subgraph are dropped with a warning. A flowchart has no time axis, so the output starts with a comment asking you to review the step order.

### With Claude

The repo ships a Claude skill (`skills/ene`) that writes a `.ene` file from a description or from your code, runs `ene check --json` until it is clean, formats it and renders the SVG.

```bash
pnpm build
pnpm skill:install                      # links it into ~/.claude/skills/ene
pnpm skill:install path/to/project/.claude/skills   # or into one project
```

Then ask Claude Code for a diagram, e.g. "draw the checkout flow as an ene diagram".

### Browser assets

`pnpm build` writes two files to `packages/player/dist/`. Deploy both to the same folder:

| File | What it is |
|---|---|
| `ene.js` | the player (~50 KB) |
| `ene-elk.js` | the ELK layout engine, loaded on first use for flow diagrams |

`ene.js` looks for `ene-elk.js` next to itself. To host it elsewhere, set the URL before the script loads:

```html
<script>window.eneConfig = { elkUrl: "/assets/ene-elk.js", lang: "en" }</script>
<script src="/assets/ene.js"></script>
```

Set `startOnLoad: false` in `eneConfig` to skip the automatic `pre.ene` scan and render yourself:

```js
const player = await ene.render(element, source, {
  autoplay: false, loop: true,
  choices: [1],                                  // start on arm 1 of the first branch
  onChoicesChange: (c) => console.log(c),        // the viewer picked another arm
});
player.setChoices([0]);   // pick arm 0 of the first branch
player.choices;           // [0]
player.toSvg();           // the self-playing SVG for the current choices, as `ene -o x.svg` writes it
player.destroy();         // stop playback and clear the element
```

`render()` resolves to `undefined` when the source has errors (an error box is shown instead).

### GIF and MP4 in the browser

`pnpm build` also writes `packages/export/dist/ene-export.js` (~12 KB, no dependencies). It turns an exported SVG into a GIF, MP4 or WebM without a server, Chrome or ffmpeg:

```html
<script src="ene-export.js"></script>
<script>
  const { blob } = await eneExport.exportVideo(player.toSvg(), { format: "gif", fps: 15, scale: 1, theme: "light" });
</script>
```

- `format`: `gif` (built-in encoder), `mp4` (H.264 through WebCodecs, where the browser has it) or `webm` (MediaRecorder; records in real time, so it takes as long as the animation). `eneExport.videoSupport()` tells which video formats work.
- `theme`: `light` (default), `dark`, or `auto` (follows the viewer). `eneExport.themedSvg(svg, theme)` applies the same to a downloadable SVG.
- Frames are computed from the SVG's animation values, not recorded from a running clock, so the GIF and MP4 match the SVG exactly. Limits: 1800 frames, 60 fps (50 for GIF), scale 4.

### Icon packs

Register [Iconify](https://iconify.design) JSON packs before rendering. `loader` runs once, the first time an icon from the packs is needed:

```js
ene.registerIconPacks([
  { name: "logos", loader: () => fetch("/icons/logos.json").then((r) => r.json()) },
]);
```

For the CLI, pass `--icons pack.json` (repeatable). `ene icons <svg-dir> --prefix aws -o aws.json` builds a pack from a folder of SVGs.

### Branches in the player and in SVG

The player shows one menu per `branch`, so the reader can replay another path. An exported SVG has no controls: it plays one path, chosen with `--choice` (one zero-based arm per `branch` or `opt`, in order; for `opt`, `0` = taken and `1` = skipped; default all `0`):

```bash
ene flow.ene -o miss.svg --choice 1
```

Exported SVGs animate with SMIL (no script). They loop, follow dark mode, and under `prefers-reduced-motion` show every step at once without moving dots. Some hosts that sanitize SVGs may strip the animation.

### Icon loading and network access

An icon is either a pack name (`logos:redis`, from packs you register) or an SVG address: `http(s)://…`, `./`, `../`, `/` or `data:image/svg+xml,…`.

- Remote icons are fetched with a 5 s timeout and a 512 KiB size limit (checked while streaming); the response must be an SVG document.
- The CLI reads relative paths from the `.ene` file's folder (same size limit). `--no-network` disables all remote fetches; `--allow-host <host>` (repeatable) fetches only from listed hosts and refuses redirects. Use both when rendering untrusted input on a server.
- In the browser, `ene.setIconLoading({ timeoutMs, maxBytes, allowHosts })` sets the same limits.
- Icon packs are validated (`prefix`, `icons.*.body`, numeric sizes) before use, and pack bodies are rendered as isolated images.
- A failed icon never fails the render: the node is drawn without an icon and a warning with the reason is printed (CLI stderr / browser console).

## Syntax

| Syntax | Meaning |
|---|---|
| `a -> b : label` | request |
| `a --> b : label` | response (dashed) |
| `a -x b : label` | failure |
| `a ~> b : label` | async (fire-and-forget) |
| `a -> b & a -> c` | at the same time |
| `a -> b : label @2s` | this edge takes 2 seconds |
| `note text` | caption for the step above |
| `wait 0.5` | pause before the next step |
| `branch …` / `else …` / `end` | alternative paths, chosen in the player |
| `opt …` / `end` | optional steps, toggled in the player |
| `loop 3` … `end` | repeat |
| `group vpc[VPC] : a b` | container box |
| `id[Label]{icon: …, shape: db, color: #f59e0b}` | node label and style |
| `id[Label]{…}` on its own line | declare a node without an edge |
| `diagram sequence` | draw as a sequence diagram |

One line is one step, played top to bottom. The complete reference, with common mistakes, is in [SYNTAX.md](SYNTAX.md) (also served as `llms.txt` for AI tools).

## Release

0.1.0 is on npm under the [`@ene-diagram`](https://www.npmjs.com/org/ene-diagram) scope: `@ene-diagram/cli`, `core`, `layout`, `svg`, `player` and the optional `video`.

## Related projects

- [Mermaid](https://github.com/mermaid-js/mermaid) — text-to-diagram for many diagram types
- [D2](https://github.com/terrastruct/d2) — a modern diagram scripting language
- [Iconify](https://iconify.design) — icon packs that ene can use

## Contributors

Contributions will be welcome once the project is public.

## Security

Icons loaded from SVG files or URLs are embedded as images, so scripts inside them never run. Labels are always escaped.

## License

MIT © HelloWook. See [LICENSE](LICENSE). The ELK layout bundle (`ene-elk.js`) is EPL-2.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
