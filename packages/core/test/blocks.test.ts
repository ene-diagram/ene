import { parse } from "../src/parse";
test("branch with two arms", () => {
  const b = parse("a -> b\nbranch hit\n b -> a\nbranch miss\n b -> c\n c -> a\nend").doc.body[1];
  expect(b.type).toBe("branch");
  expect(b.type === "branch" && b.arms.map(a => [a.label, a.body.length])).toEqual([["hit", 1], ["miss", 2]]);
});
test("loop and wait and per-edge duration", () => {
  const { doc } = parse("loop 3\n a -> b @2s\nend\nwait 0.5");
  const l = doc.body[0]; expect(l.type === "loop" && l.count).toBe(3);
  expect(l.type === "loop" && (l.body[0] as any).edges[0].duration).toBe(2);
  expect(doc.body[1]).toMatchObject({ type: "wait", seconds: 0.5 });
});
test("nested unclosed blocks report each opener", () => {
  const d = parse("branch x\n loop 2\n  a -> b").diagnostics.filter(d => d.code === "E203");
  expect(d.map(x => x.span.line)).toEqual([1, 2]);
});
test("stray end", () => expect(parse("a -> b\nend").diagnostics[0].code).toBe("E204"));
test("bad numbers", () =>
  expect(parse("wait -1\nloop 0\na -> b @fast\nend\nspeed 0").diagnostics.map(d => d.code))
    .toEqual(["E301", "E302", "E303", "E304"]));
test("empty branch arm", () =>
  expect(parse("a -> b\nbranch x\nbranch y\n a -> b\nend").diagnostics.map(d => d.code)).toEqual(["E201"]));
test("unclosed blocks are reported in line order", () =>
  expect(parse("loop 2\nbranch x\n a -> b\n loop 3\n  a -> c").diagnostics.filter(d => d.code === "E203").map(d => d.span.line)).toEqual([1, 2, 4]));
