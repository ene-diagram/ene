// @vitest-environment happy-dom
import { createElement, StrictMode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { installDom } from "../../player/test/dom-setup.js";
import { EneDiagram } from "../src/index.js";

installDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const BRANCH = "a -> b : go\nbranch ok\n  b --> a : fine\nelse fail\n  b -x a : broken\nend";
const until = async (fn: () => unknown) => {
  for (let i = 0; i < 200 && !fn(); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  expect(fn()).toBeTruthy();
};

describe("@ene-diagram/react", () => {
  it("renders a player in StrictMode (one player, source text hidden)", async () => {
    const el = document.createElement("div");
    document.body.append(el);
    const onReady = vi.fn();
    const root = createRoot(el);
    await act(() =>
      root.render(
        createElement(StrictMode, null, createElement(EneDiagram, { source: BRANCH, autoplay: false, onReady })),
      ),
    );
    await until(() => onReady.mock.calls.length);
    expect(el.querySelectorAll(".ene-player").length).toBe(1);
    expect(el.querySelector<HTMLPreElement>(".ene-source")!.hidden).toBe(true);
    await act(() => root.unmount());
    expect(el.querySelector(".ene-player")).toBeNull();
  });

  it("a new source renders again; new choices go to the same player", async () => {
    const el = document.createElement("div");
    const onReady = vi.fn();
    const root = createRoot(el);
    const draw = (source: string, choices?: number[]) =>
      act(() =>
        root.render(
          createElement(EneDiagram, { source, choices, autoplay: false, onReady, onChoicesChange: () => {} }),
        ),
      );
    await draw(BRANCH, [0]);
    await until(() => onReady.mock.calls.length === 1);
    const p = onReady.mock.calls[0][0];
    await draw(BRANCH, [1]);
    expect(p.choices).toEqual([1]);
    expect(onReady).toHaveBeenCalledTimes(1);
    await draw(`title Two\n${BRANCH}`, [1]);
    await until(() => onReady.mock.calls.length === 2);
    expect(el.textContent).toContain("Two");
    await act(() => root.unmount());
  });

  it("unmount while rendering leaves no player", async () => {
    const el = document.createElement("div");
    const onReady = vi.fn();
    const root = createRoot(el);
    await act(() => root.render(createElement(EneDiagram, { source: BRANCH, onReady })));
    await act(() => root.unmount());
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(onReady).not.toHaveBeenCalled();
    expect(el.querySelector(".ene-player")).toBeNull();
  });
});
