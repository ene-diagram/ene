---
"@ene-diagram/core": minor
"@ene-diagram/layout": minor
---

New setting `direction down`: a flow diagram runs top to bottom instead of left to right (`direction right`, the default). `rank` then puts nodes in the same row, and `pin col,row` stays a position on the screen. `ene from-mermaid` keeps `flowchart TD` / `TB` as `direction down`. `direction` is now a keyword, so a node with that id at the start of a line needs another name (`E115`). New diagnostic `E119` for an unknown direction.
