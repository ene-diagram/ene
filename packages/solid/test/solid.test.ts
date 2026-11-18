// @vitest-environment happy-dom
// The browser builds: under Node, "solid-js" resolves to the server build, where effects never run
import * as solid2 from "../node_modules/solid-js/dist/solid.js";
import * as solid1 from "../node_modules/solid-js-v1/dist/solid.js";
import { describe, expect, it, vi } from "vitest";
import { installDom } from "../../player/test/dom-setup.js";
import { createEneDiagram, type EneDiagramProps, type SolidApi } from "../src/create.js";

installDom();
const BRANCH = "a -> b : go\nbranch ok\n  b --> a : fine\nelse fail\n  b -x a : broken\nend";
const until = async (fn: () => unknown, tick: () => void) => {
  for (let i = 0; i < 200 && !fn(); i++) {
    tick();
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(fn()).toBeTruthy();
};

type Lib = typeof solid1 | typeof solid2;
const versions: [string, Lib, () => void][] = [
  ["1.x", solid1, () => {}],
  ["2.x", solid2, () => (solid2 as unknown as { flush: () => void }).flush()],
];

describe.each(versions)("@ene-diagram/solid with solid-js %s", (_v, lib, flush) => {
  it("renders, follows signals, and cleans up", async () => {
    const EneDiagram = createEneDiagram(lib as unknown as SolidApi);
    const [source, setSource] = (lib.createSignal as typeof solid1.createSignal)(BRANCH);
    const [choices, setChoices] = (lib.createSignal as typeof solid1.createSignal)<number[]>([0]);
    const onReady = vi.fn();
    const props: EneDiagramProps = {
      get source() {
        return source();
      },
      get choices() {
        return choices();
      },
      autoplay: false,
      onReady,
    };
    let dispose!: () => void;
    const el = document.createElement("div");
    document.body.append(el);
    (lib.createRoot as typeof solid1.createRoot)((d) => {
      dispose = d;
      el.append(EneDiagram(props) as Node);
    });
    flush();
    await until(() => onReady.mock.calls.length === 1, flush);
    const p = onReady.mock.calls[0][0];
    setChoices([1]);
    flush();
    expect(p.choices).toEqual([1]);
    setSource(`title Two\n${BRANCH}`);
    flush();
    await until(() => onReady.mock.calls.length === 2, flush);
    expect(el.textContent).toContain("Two");
    dispose();
    expect(el.querySelector(".ene-player")).toBeNull();
  });
});
