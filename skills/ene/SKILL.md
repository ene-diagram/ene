---
name: ene
description: Draw an animated data-flow or sequence diagram with ene — text in, a self-playing SVG out. Use when the user asks to draw, animate or visualize a request flow, an architecture flow, a retry/failure path, a cache hit/miss, a sequence diagram, or says "ene diagram", "ene 다이어그램", "흐름 그려줘", "요청 흐름 애니메이션", "시퀀스 다이어그램 움직이게". Not for static structure diagrams (class, ER, org charts) — ene only helps when the order of events matters.
---

# ene

ene turns a few lines of text into a diagram where data moves along the arrows, one step per line.
You write a `.ene` file, check it, and render it to an SVG that plays by itself.

All commands below go through the wrapper next to this file. `<skill>` is this skill's directory:

```bash
node <skill>/ene.mjs check flow.ene --json    # diagnostics as JSON, exit 1 on errors
node <skill>/ene.mjs fmt --write flow.ene     # canonical formatting
node <skill>/ene.mjs flow.ene -o flow.svg     # render (add --choice 1 to pick another branch arm)
node <skill>/ene.mjs flow.ene -o flow.gif     # or .mp4, for places that do not play SVG
```

## Workflow

1. **Read `SYNTAX.md` in this directory before writing anything.** It is one page and it is the whole language.
   Do not guess syntax from Mermaid or D2 — arrows, blocks and comments differ.
2. **Find the flow.** From the user's description or their code, list the participants and then what happens,
   in order: who calls whom, what comes back, where it can fail, where the path forks. If the order is unclear
   from the code, read the code — do not invent steps.
3. **Write the `.ene` file** next to what it documents (or where the user says). Follow the style rules below.
4. **Check and fix in a loop.** Run `check --json`. Each diagnostic has `line`, `col`, `message`, `hint` and
   sometimes `suggestion` (a replacement for the marked text). Fix every error. Read every warning: fix it, or
   keep it only when the input is really what you mean. Repeat until there are no errors.
5. **Format** with `fmt --write`.
6. **Render** to SVG. If the diagram has `branch` blocks, render the default path and, when the other path
   matters, a second file with `--choice` (arm numbers per branch in source order, from 0: `--choice 1`,
   `--choice 0,1`).
7. **Report** the `.ene` and `.svg` paths, the steps in one or two sentences, and how to embed it:
   `![title](flow.svg)` in Markdown. The exported SVG loops on its own; interactive controls
   (play, step, branch menu) exist only in the browser player.

## Style rules

- **Declare nodes first, then write edges by id.** One declaration per line (`api[Order API]{shape: db}`),
  then edges that only use ids. Later edits stay single-line, and in `diagram sequence` the declaration order
  is the left-to-right order.
- **One line is one step.** Things that happen at the same time go on one line with ` & `.
- **Pick the diagram kind by the question.** `diagram sequence` when the point is the order of messages between
  a few participants (up to about 6). The default flow layout when the point is the path through a system.
- **Use the three arrows for what they mean:** `->` request, `-->` response, `-x` failure. A failure needs
  spaces around `-x`.
- **Alternatives are `branch` / `else` / `end`,** not two diagrams. Every arm needs at least one step and a
  short label (`branch cache hit` / `else cache miss`).
- **Labels are what travels,** short enough to read while moving: `POST /order`, `miss`, `502 retry later`.
  Aim for under 25 characters.
- **Keep it small.** Up to about 12 nodes and 15 steps. Split a larger story into two diagrams.
- **Comments go on their own line.** After a label, `#` is label text.
- **Icons only when a pack is available.** `icon: logos:redis` needs `--icons <pack.json>` at render time;
  without a pack leave icons out and use `shape` (`db`, `queue`, `circle`, `round`) and `color`.
- **Use `wait` and `@2s` sparingly,** where the delay is the point (timeouts, backoff).

## Example

```
title Cache hit / miss
client[Client]
api[API]
redis[Redis]{shape: db}
db[MySQL]{shape: db}

client -> api : GET /product/42
api -> redis : GET product:42
branch cache hit
  redis --> api : product
else cache miss
  redis --> api : nil
  api -> db : SELECT
  db --> api : product
  api -> redis : SET product:42
end
api --> client : 200
```

## Starting from Mermaid

If the user already has a Mermaid `sequenceDiagram`, `flowchart` or `graph` (a `.mmd` file or a ```` ```mermaid ```` block in Markdown),
convert it instead of rewriting it by hand, then continue from step 4 of the workflow:

```bash
node <skill>/ene.mjs from-mermaid diagram.mmd -o diagram.ene
```

Read the warnings: they name each line that was dropped or changed (orphan notes, activation, `loop` counts).
A flowchart has no time axis: each link becomes one step in source order, so reorder the steps to match the
real flow before rendering. Other Mermaid diagram kinds cannot be converted.

## When something does not fit

- The user wants a static structure (classes, tables, org chart): say ene is the wrong tool and suggest Mermaid.
- The user wants to paste it into Slack, Notion or slides, which do not play animated SVG: render a GIF or MP4
  instead (`-o flow.gif`, `-o flow.mp4`; needs Chrome and ffmpeg — if the command reports one missing, tell the user).
- The user wants a live page: the browser player turns `<pre class="ene">` blocks into players (see the project README).
- A check error you cannot resolve after two attempts: show the user the diagnostic and the line, and ask.
