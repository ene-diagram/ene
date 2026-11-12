# ene for VS Code

Editor support for [ene](https://github.com/ene-diagram/ene) animated diagrams (`.ene` files).

- **Highlighting**: keywords, arrows (`->`, `-->`, `-x`), `&`, node labels `[...]`, attributes `{...}`, edge labels, `@2s` durations, `#` comments.
- **Diagnostics as you type** (debounced 250 ms) from `@ene-diagram/core`, the same as `ene check`. Messages follow the VS Code display language (English or Korean).
- **Quick fixes** for "did you mean" diagnostics (`E102` misspelt keyword, `W101` node typo).
- **Format Document** with the core formatter (`ene fmt`).
- **Live preview**: `ene: Open Preview to the Side` (or the preview button in the editor title). Uses the browser player, so animation and the branch menu work; follows the light/dark theme.
- **Export SVG**: `ene: Export SVG` writes an animated SVG (first arm of every branch, like `ene` without `--choice`).

Not supported yet: icon packs (`logos:...`) and URL icons are not loaded in the preview or export (the preview has no network access by design), GIF/MP4 export, `ene` blocks in Markdown.

## Develop

```sh
pnpm install && pnpm build        # builds the player bundle, then this extension
code packages/vscode               # then press F5 ("Run ene extension")
```

## Package

```sh
pnpm -C packages/vscode build
cd packages/vscode && pnpm exec vsce package --no-dependencies   # -> ene-vscode-<version>.vsix
code --install-extension ene-vscode-0.1.0.vsix
```

The extension is a single esbuild bundle (`dist/extension.js`); the webview loads `media/ene.js` and `media/ene-elk.js`, copied from `packages/player/dist` at build time.

## Webview security

The preview runs with `default-src 'none'`: scripts only from the extension's `media/` folder with a per-load nonce, no remote scripts, images or connections, and `localResourceRoots` limited to `media/`. The webview only receives `{type:"update", text}` messages and only sends `ready` / `error`; anything else is ignored.

## Extending the grammar

`syntaxes/ene.tmLanguage.json` keeps each construct in its own `repository` entry. New line-start keywords (e.g. `note`, `opt`) go into `#keywords` (and block openers into `indentationRules`/`folding` in `language-configuration.json`); new arrows (e.g. `~>`) go into `#arrows`, longest first.
