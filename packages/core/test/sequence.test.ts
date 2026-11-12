import { parse } from "../src/parse";
test("diagram sequence header", () => {
  expect(parse("diagram sequence\na -> b").doc.kind).toBe("sequence");
  expect(parse("a -> b").doc.kind).toBe("flow");
  expect(parse("diagram gantt\na -> b").diagnostics[0]).toMatchObject({ code: "E112", args: { value: "gantt" } });
});
