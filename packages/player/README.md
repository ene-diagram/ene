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

Using React, Vue, Svelte, Solid or Angular? Use `@ene-diagram/react`, `vue`, `svelte`, `solid`, `angular`, or the Web Component `@ene-diagram/element`. They are built on `mount`, which keeps a player in sync with changing props:

```js
import { mount } from "@ene-diagram/player";

const m = mount(element, source, { lang: "en", onReady: (player) => {}, onChoicesChange: (c) => {} });
m.update(newSource, { lang: "en" }); // renders again; a changed `choices` alone goes to setChoices
m.destroy();                         // also cancels a render in progress
```

Installed from npm, flow diagrams load ELK from the `elkjs` package through your bundler on first use. `dist/ene.js` is a ready-made browser bundle for a plain `<script>` tag; flowcharts also need `dist/ene-elk.js` next to it (see THIRD_PARTY_NOTICES.md for its license).

Syntax, examples and the other packages: [github.com/ene-diagram/ene](https://github.com/ene-diagram/ene). MIT license.
