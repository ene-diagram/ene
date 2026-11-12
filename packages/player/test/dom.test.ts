// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { autoRun, render } from "../src/player.js";
import { addPre, installDom } from "./dom-setup.js";

installDom();
const STEPS = "title Order\na[A] -> b[B] : one\nb -> c[C] : two\nc --> a : three";
const BRANCHY = "a -> b : start\nbranch hit\n  b --> a : cached\nelse miss\n  b -> db : read\n  db --> b : row\nend";
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const stepText = (root: ParentNode) => root.querySelector(".ene-step")!.textContent;

describe("player DOM", () => {
  it("autoRun replaces pre.ene with a player that has title, svg and controls", async () => {
    addPre(STEPS);
    const [p] = await autoRun("pre.ene", { autoplay: false, lang: "en" });
    expect(document.querySelector("pre.ene")).toBeNull();
    const root = document.querySelector(".ene-player")!;
    expect(root.getAttribute("aria-label")).toBe("Order");
    // happy-dom drops markup after <style> in svg.innerHTML, so check the title offset instead of the <text>
    expect(root.querySelector("svg > g")!.getAttribute("transform")).toBe("translate(0 44)");
    const labels = [...root.querySelectorAll(".ene-bar button")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Restart", "Previous step", "Play/Pause", "Next step"]);
    expect(root.querySelector('select[aria-label="Speed"]')).not.toBeNull();
    p.destroy();
  });

  it("Space toggles playback, arrows step and update the step text", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const p = (await render(el, STEPS, { autoplay: false, lang: "en" }))!;
    const root = el.querySelector(".ene-player")!;
    expect(stepText(root)).toBe("1/3 · a → b one");
    key(root, "ArrowRight");
    expect(stepText(root)).toBe("2/3 · b → c two");
    key(root, "ArrowRight");
    expect(stepText(root)).toBe("3/3 · c → a three");
    key(root, "ArrowLeft");
    expect(stepText(root)).toBe("2/3 · b → c two");
    const play = root.querySelectorAll(".ene-bar button")[2];
    expect(play.textContent).toBe("▶");
    key(root, " ");
    expect(p.controller.playing).toBe(true); expect(play.textContent).toBe("⏸");
    key(root, " ");
    expect(p.controller.playing).toBe(false); expect(play.textContent).toBe("▶");
    p.destroy();
  });

  it("buttons drive the controller", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const p = (await render(el, STEPS, { autoplay: false, lang: "en" }))!;
    const [restart, , , next] = [...el.querySelectorAll<HTMLButtonElement>(".ene-bar button")];
    next.click(); next.click();
    expect(p.controller.currentStep()).toBe(2);
    restart.click();
    expect(p.controller.time).toBe(0);
    const rate = el.querySelector<HTMLSelectElement>('select[aria-label="Speed"]')!;
    rate.value = "2"; rate.dispatchEvent(new Event("change"));
    expect(p.controller.rate).toBe(2);
    p.destroy();
  });

  it("branch select switches the played path", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const p = (await render(el, BRANCHY, { autoplay: false, lang: "en" }))!;
    const sel = el.querySelector<HTMLSelectElement>('select[aria-label="Branch 1"]')!;
    expect([...sel.options].map((o) => o.text)).toEqual(["hit", "miss"]);
    expect(p.controller.total).toBeGreaterThan(0);
    const hitTotal = p.controller.total;
    sel.value = "1"; sel.dispatchEvent(new Event("change"));
    expect(p.controller.total).toBeGreaterThan(hitTotal);
    p.setChoices([0]);
    expect(p.controller.total).toBe(hitTotal);
    p.destroy();
  });

  it("starts from given choices, reports menu changes, keeps the menu in sync and exports the chosen path", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const seen: number[][] = [];
    const p = (await render(el, BRANCHY, { autoplay: false, lang: "en", choices: [1], onChoicesChange: (c) => seen.push(c) }))!;
    const sel = el.querySelector<HTMLSelectElement>('select[aria-label="Branch 1"]')!;
    expect(sel.value).toBe("1");
    expect(p.choices).toEqual([1]);
    expect(p.toSvg()).toContain("3. row");
    sel.value = "0"; sel.dispatchEvent(new Event("change"));
    expect(seen).toEqual([[0]]);
    expect(p.toSvg()).not.toContain("row");
    p.setChoices([1]);
    expect(sel.value).toBe("1");
    expect(seen).toEqual([[0]]);
    p.setChoices([-3]);
    expect(p.choices).toEqual([0]);
    p.destroy();
  });

  it("shows a localized error box and returns undefined for invalid source", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    expect(await render(el, "a ->", { lang: "ko" })).toBeUndefined();
    const pre = el.querySelector("pre.ene-error")!;
    expect(pre.textContent).toContain("E103");
    expect(pre.textContent).toContain("화살표 뒤에 대상 노드가 없어요");
    expect(el.querySelector(".ene-player")).toBeNull();
  });

  it("uses Korean control labels with lang ko", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const p = (await render(el, BRANCHY, { autoplay: false, lang: "ko" }))!;
    expect(el.querySelector('button[aria-label="재생/정지"]')).not.toBeNull();
    expect(el.querySelector('select[aria-label="분기 1"]')).not.toBeNull();
    p.destroy();
  });
});
