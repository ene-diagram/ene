import { parse } from "../src/parse";
import { resolveIcon, checkIcons, type IconPack } from "../src/icons";
import { CODES, MESSAGES } from "../src/diagnostics";
const pack: IconPack = { prefix: "aws", width: 24, height: 24,
  icons: { lambda: { body: '<path d="M0 0h24v24z"/>' }, s3: { body: "<circle/>", width: 32, height: 32 } },
  aliases: { "aws-lambda": { parent: "lambda" } } };

test("node attribute {icon: x}", () => {
  const { doc, diagnostics } = parse("api[API]{icon: aws:lambda} -> db{icon: https://x.io/d.svg}");
  expect(diagnostics).toEqual([]);
  expect(doc.nodes.get("api")).toMatchObject({ label: "API", icon: "aws:lambda" });
  expect(doc.nodes.get("db")!.icon).toBe("https://x.io/d.svg");
});
test("icon attr in parallel and continuation lines", () => {
  const { doc } = parse("a{icon: aws:s3} -> b & a -> c{icon: aws:lambda}\n& a -> d");
  expect(doc.nodes.get("c")!.icon).toBe("aws:lambda");
  const s = doc.body[0]; expect(s.type === "step" && s.edges).toHaveLength(3);
});
test("unknown attribute E108, unclosed brace E109", () => {
  expect(parse("a{size: 3} -> b").diagnostics[0]).toMatchObject({ code: "E108", args: { name: "size" } });
  expect(parse("a{icon: aws:s3 -> b").diagnostics[0].code).toBe("E109");
});
test("resolveIcon uses pack defaults and aliases", () => {
  expect(resolveIcon("aws:lambda", [pack])).toEqual({ body: '<path d="M0 0h24v24z"/>', width: 24, height: 24 });
  expect(resolveIcon("aws:aws-lambda", [pack])?.body).toContain("path");
  expect(resolveIcon("aws:s3", [pack])).toMatchObject({ width: 32, height: 32 });
  expect(resolveIcon("gcp:x", [pack])).toBeUndefined();
});
test("checkIcons warns W104 with suggestion, skips URLs", () => {
  const { doc } = parse("a{icon: aws:lamda} -> b{icon: https://x/y.svg}");
  const d = checkIcons(doc, [pack]);
  expect(d).toHaveLength(1); expect(d[0]).toMatchObject({ code: "W104", severity: "warning", args: { suggestion: "aws:lambda" } });
});
test("new codes have messages", () => {
  for (const c of ["E108", "E109", "W104"] as const) { expect(CODES).toContain(c); expect(MESSAGES.ko[c].message).toBeTruthy(); }
});
test("validateIconPack accepts valid packs and reports structural problems", async () => {
  const { validateIconPack } = await import("../src/icons");
  expect(validateIconPack(pack)).toEqual([]);
  expect(validateIconPack(null)).toEqual(["pack must be a JSON object"]);
  expect(validateIconPack({ prefix: "a", icons: [] })).toContain('"icons" must be an object');
  expect(validateIconPack({ prefix: "a", icons: { x: { body: 1 } } })[0]).toContain("icons.x");
  expect(validateIconPack({ prefix: "a", width: "1\" onload", icons: {} })[0]).toContain('"width"');
  expect(validateIconPack({ prefix: "a", icons: { x: { body: "", width: -1 } } })[0]).toContain("width/height");
});
