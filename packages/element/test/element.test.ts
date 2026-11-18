// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { installDom } from "../../player/test/dom-setup.js";
import { defineEneDiagram } from "../src/index.js";

installDom();
const BRANCH = "a -> b : go\nbranch ok\n  b --> a : fine\nelse fail\n  b -x a : broken\nend";
const until = async (fn: () => unknown) => {
  for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(fn()).toBeTruthy();
};

describe("<ene-diagram>", () => {
  it("reads its text, renders, and reacts to attributes", async () => {
    const el = document.createElement("ene-diagram");
    el.setAttribute("autoplay", "false");
    el.setAttribute("choices", "0");
    el.textContent = BRANCH;
    const ready = vi.fn();
    el.addEventListener("ready", ready);
    document.body.append(el);
    await until(() => ready.mock.calls.length === 1);
    expect(el.querySelector<HTMLPreElement>(".ene-source")!.hidden).toBe(true);
    expect(el.player).toBeDefined();
    expect(el.player!.controller.playing).toBe(false);
    const p = el.player!;
    el.setAttribute("choices", "1");
    expect(p.choices).toEqual([1]);
    el.source = `title Two\n${BRANCH}`;
    await until(() => ready.mock.calls.length === 2);
    expect(el.textContent).toContain("Two");
  });

  it("moving it keeps the player; removing it destroys the player", async () => {
    const el = document.createElement("ene-diagram");
    el.source = "a -> b : go";
    const ready = vi.fn();
    el.addEventListener("ready", ready);
    document.body.append(el);
    await until(() => ready.mock.calls.length === 1);
    const p = el.player;
    const other = document.createElement("section");
    document.body.append(other);
    other.append(el);
    await new Promise((r) => setTimeout(r, 0));
    expect(el.player).toBe(p);
    el.remove();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.player).toBeUndefined();
    expect(el.querySelector(".ene-player")).toBeNull();
    // Reconnecting renders again from the same source
    document.body.append(el);
    await until(() => ready.mock.calls.length === 2);
  });

  it("choiceschange is dispatched when the viewer picks an arm", async () => {
    const el = document.createElement("ene-diagram");
    el.setAttribute("autoplay", "false");
    el.source = BRANCH;
    const ready = vi.fn();
    const changed = vi.fn();
    el.addEventListener("ready", ready);
    el.addEventListener("choiceschange", (e) => changed((e as CustomEvent).detail));
    document.body.append(el);
    await until(() => ready.mock.calls.length === 1);
    const sel = el.querySelector<HTMLSelectElement>('.ene-bar select[aria-label^="Branch"]')!;
    sel.value = "1";
    sel.dispatchEvent(new Event("change"));
    expect(changed).toHaveBeenCalledWith([1]);
  });

  it("a source and include set before the element is registered are used after it upgrades", async () => {
    const el = document.createElement("ene-late") as HTMLElement & {
      source: string;
      include: unknown;
      player?: unknown;
    };
    el.source = "include ./sys.ene\nu -> api : go";
    el.include = (p: string) => (p === "./sys.ene" ? { source: "api[Late API]", file: "sys" } : { error: "no" });
    const ready = vi.fn();
    el.addEventListener("ready", ready);
    document.body.append(el);
    defineEneDiagram("ene-late");
    await until(() => ready.mock.calls.length === 1);
    expect(el.textContent).toContain("Late API");
    el.source = "a -> b : later";
    await until(() => ready.mock.calls.length === 2);
    expect(el.textContent).toContain("later");
  });
});
