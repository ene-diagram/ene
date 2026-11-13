---
"@ene-diagram/core": minor
"@ene-diagram/svg": minor
"@ene-diagram/cli": minor
"@ene-diagram/player": minor
"@ene-diagram/remark": minor
---

Exported files can play every branch path in turn: `ene x.ene -o x.svg --choice all` (also GIF and MP4), `player.toSvg({ paths: "all" })`, `choice: "all"` / `choice=all` in `@ene-diagram/remark`, and `choice: all` in the GitHub Action. A line under the diagram names the path that is playing. New API: `enumeratePaths` in core, `renderSvgPaths`, `svgParts` and `pathsSeconds` in svg.
