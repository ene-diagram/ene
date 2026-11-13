# @ene-diagram/layout

Layout for [ene](https://github.com/ene-diagram/ene) diagrams: flowcharts through [ELK](https://github.com/kieler/elkjs), sequence diagrams with a built-in layout.

```sh
npm i @ene-diagram/layout
```

```js
import { parse, buildTimeline } from "@ene-diagram/core";
import { layout, layoutSequence } from "@ene-diagram/layout";

const { doc } = parse(src);
const tl = buildTimeline(doc);
const lay = doc.kind === "sequence" ? layoutSequence(doc, tl) : await layout(doc, tl);
```

Syntax, examples and the other packages: [github.com/ene-diagram/ene](https://github.com/ene-diagram/ene). MIT license.
