import { parse, THEMES } from "../src/index";

test("theme sets the document theme", () => {
  for (const t of THEMES) expect(parse(`theme ${t}\na -> b`).doc.theme).toBe(t);
  expect(parse("a -> b").doc.theme).toBeUndefined();
});
test("unknown theme is E116 with a suggestion; missing value is E307; repeated is W107", () => {
  expect(parse("theme mnoo\na -> b").diagnostics[0]).toMatchObject({ code: "E116", args: { value: "mnoo", suggestion: "mono" } });
  expect(parse("theme\na -> b").diagnostics[0]).toMatchObject({ code: "E307", args: { keyword: "theme" } });
  expect(parse("theme mono\ntheme default\na -> b").diagnostics.map((d) => d.code)).toEqual(["W107"]);
});
