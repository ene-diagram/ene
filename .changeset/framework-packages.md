---
"@ene-diagram/player": minor
"@ene-diagram/element": minor
"@ene-diagram/react": minor
"@ene-diagram/vue": minor
"@ene-diagram/svelte": minor
"@ene-diagram/solid": minor
"@ene-diagram/angular": minor
---

New framework packages: `@ene-diagram/react`, `@ene-diagram/vue`, `@ene-diagram/svelte`, `@ene-diagram/solid` (1.8+ and 2.x), `@ene-diagram/angular` (standalone, 17+) and the Web Component `@ene-diagram/element` (`<ene-diagram>`). They show the source text on the server and until the player is ready, keep the viewer's branch picks when the source changes, and apply a changed `choices` without rebuilding. The player gains `mount(el, source, opts)` (the shared lifecycle these use: latest render wins, `destroy` cancels one in progress) and a `signal` option on `render`. Fix: installed from npm, the player no longer looks for `ene-elk.js` next to the page; flow diagrams take ELK from the `elkjs` package through the bundler. The `<script>` bundle still loads `ene-elk.js` (the configured URL, else next to `ene.js`).
