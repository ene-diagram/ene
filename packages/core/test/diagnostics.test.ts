import { parse } from "../src/parse";
import { formatDiagnostic } from "../src/format";
import { CODES, MESSAGES } from "../src/diagnostics";
test("format shows line, source, caret, hint", () => {
  const src = "cache -> api\npin cahce 1,0";
  const out = formatDiagnostic(src, parse(src).diagnostics[0], "en");
  expect(out).toBe(
`error[E401]: unknown node "cahce"
 --> line 2, col 5
  |
2 | pin cahce 1,0
  |     ^^^^^
  = hint: did you mean "cache"?`);
});
test("korean messages", () =>
  expect(formatDiagnostic("a ->", parse("a ->").diagnostics[0], "ko")).toContain("화살표 뒤에 대상 노드가 없어요"));
test("collects multiple errors", () =>
  expect(parse("a ->\nwait x\nend").diagnostics.map(d => d.code)).toEqual(["E103", "E301", "E204"]));
test("typo warning W101", () => {
  const d = parse("cache -> api\napi -> cahce").diagnostics[0];
  expect(d).toMatchObject({ code: "W101", severity: "warning" }); expect(d.args.suggestion).toBe("cache");
});
test("keyword typo suggests keyword", () =>
  expect(parse("a -> b\nbrnch hit").diagnostics[0].args.suggestion).toBe("branch"));
test("self edge warns W103", () => expect(parse("a -> a").diagnostics[0].code).toBe("W103"));
test.each([...CODES])("every code has en and ko message and hint: %s", (c) => {
  expect(MESSAGES.en[c].message).toBeTruthy(); expect(MESSAGES.ko[c].hint).toBeTruthy();
  expect(MESSAGES.ko[c].message).toBeTruthy(); expect(MESSAGES.en[c].hint).toBeTruthy();
});
test("E307 for keywords with no value", () => {
  for (const [src, kw] of [["speed", "speed"], ["a -> b\nwait", "wait"], ["loop\na -> b\nend", "loop"]] as const) {
    const d = parse(src).diagnostics.find((x) => x.code === "E307");
    expect(d?.args).toMatchObject({ keyword: kw });
  }
});
