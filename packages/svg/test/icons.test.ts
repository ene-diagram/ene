import { parse, buildTimeline, resolveIcon, type IconPack } from "@ene/core";
import { layout } from "@ene/layout";
import { renderSvg, iconFromSvgText, nodeMarkup } from "../src/index";
const pack: IconPack = { prefix: "aws", width: 24, height: 24, icons: { lambda: { body: '<path d="M1 1"/>' } } };
test("icon nodes are wider and render nested icon svg", async () => {
  const { doc } = parse("a[주문 처리 함수]{icon: aws:lambda} -> b[주문 처리 함수]");
  const tl = buildTimeline(doc); const l = await layout(doc, tl);
  const [a, b] = l.nodes; expect(a.w).toBeGreaterThan(b.w); expect(a.icon).toBe("aws:lambda");
  const svg = renderSvg(l, tl, { icons: new Map([["aws:lambda", resolveIcon("aws:lambda", [pack])!]]) });
  expect(svg).toContain('<svg x="'); expect(svg).toContain('viewBox="0 0 24 24"');
  expect(svg).not.toContain('<path d="M1 1"/>');
  const b64 = svg.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/)![1];
  expect(Buffer.from(b64, "base64").toString()).toContain('<path d="M1 1"/>');
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

const decode = (markup: string) => Buffer.from(markup.match(/base64,([A-Za-z0-9+/=]+)/)![1], "base64").toString();
test("pack icon bodies are isolated in a data-URI image (no inline script/handlers)", () => {
  const evil = { body: '<script>alert(1)</script><path onload="alert(2)"/><foreignObject><div/></foreignObject>', width: 24, height: 24 };
  const m = nodeMarkup({ id: "a", label: "A", x: 0, y: 0, w: 140, h: 52, icon: "x:y" }, new Map([["x:y", evil]]));
  expect(m).not.toMatch(/<script|onload|<foreignObject/);
  expect(m).toMatch(/<image href="data:image\/svg\+xml;base64,/);
  expect(decode(m)).toContain("<script>");
});
test("non-numeric pack icon sizes cannot break out of attributes", () => {
  const evil = { body: "<path/>", width: '1" onload="alert(1)' as unknown as number, height: 24 };
  const m = nodeMarkup({ id: "a", label: "A", x: 0, y: 0, w: 140, h: 52, icon: "x:y" }, new Map([["x:y", evil]]));
  expect(m).not.toContain("onload");
  expect(m).toContain('viewBox="0 0 16 24"');
});
test("iconFromSvgText output is passed through, not double-wrapped", () => {
  const i = iconFromSvgText('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32"><rect/></svg>');
  const m = nodeMarkup({ id: "a", label: "A", x: 0, y: 0, w: 140, h: 52, icon: "u" }, new Map([["u", i]]));
  expect(decode(m)).toContain("<rect/>");
});
