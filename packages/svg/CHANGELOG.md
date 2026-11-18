# @ene-diagram/svg

## 0.2.0

### Minor Changes

- [#108](https://github.com/ene-diagram/ene/pull/108) [`5bb1b51`](https://github.com/ene-diagram/ene/commit/5bb1b51b324672a590598f5e74861899ad3cde53) Thanks [@HelloWook](https://github.com/HelloWook)! - Sequence diagrams draw activation bars: a participant is marked busy from each request (`->`) until it answers the caller (`-->` or `-x`), appearing when the request arrives. No new syntax; requests that are never answered get no bar. `Layout.activations` is new.

- [#104](https://github.com/ene-diagram/ene/pull/104) [`835c6a8`](https://github.com/ene-diagram/ene/commit/835c6a8284df3750f341c56685028657f4455aaa) Thanks [@HelloWook](https://github.com/HelloWook)! - Exported files can play every branch path in turn: `ene x.ene -o x.svg --choice all` (also GIF and MP4), `player.toSvg({ paths: "all" })`, `choice: "all"` / `choice=all` in `@ene-diagram/remark`, and `choice: all` in the GitHub Action. A line under the diagram names the path that is playing. New API: `enumeratePaths` in core, `renderSvgPaths`, `svgParts` and `pathsSeconds` in svg.

### Patch Changes

- Updated dependencies [[`45f4df8`](https://github.com/ene-diagram/ene/commit/45f4df8d81e55a5602b97f1f089b825c5c34c5bc), [`5bb1b51`](https://github.com/ene-diagram/ene/commit/5bb1b51b324672a590598f5e74861899ad3cde53), [`835c6a8`](https://github.com/ene-diagram/ene/commit/835c6a8284df3750f341c56685028657f4455aaa)]:
  - @ene-diagram/core@0.2.0
  - @ene-diagram/layout@0.2.0
