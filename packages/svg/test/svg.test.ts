import { parse, buildTimeline } from "@ene-diagram/core";
import { layout } from "@ene-diagram/layout";
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
test("step notes are a caption under the diagram, shown while their step plays; notes: false omits them", async () => {
  const src = "a -> b : one\nnote first <why>\nb -> c : two\nc --> a : three\nnote third";
  const { doc } = parse(src); const tl = buildTimeline(doc); const l = await layout(doc, tl);
  const svg = renderSvg(l, tl);
  const notes = [...svg.matchAll(/class="note"[^>]*><tspan[^>]*>([^<]*)/g)].map((m) => m[1]);
  expect(notes).toEqual(["first &lt;why&gt;", "third"]);
  expect(svg).toContain(`height="${l.height + 40}"`);
  expect(svg).toContain("(first &lt;why&gt;)");
  const plain = renderSvg(l, tl, { notes: false });
  expect(plain).not.toContain('class="note"');
  expect(plain).toContain(`height="${l.height}"`);
  expect(renderSvg(l, buildTimeline(parse("a -> b").doc))).not.toContain('class="note"');
});
test("long notes wrap to the diagram width and grow the caption", async () => {
  const { wrapNote } = await import("../src/index");
  const long = "This explanation is much longer than a small two node diagram is wide, so it has to wrap onto more lines";
  const lines = wrapNote(long, 200);
  expect(lines.length).toBeGreaterThan(2);
  expect(lines.join(" ")).toBe(long);
  expect(wrapNote("x".repeat(100), 100).join("")).toBe("x".repeat(100));
  const { doc } = parse(`a -> b\nnote ${long}`); const tl = buildTimeline(doc); const l = await layout(doc, tl);
  const svg = renderSvg(l, tl);
  const n = wrapNote(long, l.width - 80).length;
  expect(n).toBeGreaterThan(1);
  expect(svg.match(/<tspan/g)).toHaveLength(n);
  expect(svg).toContain(`height="${l.height + 22 + 18 * n}"`);
});
