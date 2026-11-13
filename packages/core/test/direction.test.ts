import { expect, test } from "vitest";
import { formatSource, fromMermaid, parse } from "../src/index";

const codes = (src: string) => parse(src).diagnostics.map((d) => d.code);

test("direction sets the flow direction; unset means right", () => {
  expect(parse("a -> b").doc.direction).toBeUndefined();
  expect(parse("direction down\na -> b").doc.direction).toBe("down");
  expect(parse("direction right\na -> b").doc.direction).toBe("right");
  expect(codes("direction down\na -> b")).toEqual([]);
});

test("unknown direction is E119 with a suggestion; missing value is E307; repeated is W107", () => {
  const { diagnostics } = parse("direction dwon\na -> b");
  expect(diagnostics[0]).toMatchObject({
    code: "E119",
    severity: "error",
    span: { line: 1, col: 11, length: 4 },
    args: { value: "dwon", suggestion: "down" },
  });
  expect(codes("direction up\na -> b")).toEqual(["E119"]);
  expect(codes("direction\na -> b")).toEqual(["E307"]);
  expect(codes("direction down\ndirection right\na -> b")).toEqual(["W107"]);
});

test("direction has no effect in a sequence diagram (W111), wherever the diagram line is", () => {
  expect(codes("diagram sequence\ndirection down\na -> b")).toEqual(["W111"]);
  expect(codes("direction down\na -> b\ndiagram sequence")).toEqual(["W111"]);
});

test("direction is a keyword: a node with that name at line start is E115, fine after an arrow", () => {
  expect(codes("direction -> b")).toEqual(["E115"]);
  expect(codes("a -> direction")).toEqual([]);
});

test("fmt normalises the spacing", () => {
  expect(formatSource("direction    down\na -> b\n")).toBe("direction down\na -> b\n");
});

test("from-mermaid keeps top-to-bottom and warns about directions ene does not have", () => {
  for (const d of ["TD", "TB"]) {
    const r = fromMermaid(`flowchart ${d}\n  a --> b`);
    expect(r.source).toContain("\ndirection down\n");
    expect(parse(r.source).doc.direction).toBe("down");
    expect(r.warnings.map((w) => w.message).join()).not.toContain("is ignored");
  }
  const lr = fromMermaid("flowchart LR\n  a --> b");
  expect(lr.source).not.toContain("direction");
  const rl = fromMermaid("flowchart RL\n  a --> b");
  expect(rl.source).not.toContain("direction");
  expect(rl.warnings.map((w) => w.message)).toContain(
    "direction `RL` is ignored; ene lays out flows left to right or top to bottom",
  );
});
