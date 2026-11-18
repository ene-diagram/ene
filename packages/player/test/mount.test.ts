// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { mount, render } from "../src/index.js";
import { installDom } from "./dom-setup.js";

installDom();
const BRANCH = "a -> b : go\nbranch ok\n  b --> a : fine\nelse fail\n  b -x a : broken\nend";
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};
const until = async (fn: () => unknown) => {
  for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(fn()).toBeTruthy();
};

describe("mount", () => {
  it("renders, then reports the player through onReady", async () => {
    const el = document.createElement("div");
    const onReady = vi.fn();
    const m = mount(el, BRANCH, { autoplay: false, onReady });
    await until(() => onReady.mock.calls.length);
    expect(onReady.mock.calls[0][0]).toBe(m.player);
    expect(el.querySelector(".ene-player")).not.toBeNull();
  });

  it("destroy before the render finishes leaves nothing behind and never calls onReady", async () => {
    const el = document.createElement("div");
    const onReady = vi.fn();
    const m = mount(el, BRANCH, { autoplay: false, onReady });
    m.destroy();
    await settle();
    expect(onReady).not.toHaveBeenCalled();
    expect(el.querySelector(".ene-player")).toBeNull();
    expect(m.player).toBeUndefined();
    m.update("a -> b", {});
    await settle();
    expect(el.querySelector(".ene-player")).toBeNull();
  });

  it("mount, destroy, mount on the same element (React StrictMode) ends with one player", async () => {
    const el = document.createElement("div");
    mount(el, BRANCH, { autoplay: false }).destroy();
    const onReady = vi.fn();
    const m = mount(el, BRANCH, { autoplay: false, onReady });
    await until(() => onReady.mock.calls.length);
    expect(el.querySelectorAll(".ene-player").length).toBe(1);
    expect(m.player).toBeDefined();
  });

  it("rapid source changes: only the last one is shown", async () => {
    const el = document.createElement("div");
    const onReady = vi.fn();
    const m = mount(el, "a -> b : one", { autoplay: false, onReady });
    m.update("a -> b : two", { autoplay: false, onReady });
    m.update("a -> b : three", { autoplay: false, onReady });
    await until(() => onReady.mock.calls.length);
    await settle();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(el.querySelectorAll(".ene-player").length).toBe(1);
    expect(el.textContent).toContain("three");
  });

  it("a changed choices value goes to setChoices without a new player", async () => {
    const el = document.createElement("div");
    const onReady = vi.fn();
    const m = mount(el, BRANCH, { autoplay: false, choices: [0], onReady });
    await until(() => onReady.mock.calls.length);
    const p = m.player!;
    m.update(BRANCH, { autoplay: false, choices: [1], onReady });
    expect(m.player).toBe(p);
    expect(p.choices).toEqual([1]);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("uncontrolled: the viewer's pick survives a source change", async () => {
    const el = document.createElement("div");
    const onReady = vi.fn();
    const onChoicesChange = vi.fn();
    const m = mount(el, BRANCH, { autoplay: false, onReady, onChoicesChange });
    await until(() => onReady.mock.calls.length);
    const sel = el.querySelector<HTMLSelectElement>(
      '.ene-bar select[aria-label^="Branch"], .ene-bar select[aria-label^="분기"]',
    )!;
    sel.value = "1";
    sel.dispatchEvent(new Event("change"));
    expect(onChoicesChange).toHaveBeenCalledWith([1]);
    m.update(`title v2\n${BRANCH}`, { autoplay: false, onReady, onChoicesChange });
    await until(() => onReady.mock.calls.length === 2);
    expect(m.player!.choices).toEqual([1]);
  });

  it("a new callback is used without rendering again", async () => {
    const el = document.createElement("div");
    const onReady = vi.fn();
    const first = vi.fn();
    const second = vi.fn();
    const m = mount(el, BRANCH, { autoplay: false, onReady, onChoicesChange: first });
    await until(() => onReady.mock.calls.length);
    m.update(BRANCH, { autoplay: false, onReady, onChoicesChange: second });
    const sel = el.querySelector<HTMLSelectElement>(
      '.ene-bar select[aria-label^="Branch"], .ene-bar select[aria-label^="분기"]',
    )!;
    sel.value = "1";
    sel.dispatchEvent(new Event("change"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith([1]);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("a pick made on the old player while the new one renders is applied to the new one", async () => {
    const el = document.createElement("div");
    const onReady = vi.fn();
    const m = mount(el, BRANCH, { autoplay: false, onReady });
    await until(() => onReady.mock.calls.length === 1);
    m.update(`title v2\n${BRANCH}`, { autoplay: false, onReady });
    // The previous player is still on screen; pick an arm on it
    const sel = el.querySelector<HTMLSelectElement>('.ene-bar select[aria-label^="Branch"]')!;
    sel.value = "1";
    sel.dispatchEvent(new Event("change"));
    await until(() => onReady.mock.calls.length === 2);
    expect(m.player!.choices).toEqual([1]);
  });

  it("a render that throws clears the previous player and reports the error", async () => {
    const el = document.createElement("div");
    const onReady = vi.fn();
    const onError = vi.fn();
    const m = mount(el, "a -> b", { autoplay: false, onReady, onError });
    await until(() => onReady.mock.calls.length === 1);
    const include = () => {
      throw new Error("boom");
    };
    m.update("include ./x.ene\na -> b", { autoplay: false, onReady, onError, include });
    await until(() => onError.mock.calls.length === 1);
    expect(m.player).toBeUndefined();
    expect(el.querySelector(".ene-player")).toBeNull();
  });

  it("a source with errors calls onReady with undefined and shows the diagnostics", async () => {
    const el = document.createElement("div");
    const onReady = vi.fn();
    mount(el, "a ->", { onReady });
    await until(() => onReady.mock.calls.length);
    expect(onReady).toHaveBeenCalledWith(undefined);
    expect(el.querySelector(".ene-error")).not.toBeNull();
  });
});

describe("render", () => {
  it("an aborted signal cancels the render", async () => {
    const el = document.createElement("div");
    const ac = new AbortController();
    const pending = render(el, BRANCH, { autoplay: false, signal: ac.signal });
    ac.abort();
    expect(await pending).toBeUndefined();
    expect(el.querySelector(".ene-player")).toBeNull();
  });

  it("an already aborted signal leaves the element and its current player alone", async () => {
    const el = document.createElement("div");
    const p = await render(el, BRANCH, { autoplay: false });
    const ac = new AbortController();
    ac.abort();
    expect(await render(el, "a ->", { signal: ac.signal })).toBeUndefined();
    expect(el.querySelector(".ene-player")).not.toBeNull();
    expect(el.querySelector(".ene-error")).toBeNull();
    expect(p!.choices).toEqual([]);
  });

  it("an include callback that aborts stops the render before it draws anything", async () => {
    const el = document.createElement("div");
    const ac = new AbortController();
    const include = () => {
      ac.abort();
      return { source: "api[API", file: "sys" };
    };
    expect(await render(el, "include ./sys.ene\nu -> api", { include, signal: ac.signal })).toBeUndefined();
    expect(el.querySelector(".ene-error")).toBeNull();
    expect(el.querySelector(".ene-player")).toBeNull();
  });

  it("the current player stays until the new render is ready; aborting the new one keeps it", async () => {
    const el = document.createElement("div");
    const p = await render(el, BRANCH, { autoplay: false });
    const ac = new AbortController();
    const pending = render(el, "a -> b : two", { signal: ac.signal });
    expect(el.querySelector(".ene-player")).not.toBeNull();
    ac.abort();
    expect(await pending).toBeUndefined();
    expect(el.textContent).toContain("fine");
    // Still the live player for this element: a later render replaces it
    const q = await render(el, "a -> b : three", { autoplay: false });
    expect(el.querySelectorAll(".ene-player").length).toBe(1);
    expect(el.textContent).toContain("three");
    p!.destroy();
    expect(el.querySelector(".ene-player")).not.toBeNull();
    q!.destroy();
  });

  it("destroying the old player while a new render runs does not cancel the new one", async () => {
    const el = document.createElement("div");
    const p = await render(el, BRANCH, { autoplay: false });
    const pending = render(el, "a -> b : two", { autoplay: false });
    p!.destroy();
    expect(await pending).toBeDefined();
    expect(el.textContent).toContain("two");
  });

  it("without a global ELK or setElkUrl, a flow diagram lays out with the elkjs package (npm installs)", async () => {
    const w = window as unknown as { ELK?: unknown };
    const saved = w.ELK;
    delete w.ELK;
    try {
      const el = document.createElement("div");
      const p = await render(el, "a -> b : go", { autoplay: false });
      expect(p).toBeDefined();
      expect(el.querySelector("script")).toBeNull();
      expect(document.head.querySelector('script[src*="ene-elk"]')).toBeNull();
    } finally {
      w.ELK = saved;
    }
  });
});
