# AGENTS.md

Guidance for AI coding agents working in this repository.

## Layout

pnpm monorepo, Node >= 22. Packages under `packages/`, published as `@ene-diagram/*`:

- `core` — parser, timeline and diagnostics for the ene language
- `layout` — layout engine (ELK + sequence)
- `svg` — animated SVG renderer
- `player` — browser player
- `video` — GIF / MP4 export (needs Chrome and ffmpeg)
- `cli` — command-line renderer (`packages/cli/bin/ene.mjs`)

`SYNTAX.md` is the single-page syntax reference. `llms.txt` and `site/llms.txt` are copies of it.
`skills/ene` is the agent skill for writing ene diagrams.

## Commands

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test        # vitest
pnpm lint        # biome check
pnpm format      # biome format --write
pnpm changeset   # record a user-facing change
```

## Rules

- Run `pnpm typecheck`, `pnpm test` and `pnpm lint` before finishing.
- Every ` ```ene ` block in `SYNTAX.md` must parse; `packages/core/test/syntax-doc.test.ts` checks it and checks that the `llms.txt` copies match `SYNTAX.md`. Edit `SYNTAX.md` and copy it to both `llms.txt` files.
- New or changed diagnostics need both `en` and `ko` messages in `packages/core/src/diagnostics.ts`.
- Syntax changes: update `README.md` and `README.ko.md`.
- PRs with user-facing changes include a changeset (`pnpm changeset`). All `@ene-diagram/*` packages share one version. Publishing to npm is manual (`pnpm release`); never add a CI publish step.
