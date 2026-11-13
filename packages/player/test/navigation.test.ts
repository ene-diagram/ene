// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { autoRun, MAX_ZOOM, parseStepLink, render } from "../src/index";
import { addPre, installDom } from "./dom-setup";

installDom();
const STEPS = "speed 1\ntitle Order\nuser -> api : POST\napi -> db : INSERT\ndb --> api : ok";
const mount = async (opts: Parameters<typeof render>[2] = {}) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const p = (await render(el, STEPS, { autoplay: false, lang: "en", ...opts }))!;
  return { el, p, seek: el.querySelector<HTMLInputElement>("input.ene-seek")!, svg: el.querySelector("svg")! };
};
const stepText = (el: Element) => el.querySelector(".ene-step")!.textContent;
const box = (svg: Element) => svg.getAttribute("viewBox")!.split(" ").map(Number);
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

describe("seek bar", () => {
  it("spans the timeline, follows steps, and dragging it pauses at that time", async () => {
    const { el, p, seek } = await mount();
    expect(seek.max).toBe("3");
    expect(seek.value).toBe("0");
    key(el.querySelector(".ene-player")!, "ArrowRight");
    expect(seek.value).toBe("1");
    p.controller.play();
    seek.value = "2.4";
    seek.dispatchEvent(new Event("input"));
    expect(p.controller.playing).toBe(false);
    expect(p.controller.time).toBeCloseTo(2.4);
    expect(stepText(el)).toMatch(/^3\/3/);
    expect(p.step).toBe(3);
  });
  it("keeps the player keys when it has focus", async () => {
    const { p, seek } = await mount();
    key(seek, "ArrowRight");
    expect(p.controller.time).toBe(1);
    key(seek, " ");
    expect(p.controller.playing).toBe(true);
  });
  it("gets the new length when a branch changes the timeline", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const p = (await render(el, "speed 1\na -> b\nbranch x\n  b -> c\nelse y\n  b -> c\n  c -> a\nend", {
      autoplay: false,
    }))!;
    const seek = el.querySelector<HTMLInputElement>("input.ene-seek")!;
    expect(seek.max).toBe("2");
    p.setChoices([1]);
    expect(seek.max).toBe("3");
  });
});

describe("opening at a step", () => {
  it("step option opens paused there, even with autoplay; goto moves and clamps", async () => {
    const { el, p } = await mount({ step: 2, autoplay: true });
    expect(p.controller.playing).toBe(false);
    expect(p.step).toBe(2);
    expect(stepText(el)).toMatch(/^2\/3/);
    p.goto(99);
    expect(p.step).toBe(3);
    p.goto(0);
    expect(p.step).toBe(1);
  });
  it("parses #ene-step links", () => {
    expect(parseStepLink("#ene-step=7")).toEqual({ diagram: 1, step: 7, explicit: false });
    expect(parseStepLink("#ene-step=2.7")).toEqual({ diagram: 2, step: 7, explicit: true });
    expect(parseStepLink("#a=b&ene-step=3&c")).toEqual({ diagram: 1, step: 3, explicit: false });
    for (const bad of [
      "",
      "#",
      "#ene-step=",
      "#ene-step=0",
      "#ene-step=0.2",
      "#ene-step=x",
      "#xene-step=2",
      "#ene-step=2x",
    ])
      expect(parseStepLink(bad)).toBeUndefined();
  });
  it("autoRun: data-step per diagram, and the link picks its diagram", async () => {
    addPre(STEPS);
    addPre(STEPS).dataset.step = "2";
    addPre(STEPS).dataset.step = "junk";
    location.hash = "#ene-step=1.3";
    const ps = await autoRun("pre.ene", { autoplay: false });
    location.hash = "";
    expect(ps.map((p) => p.step)).toEqual([3, 2, 1]);
    expect(ps.map((p) => p.controller.playing)).toEqual([false, false, false]);
    for (const p of ps) p.destroy();
  });
});

describe("zoom and pan", () => {
  it("buttons zoom around the centre, stop at the limits and are disabled there", async () => {
    const { el, p, svg } = await mount();
    const [x0, y0, w0, h0] = box(svg);
    expect([x0, y0]).toEqual([0, 0]);
    const out = el.querySelector<HTMLButtonElement>('button[aria-label="Zoom out"]')!,
      inn = el.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!;
    expect(out.disabled).toBe(true);
    inn.click();
    expect(p.zoom).toBe(1.5);
    const [x, y, w, h] = box(svg);
    expect(w).toBeCloseTo(w0 / 1.5, 1);
    expect(x + w / 2).toBeCloseTo(w0 / 2, 1);
    expect(y + h / 2).toBeCloseTo(h0 / 2, 1);
    expect(svg.classList.contains("ene-zoomed")).toBe(true);
    // The element keeps its size: only the view box changes
    expect(svg.getAttribute("width")).toBe(String(w0));
    for (let i = 0; i < 9; i++) inn.click();
    expect(p.zoom).toBe(MAX_ZOOM);
    expect(inn.disabled).toBe(true);
    p.setZoom(0.1);
    expect(p.zoom).toBe(1);
    expect(box(svg)).toEqual([0, 0, w0, h0]);
    expect(svg.classList.contains("ene-zoomed")).toBe(false);
  });
  it("+, - and 0 zoom from the keyboard", async () => {
    const { el, p } = await mount();
    const root = el.querySelector(".ene-player")!;
    key(root, "+");
    key(root, "=");
    expect(p.zoom).toBeCloseTo(2.25);
    key(root, "-");
    expect(p.zoom).toBeCloseTo(1.5);
    key(root, "0");
    expect(p.zoom).toBe(1);
  });
  it("zoom: false leaves the buttons and keys out", async () => {
    const { el, p } = await mount({ zoom: false });
    expect(el.querySelector('button[aria-label="Zoom in"]')).toBeNull();
    key(el.querySelector(".ene-player")!, "+");
    expect(p.zoom).toBe(1);
  });
  it("the exported SVG is not zoomed", async () => {
    const { p, svg } = await mount();
    const whole = svg.getAttribute("viewBox")!;
    p.setZoom(2);
    expect(p.toSvg()).toContain(`viewBox="${whole}"`);
  });
});
