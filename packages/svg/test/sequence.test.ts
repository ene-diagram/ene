import { parse, buildTimeline } from "@ene-diagram/core";
import { layoutSequence } from "@ene-diagram/layout";
import { renderSvg } from "../src/index";
test("sequence svg: lifelines, frames, one dot per step edge on its own row", () => {
  const { doc } = parse("diagram sequence\nu -> a : req\nbranch hit\n a --> u : cached\nelse miss\n a -> d : q\n d --> a : rows\n a --> u : res\nend\nloop 2\n a -> a : tick\nend");
  const tl = buildTimeline(doc, { choices: [1] });
  const svg = renderSvg(layoutSequence(doc, tl), tl);
  expect(svg.match(/class="life"/g)).toHaveLength(3);
  expect(svg).toContain(">miss<"); expect(svg.match(/<animateMotion/g)).toHaveLength(6);
  const ids = [...svg.matchAll(/<mpath href="#([^"]+)"/g)].map(m => m[1]);
  expect(new Set(ids).size).toBe(6);
});
test("highlighted edges end with an arrowhead", async () => {
  const { doc } = parse("a -> b"); const tl = buildTimeline(doc);
  const svg = renderSvg(layoutSequence(doc, tl), tl);
  expect(svg).toContain('<marker id="ene-ah"'); expect(svg).toMatch(/class="hl ok"[^>]*marker-end="url\(#ene-ah\)"/);
});
