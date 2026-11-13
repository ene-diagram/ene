// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildTimeline, parse } from "@ene-diagram/core";
import { layoutSequence } from "@ene-diagram/layout";
import { loopSeconds, renderSvg } from "@ene-diagram/svg";
import { applyTheme, freeze, frameTimes, loopLength, sample, stripReducedMotion, svgSize } from "../src/index.js";

const doc = parse("diagram sequence\na -> b : one\nb -x a : two").doc;
const tl = buildTimeline(doc);
const svg = renderSvg(layoutSequence(doc, tl), tl);

describe("sample", () => {
  it("interpolates linearly and treats repeated keyTimes as jumps", () => {
    const v = [0, 0, 1, 1, 0],
      k = [0, 0.2, 0.2, 0.8, 1];
    expect(sample(v, k, 0.1)).toBe(0);
    expect(sample(v, k, 0.2)).toBe(1);
    expect(sample(v, k, 0.5)).toBe(1);
    expect(sample(v, k, 0.9)).toBeCloseTo(0.5);
    expect(sample(v, k, 1)).toBe(0);
    expect(sample([0, 10], [0, 1], 0.25)).toBe(2.5);
  });
});

describe("svg helpers", () => {
  it("reads the loop length and size of an exported svg", () => {
    expect(loopLength(svg)).toBeCloseTo(loopSeconds(tl));
    expect(svgSize(svg).width).toBeGreaterThan(0);
    expect(frameTimes(1, 4)).toEqual([0, 0.25, 0.5, 0.75]);
  });
  it("fixes the colour scheme and drops the reduced-motion rule", () => {
    expect(applyTheme(svg, "auto")).toBe(svg);
    expect(applyTheme(svg, "light")).not.toContain("prefers-color-scheme");
    const dark = applyTheme(svg, "dark");
    expect(dark).not.toContain("prefers-color-scheme");
    expect(dark).toContain("--bg:#111113");
    expect(svg).toContain("prefers-reduced-motion");
    expect(stripReducedMotion(svg)).not.toContain("prefers-reduced-motion");
    expect(stripReducedMotion(svg)).toContain("svg.ene-theme-default{--bg:#fbfcfd");
  });
});

describe("freeze", () => {
  const frozen = (t: number) => {
    const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    const seen: string[] = [];
    freeze(root, t, (id, f) => {
      seen.push(id);
      return { x: f * 100, y: 0 };
    });
    return { root, seen };
  };
  it("removes every animation element and writes plain values", () => {
    const { root, seen } = frozen(0);
    expect(root.getElementsByTagName("animate").length).toBe(0);
    expect(root.getElementsByTagName("animateMotion").length).toBe(0);
    expect(seen.length).toBe(2);
    for (const el of Array.from(root.querySelectorAll(".hl"))) expect(el.getAttribute("opacity")).toBe("0");
  });
  it("shows the first edge and moves its dot partway during step 1", () => {
    const s0 = tl.steps[0],
      mid = s0.start + s0.edges[0].duration * 0.4;
    const { root } = frozen(mid);
    const [hl1, hl2] = Array.from(root.querySelectorAll(".hl"));
    expect(hl1.getAttribute("opacity")).toBe("1");
    expect(hl2.getAttribute("opacity")).toBe("0");
    const dot = root.querySelector("circle.dot")!;
    expect(dot.getAttribute("opacity")).toBe("1");
    const x = Number(/translate\(([\d.]+)/.exec(dot.getAttribute("transform")!)![1]);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(100);
  });
});
