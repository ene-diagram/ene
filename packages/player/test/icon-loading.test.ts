// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { autoRun, render } from "../src/player.js";

beforeAll(() => {
  SVGElement.prototype.getTotalLength = () => 100;
  SVGElement.prototype.getPointAtLength = () => ({ x: 0, y: 0 }) as DOMPoint;
});
beforeEach(() => {
  vi.stubGlobal("Option", function (text = "", value = text) {
    const o = document.createElement("option");
    o.text = text; o.value = value;
    return o;
  });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("a malformed URL warns and still renders the diagram", async () => {
  const el = document.createElement("div");
  const p = await render(el, "diagram sequence\na{icon: http://[} -> b", { autoplay: false });
  try {
    expect(el.querySelector(".ene-player")).not.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("invalid URL"));
  } finally { p?.destroy(); }
});

test("autoRun continues after a malformed icon URL", async () => {
  for (const source of ["diagram sequence\na{icon: http://[} -> b", "diagram sequence\nc -> d"]) {
    const pre = document.createElement("pre");
    pre.className = "ene"; pre.textContent = source; document.body.appendChild(pre);
  }
  await autoRun("pre.ene", { autoplay: false });
  expect(document.querySelectorAll(".ene-player")).toHaveLength(2);
});
