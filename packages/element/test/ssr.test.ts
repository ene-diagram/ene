import { expect, it } from "vitest";

it("imports on a server without a DOM", async () => {
  const m = await import("../src/index.js");
  expect(typeof m.EneDiagramElement).toBe("function");
  expect(() => m.defineEneDiagram()).not.toThrow();
});
