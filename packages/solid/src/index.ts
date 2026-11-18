import * as solid from "solid-js";
import { createEneDiagram, type SolidApi } from "./create.js";

export type { EneDiagramProps } from "./create.js";
export type { Player } from "@ene-diagram/player";

/**
 * `<EneDiagram source={text()} />`: an ene player for Solid 1.x and 2.x. Changing `choices` picks other branch arms
 * without rebuilding; without it, the viewer's picks are kept across source changes. On the server it renders the
 * source text only (in SolidStart, wrap it in `clientOnly`).
 */
export const EneDiagram = createEneDiagram(solid as unknown as SolidApi);
export default EneDiagram;
