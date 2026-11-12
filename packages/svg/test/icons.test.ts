import { parse, buildTimeline, resolveIcon, type IconPack } from "@ene/core";
import { layout } from "@ene/layout";
import { renderSvg, iconFromSvgText, nodeMarkup } from "../src/index";
const pack: IconPack = { prefix: "aws", width: 24, height: 24, icons: { lambda: { body: '<path d="M1 1"/>' } } };
test("icon nodes are wider and render nested icon svg", async () => {
  const { doc } = parse("a[주문 처리 함수]{icon: aws:lambda} -> b[주문 처리 함수]");
  const tl = buildTimeline(doc); const l = await layout(doc, tl);
  const [a, b] = l.nodes; expect(a.w).toBeGreaterThan(b.w); expect(a.icon).toBe("aws:lambda");
  const svg = renderSvg(l, tl, { icons: new Map([["aws:lambda", resolveIcon("aws:lambda", [pack])!]]) });
  expect(svg).toContain('<svg x="'); expect(svg).toContain('viewBox="0 0 24 24"'); expect(svg).toContain('<path d="M1 1"/>');
});
test("missing icon still renders the node without icon", async () => {
  const { doc } = parse("a{icon: aws:nope} -> b");
  const tl = buildTimeline(doc);
  expect(renderSvg(await layout(doc, tl), tl)).not.toContain("viewBox=\"0 0 24 24\"");
});
test("label shifts right when icon present", () => {
  const n = { id: "a", label: "A", x: 0, y: 0, w: 140, h: 52, icon: "aws:lambda" };
  const withIcon = nodeMarkup(n, new Map([["aws:lambda", { body: "", width: 24, height: 24 }]]));
  const without = nodeMarkup({ ...n, icon: undefined }, new Map());
  const x = (s: string) => Number(s.match(/class="nl"[^>]*|x="([\d.]+)" y="[\d.]+" class="nl"/)![1]);
  expect(x(withIcon)).toBeGreaterThan(x(without));
});
test("iconFromSvgText embeds external svg as data image with its viewBox", () => {
  const i = iconFromSvgText('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32"><rect/></svg>');
  expect(i).toMatchObject({ width: 48, height: 32 }); expect(i.body).toMatch(/^<image href="data:image\/svg\+xml;base64,/);
});
