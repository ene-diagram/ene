import { render } from "svelte/server";
import { expect, it } from "vitest";
import { EneDiagram } from "../src/index.js";

it("server rendering shows the source text", () => {
  const { body } = render(EneDiagram, { props: { source: "a -> b : <hi>" } });
  expect(body).toContain("a -> b : &lt;hi>");
  expect(body).toContain('class="ene-source"');
});
