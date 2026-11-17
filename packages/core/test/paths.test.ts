import { expect, test } from "vitest";
import { buildTimeline, enumeratePaths, parse } from "../src/index";

const paths = (src: string, limit?: number) => enumeratePaths(parse(src).doc, limit);

test("no branches: one path with no labels", () => {
  expect(paths("a -> b")).toEqual([{ choices: [], labels: [] }]);
});

test("one path per arm, labelled by the arm", () => {
  expect(paths("a -> b\nbranch hit\n  b --> a\nelse miss\n  b -x a\nelse\n  b -> c\nend")).toEqual([
    { choices: [0], labels: ["hit"] },
    { choices: [1], labels: ["miss"] },
    { choices: [2], labels: ["#3"] },
  ]);
});

test("opt is taken or skipped", () => {
  expect(paths("a -> b\nopt coupon\n  a -> c\nend")).toEqual([
    { choices: [0], labels: ["coupon"] },
    { choices: [1], labels: ["skip coupon"] },
  ]);
});

test("a branch inside an arm that is not taken does not multiply the paths", () => {
  const src =
    "branch one\n  a -> b\n  opt extra\n    a -> c\n  end\nelse two\n  a -> c\n  branch x\n    a -> b\n  else y\n    b -> a\n  end\nend";
  const ps = paths(src)!;
  expect(ps.map((p) => p.labels.join(","))).toEqual(["one,extra", "one,skip extra", "two,x", "two,y"]);
  expect(ps.map((p) => p.choices)).toEqual([
    [0, 0, 0],
    [0, 1, 0],
    [1, 0, 0],
    [1, 0, 1],
  ]);
  // Every path is a different timeline
  const doc = parse(src).doc;
  const seen = new Set(
    ps.map((p) => JSON.stringify(buildTimeline(doc, { choices: p.choices }).steps.map((s) => s.edges))),
  );
  expect(seen.size).toBe(4);
});

test("independent branches multiply; a branch in a loop counts once", () => {
  const two = "branch a1\n  a -> b\nelse a2\n  a -> c\nend\n";
  expect(paths(`${two}loop 3\n${two}end`)).toHaveLength(4);
});

test("more paths than the limit: undefined", () => {
  const two = "branch\n  a -> b\nelse\n  a -> c\nend\n";
  expect(paths(two.repeat(4))).toHaveLength(16);
  expect(paths(two.repeat(5))).toBeUndefined();
  expect(paths(two.repeat(2), 3)).toBeUndefined();
  expect(paths(two.repeat(40))).toBeUndefined();
});
