// @vitest-environment happy-dom
import "@angular/compiler";
import { type ApplicationRef, createComponent, provideZonelessChangeDetection } from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import { describe, expect, it, vi } from "vitest";
import { installDom } from "../../player/test/dom-setup.js";
// The published build (partial compilation), made by global-setup.ts
import { EneDiagramComponent } from "../dist/fesm2022/ene-diagram-angular.mjs";

installDom();
const BRANCH = "a -> b : go\nbranch ok\n  b --> a : fine\nelse fail\n  b -x a : broken\nend";
const until = async (fn: () => unknown, app: ApplicationRef) => {
  for (let i = 0; i < 200 && !fn(); i++) {
    app.tick();
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(fn()).toBeTruthy();
};

describe("@ene-diagram/angular", () => {
  it("renders, follows inputs, emits outputs, and cleans up", async () => {
    const app = await createApplication({ providers: [provideZonelessChangeDetection()] });
    const hostElement = document.createElement("ene-diagram");
    document.body.append(hostElement);
    const ref = createComponent(EneDiagramComponent, { environmentInjector: app.injector, hostElement });
    const ready = vi.fn();
    const changed = vi.fn();
    ref.instance.ready.subscribe(ready);
    ref.instance.choicesChange.subscribe(changed);
    ref.setInput("source", BRANCH);
    ref.setInput("autoplay", "false");
    ref.setInput("choices", [0]);
    app.attachView(ref.hostView);
    app.tick();
    await until(() => ready.mock.calls.length === 1, app);
    app.tick();
    expect(hostElement.classList.contains("ene-diagram")).toBe(true);
    expect(hostElement.querySelector<HTMLPreElement>(".ene-source")!.hidden).toBe(true);
    const p = ready.mock.calls[0][0];
    expect(p.controller.playing).toBe(false);
    ref.setInput("choices", [1]);
    app.tick();
    expect(p.choices).toEqual([1]);
    const sel = hostElement.querySelector<HTMLSelectElement>('.ene-bar select[aria-label^="Branch"]')!;
    sel.value = "0";
    sel.dispatchEvent(new Event("change"));
    expect(changed).toHaveBeenCalledWith([0]);
    ref.setInput("source", `title Two\n${BRANCH}`);
    app.tick();
    await until(() => ready.mock.calls.length === 2, app);
    expect(hostElement.textContent).toContain("Two");
    ref.destroy();
    expect(hostElement.querySelector(".ene-player")).toBeNull();
    app.destroy();
  });
});
