# @ene-diagram/core

## 0.2.0

### Minor Changes

- [#109](https://github.com/ene-diagram/ene/pull/109) [`45f4df8`](https://github.com/ene-diagram/ene/commit/45f4df8d81e55a5602b97f1f089b825c5c34c5bc) Thanks [@HelloWook](https://github.com/HelloWook)! - New `include ./system.ene` line: reuse node declarations, groups, `pin`, `rank`, `theme` and `speed` from another file. Only the nodes a diagram uses are drawn. The CLI and the VS Code extension read the files (inside the diagram's folder only); `@ene-diagram/remark` and `ene.render` take an `include` option; the plain browser player reports `E501`. `include` is now a keyword, so a node with that id at the start of a line needs another name (`E115`). New diagnostics `E501`–`E505`; a diagnostic from an included file has `file` (also in `ene check --json`). New API: `parse(source, { include, file })`, `createIncluder`.

- [#104](https://github.com/ene-diagram/ene/pull/104) [`835c6a8`](https://github.com/ene-diagram/ene/commit/835c6a8284df3750f341c56685028657f4455aaa) Thanks [@HelloWook](https://github.com/HelloWook)! - Exported files can play every branch path in turn: `ene x.ene -o x.svg --choice all` (also GIF and MP4), `player.toSvg({ paths: "all" })`, `choice: "all"` / `choice=all` in `@ene-diagram/remark`, and `choice: all` in the GitHub Action. A line under the diagram names the path that is playing. New API: `enumeratePaths` in core, `renderSvgPaths`, `svgParts` and `pathsSeconds` in svg.
