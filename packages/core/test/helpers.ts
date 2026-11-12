import { readFileSync } from "node:fs";
import type { Edge, ParseResult } from "../src/types";
export const SPIKE = readFileSync(new URL("./fixtures/spike.ene", import.meta.url), "utf8");
export const firstEdge = (r: ParseResult): Edge => {
  const s = r.doc.body[0];
  if (s?.type !== "step") throw new Error("first stmt is not a step");
  return s.edges[0];
};
