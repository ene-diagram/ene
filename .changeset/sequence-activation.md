---
"@ene-diagram/layout": minor
"@ene-diagram/svg": minor
"@ene-diagram/player": minor
---

Sequence diagrams draw activation bars: a participant is marked busy from each request (`->`) until it answers the caller (`-->` or `-x`), appearing when the request arrives. No new syntax; requests that are never answered get no bar. `Layout.activations` is new.
