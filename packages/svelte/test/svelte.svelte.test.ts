// @vitest-environment happy-dom
import { flushSync, mount as mountSvelte, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";
import { installDom } from "../../player/test/dom-setup.js";
import { EneDiagram } from "../src/index.js";

installDom();
const BRANCH = "a -> b : go\nbranch ok\n  b --> a : fine\nelse fail\n  b -x a : broken\nend";
const until = async (fn: () => unknown) => {
  for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(fn()).toBeTruthy();
};

describe("@ene-diagram/svelte", () => {
  it("renders, follows prop changes, and cleans up", async () => {
    const onready = vi.fn();
    const props = $state({ source: BRANCH, choices: [0], autoplay: false, onready, class: "mine" });
    const el = document.createElement("div");
    const c = mountSvelte(EneDiagram, { target: el, props });
    flushSync();
    await until(() => onready.mock.calls.length === 1);
    expect(el.querySelector(".ene-diagram.mine")).not.toBeNull();
    expect(el.querySelector<HTMLPreElement>(".ene-source")!.hidden).toBe(true);
    const p = onready.mock.calls[0][0];
    props.choices = [1];
    flushSync();
    expect(p.choices).toEqual([1]);
    props.source = `title Two\n${BRANCH}`;
    flushSync();
    await until(() => onready.mock.calls.length === 2);
    expect(el.textContent).toContain("Two");
    unmount(c);
    expect(el.querySelector(".ene-player")).toBeNull();
  });
});
