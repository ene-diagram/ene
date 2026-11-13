import { parse } from "../src/parse";
import { buildTimeline } from "../src/timeline";
import { firstEdge } from "./helpers";
test("--> is a reply edge", () => {
  const e = firstEdge(parse("api --> user : 201"));
  expect([e.from, e.to, e.kind, e.label]).toEqual(["api", "user", "reply", "201"]);
});
test("--> in parallel and ids with dashes", () => {
  const s = parse("my-api --> a & my-api -> b").doc.body[0];
  expect(s.type === "step" && s.edges.map((e) => [e.from, e.to, e.kind])).toEqual([
    ["my-api", "a", "reply"],
    ["my-api", "b", "ok"],
  ]);
});
test("leading & continues the previous step", () => {
  const { doc, diagnostics } = parse("l -> s : 작은\n& l -> s : 큰\n  & l -> db : 메타");
  expect(diagnostics).toEqual([]);
  expect(doc.body).toHaveLength(1);
  const s = doc.body[0];
  expect(s.type === "step" && s.edges.map((e) => e.label)).toEqual(["작은", "큰", "메타"]);
  expect(buildTimeline(doc).steps).toHaveLength(1);
});
test("leading & without a previous step is E106", () => {
  expect(parse("& a -> b").diagnostics[0].code).toBe("E106");
  expect(parse("wait 1\n& a -> b").diagnostics[0].code).toBe("E106");
});
test("leading & inside a block continues the step in that block", () => {
  const l = parse("loop 2\n a -> b\n & a -> c\nend").doc.body[0];
  expect(l.type === "loop" && l.body).toHaveLength(1);
});
