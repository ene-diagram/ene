# @ene-diagram/angular

Angular standalone component (Angular 17+). Plays [ene](https://github.com/ene-diagram/ene) diagrams: play, pause, step, pick branches.

```sh
npm i @ene-diagram/angular
```

```ts
import { Component } from "@angular/core";
import { EneDiagramComponent } from "@ene-diagram/angular";

@Component({
  selector: "app-checkout",
  imports: [EneDiagramComponent],
  template: `<ene-diagram [source]="source" lang="en" (choicesChange)="log($event)" />`,
})
export class CheckoutComponent {
  source = "user -> api : POST /order\napi --> user : 201";
  log(c: number[]) { console.log(c); }
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

Outputs: `ready` (the player, or `undefined` when the source has errors; the diagnostics are shown instead), `choicesChange`, `renderError`. `autoplay` and `loop` accept `autoplay="false"` in templates.

With server rendering (Angular SSR) it renders the source text on the server and the player only in the browser. Built with ng-packagr (partial compilation); checked with the Angular 17 linker.

Changing `source` or a render option renders again; the current player stays until the new one is ready. Without `choices`, the arms the viewer picked are kept when the source changes. On the server, and until the player is ready, the source is shown as text in `<pre class="ene-source">` (hidden afterwards); the player renders into the `<div class="ene-host">` next to it. Flow diagrams load ELK from the `elkjs` package through your bundler on first use.

Syntax, examples and the other packages: [github.com/ene-diagram/ene](https://github.com/ene-diagram/ene). MIT license.
