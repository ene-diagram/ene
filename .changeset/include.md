---
"@ene-diagram/core": minor
"@ene-diagram/cli": minor
"@ene-diagram/player": minor
"@ene-diagram/remark": minor
---

New `include ./system.ene` line: reuse node declarations, groups, `pin`, `rank`, `theme` and `speed` from another file. Only the nodes a diagram uses are drawn. The CLI and the VS Code extension read the files (inside the diagram's folder only); `@ene-diagram/remark` and `ene.render` take an `include` option; the plain browser player reports `E501`. `include` is now a keyword, so a node with that id at the start of a line needs another name (`E115`). New diagnostics `E501`–`E505`; a diagnostic from an included file has `file` (also in `ene check --json`). New API: `parse(source, { include, file })`, `createIncluder`.
