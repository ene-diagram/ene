# @ene-diagram/react

React component (React 18+, Next.js, Preact with `preact/compat`). Plays [ene](https://github.com/ene-diagram/ene) diagrams: play, pause, step, pick branches.

```sh
npm i @ene-diagram/react
```

```jsx
import { EneDiagram } from "@ene-diagram/react";

export function Checkout() {
  return (
    <EneDiagram
      source={"user -> api : POST /order\napi --> user : 201"}
      onReady={(player) => player?.controller.pause()}
      onChoicesChange={(choices) => console.log(choices)}
    />
  );
}
```

| Option | Default | |
|---|---|---|
| `source` | (required) | the diagram text |
| `lang` | browser language | `"en"` or `"ko"` for the controls and error messages |
| `autoplay` | `true` | start playing when ready |
| `loop` | `true` | play again from the start |
| `focus` | `"auto"` | dim parts that are not playing (`true`, `false`, or from 12 nodes) |
| `theme` | the diagram's `theme` | `default`, `mono`, `high-contrast` |
| `choices` | | branch arms to show, e.g. `[1]`; changing it picks other arms without rebuilding |
| `include` | | reads `include`d files; see `createIncluder` in `@ene-diagram/core` |

Events: `onReady(player)` after each render (`undefined` when the source has errors; the diagnostics are shown instead), `onChoicesChange(choices)` when the viewer picks an arm, `onError(error)` when a render throws. `className`, `style` and `aria-label` go on the wrapper `<div class="ene-diagram">`.

The module starts with `"use client"`, so it can be used from a Next.js server component; event handlers need a client component around it.

Changing `source` or a render option renders again; the current player stays until the new one is ready. Without `choices`, the arms the viewer picked are kept when the source changes. On the server, and until the player is ready, the source is shown as text in `<pre class="ene-source">` (hidden afterwards); the player renders into the `<div class="ene-host">` next to it. Flow diagrams load ELK from the `elkjs` package through your bundler on first use.

Syntax, examples and the other packages: [github.com/ene-diagram/ene](https://github.com/ene-diagram/ene). MIT license.
