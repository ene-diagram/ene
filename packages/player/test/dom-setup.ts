import { createRequire } from "node:module";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";

const require = createRequire(`${process.cwd()}/packages/layout/package.json`);

/** happy-dom gaps (ELK global, SVG geometry, Option) and a manual rAF queue */
export function installDom() {
  const frames = { queue: new Map<number, FrameRequestCallback>(), next: 1 };
  beforeAll(() => {
    (window as unknown as { ELK: unknown }).ELK = require("elkjs/lib/elk.bundled.js");
    const proto = (window as unknown as { SVGElement: { prototype: Record<string, unknown> } }).SVGElement.prototype;
    proto.getTotalLength ??= () => 100;
    proto.getPointAtLength ??= () => ({ x: 0, y: 0 });
    const g = globalThis as unknown as { Option?: unknown };
    if (typeof g.Option !== "function")
      // biome-ignore lint/complexity/useArrowFunction: Option must be callable with `new`
      g.Option = function (text = "", value = text, defSel = false, sel = false) {
        const o = document.createElement("option");
        o.text = text;
        o.value = value;
        o.defaultSelected = defSel;
        o.selected = sel;
        return o;
      };
  });
  beforeEach(() => {
    frames.queue = new Map();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = frames.next++;
      frames.queue.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.queue.delete(id);
    });
    document.body.replaceChildren();
  });
  afterEach(() => vi.unstubAllGlobals());
  return frames;
}

export function addPre(src: string, cls = "ene") {
  const pre = document.createElement("pre");
  pre.className = cls;
  pre.textContent = src;
  document.body.appendChild(pre);
  return pre;
}
