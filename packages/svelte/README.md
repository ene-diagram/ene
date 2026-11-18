# @ene-diagram/svelte

Svelte 5 component (SvelteKit too). Plays [ene](https://github.com/ene-diagram/ene) diagrams: play, pause, step, pick branches.

```sh
npm i @ene-diagram/svelte
```

```svelte
<script>
  import { EneDiagram } from "@ene-diagram/svelte";
  let source = $state("user -> api : POST /order\napi --> user : 201");
</script>

<EneDiagram {source} lang="en" onchoiceschange={(c) => console.log(c)} />
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

Callback props: `onready` (the player, or `undefined` when the source has errors; the diagnostics are shown instead), `onchoiceschange`, `onerror`. Other attributes (`class`, `style`, `aria-*`) go on the wrapper `<div class="ene-diagram">`.

The package ships `.svelte` source, so your Svelte compiler builds it; server rendering in SvelteKit shows the source text.

Changing `source` or a render option renders again; the current player stays until the new one is ready. Without `choices`, the arms the viewer picked are kept when the source changes. On the server, and until the player is ready, the source is shown as text in `<pre class="ene-source">` (hidden afterwards); the player renders into the `<div class="ene-host">` next to it. Flow diagrams load ELK from the `elkjs` package through your bundler on first use.

Syntax, examples and the other packages: [github.com/ene-diagram/ene](https://github.com/ene-diagram/ene). MIT license.
