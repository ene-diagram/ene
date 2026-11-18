import { expect, it } from "vitest";
import { EneDiagram } from "../src/index.js";

it("on a server it renders the source text only", () => {
  expect(EneDiagram({ source: "a -> b" })).toBe("a -> b");
});
