# @ene-diagram/element

Web Component `<ene-diagram>`: plain HTML, Lit, and any framework that renders custom elements. Plays [ene](https://github.com/ene-diagram/ene) diagrams: play, pause, step, pick branches.

With a bundler (Vite, webpack, Next, …):

```sh
npm i @ene-diagram/element
```

```js
import "@ene-diagram/element"; // registers <ene-diagram>
```

Without one, load the ready-made module from a CDN. It loads `ene-elk.js` from the same folder the first time it draws a flow diagram:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@ene-diagram/element@0/dist/ene-element.js"></script>

<ene-diagram lang="en" autoplay="false">
user -> api : POST /order
api --> user : 201
</ene-diagram>
```

To host it yourself, copy `dist/ene-element.js` and `dist/ene-elk.js` into one folder (see THIRD_PARTY_NOTICES.md for ELK's license).

The diagram is the `source` attribute or property, else the element's text when it is first connected (readable without JavaScript). Later text edits are not watched; set `source` instead.

Attributes: `source`, `lang`, `autoplay` and `loop` (on; `"false"` turns them off), `focus` (`true`, `false`, `auto`), `theme`, `choices` (`"0,1"`). Property only: `include`. The current player is `element.player`.

Events: `ready` (`detail`: the player, or `undefined` when the source has errors), `choiceschange` (`detail`: the choices), `error`. Moving the element keeps its player; removing it destroys the player, and connecting it again renders again.

Importing the module registers `<ene-diagram>`; `defineEneDiagram("my-tag")` registers another name. It is safe to import on a server.

Changing `source` or a render option renders again; the current player stays until the new one is ready. Without `choices`, the arms the viewer picked are kept when the source changes. On the server, and until the player is ready, the source is shown as text in `<pre class="ene-source">` (hidden afterwards); the player renders into the `<div class="ene-host">` next to it. Flow diagrams load ELK from the `elkjs` package through your bundler on first use.

Syntax, examples and the other packages: [github.com/ene-diagram/ene](https://github.com/ene-diagram/ene). MIT license.
