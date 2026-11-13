import { readFileSync } from "node:fs";
import { parse } from "../src/parse";
import { KEYWORDS } from "../src/diagnostics";
import { SHAPES } from "../src/types";

const root = new URL("../../../", import.meta.url).pathname;
const doc = readFileSync(`${root}SYNTAX.md`, "utf8");
const blocks = [...doc.matchAll(/```ene( (\w+))?\n([\s\S]*?)```/g)].map((m) => ({ code: m[2], src: m[3] }));

test("SYNTAX.md has valid examples and mistake examples", () => {
  expect(blocks.filter((b) => !b.code).length).toBeGreaterThan(4);
  expect(blocks.filter((b) => b.code).length).toBeGreaterThan(10);
});
test.each(blocks.filter((b) => !b.code).map((b) => [b.src.split("\n")[0], b.src]))(
  "valid example parses cleanly: %s",
  (_, src) => {
    expect(parse(src).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  },
);
test.each(blocks.filter((b) => b.code).map((b) => [b.code!, b.src]))("mistake example produces %s", (code, src) => {
  expect(parse(src).diagnostics.map((d) => d.code)).toContain(code);
});
test("every keyword and shape is documented", () => {
  for (const k of KEYWORDS) expect(doc).toContain(`\`${k}`);
  for (const s of SHAPES) expect(doc).toContain(`\`${s}\``);
  for (const a of ["icon", "shape", "color"]) expect(doc).toContain(`${a}:`);
});
test("llms.txt copies stay in sync with SYNTAX.md", () => {
  expect(readFileSync(`${root}llms.txt`, "utf8")).toBe(doc);
  expect(readFileSync(`${root}site/llms.txt`, "utf8")).toBe(doc);
  expect(readFileSync(`${root}skills/ene/SYNTAX.md`, "utf8")).toBe(doc);
});
