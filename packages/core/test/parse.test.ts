import { parse } from "../src/parse";
import { SPIKE, firstEdge } from "./helpers";
test("parses spike example", () => {
  const { doc, diagnostics } = parse(SPIKE);
  expect(diagnostics).toEqual([]);
  expect(doc.title).toBe("주문 요청 흐름");
  expect(doc.speed).toBe(1.2);
  expect([...doc.nodes.keys()]).toEqual(["user", "api", "cache", "db", "pay"]);
  expect(doc.body).toHaveLength(7);
  const s4 = doc.body[3];
  expect(s4.type === "step" && s4.edges.map((e) => e.to)).toEqual(["db", "pay"]);
  const s6 = doc.body[5];
  expect(s6.type === "step" && s6.edges[0].kind).toBe("fail");
});
test("label may contain arrows, colons, ampersand", () => {
  const e = firstEdge(parse("a -> b : x -> y : z & w"));
  expect(e.label).toBe("x -> y : z & w");
});
test("bracket label with nested brackets", () =>
  expect(parse("x[A [beta]] -> y").doc.nodes.get("x")!.label).toBe("A [beta]"));
test("korean ids", () => expect(parse("서버 -> 디비").doc.nodes.has("서버")).toBe(true));
test("empty input gives E101", () => expect(parse("# only comment").diagnostics.map((d) => d.code)).toEqual(["E101"]));
test("later label overrides nothing, conflicting label warns W102", () =>
  expect(parse("a[A] -> b\na[Z] -> b").diagnostics[0].code).toBe("W102"));
test("ids may contain -x without being a fail arrow", () => {
  const e = firstEdge(parse("user-xss -> my-x"));
  expect([e.from, e.to, e.kind]).toEqual(["user-xss", "my-x", "ok"]);
});
