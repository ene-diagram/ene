import { parse, buildTimeline } from "@ene/core";
import { layout } from "@ene/layout";
import { renderSvg, nodeMarkup, groupMarkup } from "../src/index";
const base = { id: "a", label: "A", x: 10, y: 20, w: 120, h: 52 };
test("db is a cylinder, queue has stripes, circle is an ellipse, round is a pill", () => {
  expect(nodeMarkup({ ...base, shape: "db" })).toMatch(/<path d="M10,28 A60,8/);
  expect(nodeMarkup({ ...base, shape: "queue" }).match(/<line /g)).toHaveLength(3);
  expect(nodeMarkup({ ...base, shape: "circle" })).toContain("<ellipse");
  expect(nodeMarkup({ ...base, shape: "round" })).toContain('rx="26"');
});
test("color tints node and is escaped", () => {
  const m = nodeMarkup({ ...base, color: "#f59e0b" });
  expect(m).toContain('stroke="#f59e0b"'); expect(m).toContain('fill="#f59e0b"');
});
test("group markup has dashed box and label", () => {
  const m = groupMarkup({ id: "vpc", label: "VPC <10.0>", color: "#8b5cf6", depth: 0, x: 0, y: 0, w: 300, h: 200 });
  expect(m).toContain('class="grp"'); expect(m).toContain("VPC &lt;10.0&gt;"); expect(m).toContain('stroke="#8b5cf6"');
});
test("groups are drawn behind nodes in full svg", async () => {
  const { doc } = parse("a -> b\ngroup g[G] : a b"); const tl = buildTimeline(doc);
  const svg = renderSvg(await layout(doc, tl), tl);
  expect(svg.indexOf('class="grp"')).toBeLessThan(svg.indexOf('class="node"'));
});
