# @ene-diagram/player

Interactive browser player for [ene](https://github.com/ene-diagram/ene) diagrams: play, pause, step, pick branches, export SVG.

```sh
npm i @ene-diagram/player
```

```js
import { render, autoRun } from "@ene-diagram/player";

await render(document.getElementById("diagram"), "user -> api : GET /\napi --> user : 200");
autoRun(); // or turn every <pre class="ene"> on the page into a player
```

`dist/ene.js` is a ready-made browser bundle for a plain `<script>` tag; flowcharts also need `dist/ene-elk.js` next to it (see THIRD_PARTY_NOTICES.md for its license).

Syntax, examples and the other packages: [github.com/ene-diagram/ene](https://github.com/ene-diagram/ene). MIT license.
