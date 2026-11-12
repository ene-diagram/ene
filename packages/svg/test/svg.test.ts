import { parse, buildTimeline } from "@ene/core";
import { layout } from "@ene/layout";
import { renderSvg } from "../src/index";
const make = async (src: string) => {
  const { doc } = parse(src); const tl = buildTimeline(doc);
  return renderSvg(await layout(doc, tl), tl, { title: doc.title });
};
test("well-formed XML with escaped labels", async () => {
  const svg = await make(`title A & B <x>\nu[<user> & "me"] -> api : a < b & c\napi --> u : ok`);
  expect(svg).toContain("&lt;user&gt; &amp; &quot;me&quot;");
  expect(svg).not.toMatch(/<user>/);
  // 태그 균형 대략 검사
  const open = (svg.match(/<[a-zA-Z]+(\s[^>]*)?(?<!\/)>/g) ?? []).length;
  const close = (svg.match(/<\/[a-zA-Z]+>/g) ?? []).length;
  expect(open).toBe(close);
});
test("one moving dot per timeline edge", async () => {
  const svg = await make("a -> b\nb -> c & b -> d\nd -x a");
  expect(svg.match(/<animateMotion/g)).toHaveLength(4);
});
test("reply is dashed, fail shows cross", async () => {
  const svg = await make("a -> b\nb --> a\nb -x a");
  expect(svg).toContain('class="hl reply"'); expect(svg).toContain("✕");
});
test("accessibility and preferences", async () => {
  const svg = await make("title 주문\nuser -> api : POST\napi --> user : 201");
  expect(svg).toContain("<title>주문</title>");
  expect(svg).toMatch(/<desc>[^<]*1\. user → api: POST[^<]*2\. api → user: 201/);
  expect(svg).toContain("prefers-reduced-motion"); expect(svg).toContain("prefers-color-scheme: dark");
});
