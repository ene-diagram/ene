import { parse } from "../src/parse";
test("pin and rank", () => {
  const { doc, diagnostics } = parse("a -> b\nb -> c\npin c 3,1\nrank a b");
  expect(diagnostics).toEqual([]);
  expect(doc.pins[0]).toMatchObject({ id: "c", col: 3, row: 1 });
  expect(doc.ranks[0].ids).toEqual(["a", "b"]);
});
test("pin unknown node suggests close id", () => {
  const d = parse("cache -> api\npin cahce 1,0").diagnostics[0];
  expect(d.code).toBe("E401");
  expect(d.args.suggestion).toBe("cache");
});
test("pin before node is declared is fine", () => expect(parse("pin a 0,0\na -> b").diagnostics).toEqual([]));
test("bad pin coords", () => expect(parse("a -> b\npin a x,1").diagnostics[0].code).toBe("E402"));
test("two pins on same cell", () => expect(parse("a -> b\npin a 0,0\npin b 0,0").diagnostics[0].code).toBe("E403"));
test("rank unknown node", () => expect(parse("a -> b\nrank a zz").diagnostics[0].code).toBe("E401"));
