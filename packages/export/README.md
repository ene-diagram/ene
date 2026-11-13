# @ene-diagram/export

In-browser GIF, MP4 and WebM export for [ene](https://github.com/ene-diagram/ene) diagrams, with no server, Chrome or ffmpeg.

```sh
npm i @ene-diagram/export
```

```js
import { exportVideo, videoSupport } from "@ene-diagram/export";

const { blob } = await exportVideo(player.toSvg(), { format: "gif", fps: 15, scale: 1, theme: "light" });
```

`mp4` uses WebCodecs where the browser supports it, `webm` uses MediaRecorder; `videoSupport()` tells which work. `dist/ene-export.js` is a browser bundle exposing `eneExport`.

Syntax, examples and the other packages: [github.com/ene-diagram/ene](https://github.com/ene-diagram/ene). MIT license.
