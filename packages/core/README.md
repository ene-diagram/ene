# @ene-diagram/core

Parser, timeline builder and diagnostics for [ene](https://github.com/ene-diagram/ene), a text language for animated diagrams.

```sh
npm i @ene-diagram/core
```

```js
import { parse, buildTimeline, formatAll } from "@ene-diagram/core";

const src = "user -> api : GET /\napi --> user : 200";
const { doc, diagnostics } = parse(src);
if (diagnostics.length) console.error(formatAll(src, diagnostics, "en"));
const tl = buildTimeline(doc); // steps with start times, total length in seconds
```

Also exports `formatSource` (the `ene fmt` formatter), `fromMermaid`, icon helpers and the diagnostic codes in English and Korean.

Syntax, examples and the other packages: [github.com/ene-diagram/ene](https://github.com/ene-diagram/ene). MIT license.
