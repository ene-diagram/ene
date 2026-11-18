// The ready-made browser module (dist/ene-element.js): everything in one file except ELK, which it loads from the
// ene-elk.js next to it the first time a flow diagram is drawn
import { setElkUrl } from "@ene-diagram/player";

export * from "./index.js";
setElkUrl(new URL("ene-elk.js", import.meta.url).href);
