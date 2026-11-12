import { parse } from "../src/parse";
test("groups with members and nesting", () => {
  const { doc, diagnostics } = parse("a -> b\nb -> c\ngroup vpc[VPC] : a b c\ngroup sub[Private]{color: #22c55e} in vpc : b c");
  expect(diagnostics).toEqual([]);
  expect(doc.groups).toEqual([
    expect.objectContaining({ id: "vpc", label: "VPC", members: ["a", "b", "c"] }),
    expect.objectContaining({ id: "sub", label: "Private", parent: "vpc", members: ["b", "c"], color: "#22c55e" }),
  ]);
});
test("group errors", () => {
  expect(parse("a -> b\ngroup g : a zz").diagnostics[0]).toMatchObject({ code: "E401", args: { name: "zz" } });
  expect(parse("a -> b\ngroup g : a\ngroup h in nope : b").diagnostics[0]).toMatchObject({ code: "E401", args: { name: "nope" } });
  expect(parse("a -> b\ngroup g : a\ngroup h : a").diagnostics[0].code).toBe("E404");
  expect(parse("a -> b\ngroup g a").diagnostics[0].code).toBe("E102");
});
test("nested group may only take members from its parent", () =>
  expect(parse("a -> b\ngroup g : a\ngroup h in g : b").diagnostics[0].code).toBe("E404"));
test("shape and color attributes", () => {
  const { doc, diagnostics } = parse("db[DB]{shape: db, color: orange, icon: logos:mysql} -> q{shape: queue}");
  expect(diagnostics).toEqual([]);
  expect(doc.nodes.get("db")).toMatchObject({ shape: "db", color: "orange", icon: "logos:mysql" });
  expect(doc.nodes.get("q")!.shape).toBe("queue");
});
test("bad shape and color", () => {
  expect(parse("a{shape: star} -> b").diagnostics[0]).toMatchObject({ code: "E110", args: { value: "star" } });
  expect(parse("a{color: #12} -> b").diagnostics[0]).toMatchObject({ code: "E111" });
});
