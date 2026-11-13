# @ene-diagram/video

GIF and MP4 export for [ene](https://github.com/ene-diagram/ene) diagrams in Node. Needs Chrome and ffmpeg on the machine.

```sh
npm i @ene-diagram/video
```

```js
import { loopSeconds } from "@ene-diagram/svg";
import { renderVideo } from "@ene-diagram/video";

await renderVideo(svg, { out: "diagram.gif", format: "gif", seconds: loopSeconds(tl) });
```

Frames are taken at exact animation times, so the video matches the SVG. Set `ENE_CHROME` / `ENE_FFMPEG` if they are not found automatically. Most people use it through `@ene-diagram/cli` (`ene in.ene -o out.gif`).

Syntax, examples and the other packages: [github.com/ene-diagram/ene](https://github.com/ene-diagram/ene). MIT license.
