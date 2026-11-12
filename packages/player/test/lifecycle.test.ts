// @vitest-environment happy-dom
import { createRequire } from "node:module";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { autoRun, render } from "../src/player.js";

const require = createRequire(`${process.cwd()}/packages/layout/package.json`);
const SRC = "a[A] -> b[B] : hello\nb --> a : ok";

// Manual rAF queue so tests can count scheduled frames deterministically
let queue = new Map<number, FrameRequestCallback>();
let nextId = 1;
const flushFrame = (now = performance.now() + 16) => {
  const cbs = [...queue.values()];
  queue = new Map();
  cbs.forEach((cb) => cb(now));
};

beforeAll(() => {
  (window as unknown as { ELK: unknown }).ELK = require("elkjs/lib/elk.bundled.js");
  const proto = (window as unknown as { SVGElement: { prototype: Record<string, unknown> } }).SVGElement.prototype;
  proto.getTotalLength ??= () => 100;
  proto.getPointAtLength ??= () => ({ x: 0, y: 0 });
  const g = globalThis as unknown as { Option?: unknown };
  if (typeof g.Option !== "function")
    g.Option = function (text = "", value = text, defSel = false, sel = false) {
      const o = document.createElement("option");
      o.text = text; o.value = value; o.defaultSelected = defSel; o.selected = sel;
      return o;
    };
});
beforeEach(() => {
  queue = new Map();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { const id = nextId++; queue.set(id, cb); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { queue.delete(id); });
  document.body.replaceChildren();
});
afterEach(() => vi.unstubAllGlobals());

describe("player lifecycle", () => {
  it("does not schedule frames while paused (autoplay off)", async () => {
    const el = document.createElement("div");
    const p = await render(el, SRC, { autoplay: false });
    expect(p).toBeDefined();
    expect(queue.size).toBe(0);
    p!.controller.play();
    expect(queue.size).toBe(1);
    flushFrame();
    expect(queue.size).toBe(1);
    p!.controller.pause();
    flushFrame();
    expect(queue.size).toBe(0);
    p!.controller.toggle();
    expect(queue.size).toBe(1);
    p!.destroy();
  });

  it("stops the frame loop on destroy and is idempotent", async () => {
    const el = document.createElement("div");
    const p = (await render(el, SRC, { autoplay: true }))!;
    expect(queue.size).toBe(1);
    p.destroy();
    expect(queue.size).toBe(0);
    expect(el.childElementCount).toBe(0);
    expect(() => p.destroy()).not.toThrow();
    p.controller.play();
    expect(queue.size).toBe(0);
  });

  it("repeated render into the same element disposes the previous player", async () => {
    const el = document.createElement("div");
    const a = (await render(el, SRC))!;
    const b = (await render(el, SRC))!;
    expect(el.querySelectorAll(".ene-player").length).toBe(1);
    expect(queue.size).toBe(1);
    a.destroy(); // stale handle must not remove the newer player
    expect(el.querySelectorAll(".ene-player").length).toBe(1);
    b.destroy();
    expect(el.childElementCount).toBe(0);
  });

  it("overlapping async renders: only the latest wins", async () => {
    const el = document.createElement("div");
    const first = render(el, "title First\n" + SRC);
    const second = render(el, "title Second\n" + SRC);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBeUndefined();
    expect(b).toBeDefined();
    expect(el.querySelectorAll(".ene-player").length).toBe(1);
    expect(el.querySelector(".ene-player")!.getAttribute("aria-label")).toBe("Second");
    b!.destroy();
  });

  it("autoRun returns handles for multiple players", async () => {
    for (const src of [SRC, SRC, "a ->"]) {
      const pre = document.createElement("pre");
      pre.className = "ene";
      pre.textContent = src;
      document.body.appendChild(pre);
    }
    const players = await autoRun("pre.ene", { autoplay: false });
    expect(players).toHaveLength(2);
    expect(document.querySelectorAll(".ene-player").length).toBe(2);
    expect(queue.size).toBe(0);
    players.forEach((p) => p.controller.play());
    expect(queue.size).toBe(2);
    players.forEach((p) => p.destroy());
    expect(queue.size).toBe(0);
    expect(document.querySelectorAll(".ene-player").length).toBe(0);
  });
});
