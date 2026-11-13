# @ene-diagram/svg

Renders an [ene](https://github.com/ene-diagram/ene) diagram to a self-contained animated SVG (SMIL, no script), ready for READMEs and `<img>`.

```sh
npm i @ene-diagram/svg
```

```js
import { parse, buildTimeline } from "@ene-diagram/core";
import { layout } from "@ene-diagram/layout";
import { renderSvg } from "@ene-diagram/svg";

const { doc } = parse(src);
const tl = buildTimeline(doc);
const svg = renderSvg(await layout(doc, tl), tl, { title: doc.title, lang: "en" });
```

Options: `title`, `icons`, `notes` (step captions, default on), `theme` (`default`, `mono`, `high-contrast`), `lang` (`en` or `ko`, for the accessible description).

Syntax, examples and the other packages: [github.com/ene-diagram/ene](https://github.com/ene-diagram/ene). MIT license.
