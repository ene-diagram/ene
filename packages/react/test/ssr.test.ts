import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { EneDiagram } from "../src/index.js";

it("server rendering shows the source text and touches no DOM", () => {
  const html = renderToString(createElement(EneDiagram, { source: "a -> b : <hi>" }));
  expect(html).toContain('<pre class="ene-source">a -&gt; b : &lt;hi&gt;</pre>');
  expect(html).toContain('class="ene-host"');
});
