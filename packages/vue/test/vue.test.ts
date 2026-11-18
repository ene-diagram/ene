// @vitest-environment happy-dom
import { createApp, createSSRApp, h, nextTick, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";
import { installDom } from "../../player/test/dom-setup.js";
import { EneDiagram } from "../src/index.js";

installDom();
const BRANCH = "a -> b : go\nbranch ok\n  b --> a : fine\nelse fail\n  b -x a : broken\nend";
const until = async (fn: () => unknown) => {
  for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(fn()).toBeTruthy();
};

describe("@ene-diagram/vue", () => {
  it("renders, follows prop changes, and cleans up", async () => {
    const source = ref(BRANCH);
    const choices = ref([0]);
    const onReady = vi.fn();
    const onChoices = vi.fn();
    const el = document.createElement("div");
    const app = createApp({
      render: () =>
        h(EneDiagram, {
          source: source.value,
          choices: choices.value,
          autoplay: false,
          onReady,
          onChoicesChange: onChoices,
        }),
    });
    app.mount(el);
    await until(() => onReady.mock.calls.length === 1);
    expect(el.querySelector<HTMLPreElement>(".ene-source")!.hidden).toBe(true);
    const p = onReady.mock.calls[0][0];
    choices.value = [1];
    await nextTick();
    expect(p.choices).toEqual([1]);
    // An in-place edit is seen too
    choices.value.splice(0, 1, 0);
    await nextTick();
    expect(p.choices).toEqual([0]);
    source.value = `title Two\n${BRANCH}`;
    await nextTick();
    await until(() => onReady.mock.calls.length === 2);
    expect(el.textContent).toContain("Two");
    const sel = el.querySelector<HTMLSelectElement>('.ene-bar select[aria-label^="Branch"]')!;
    sel.value = "1";
    sel.dispatchEvent(new Event("change"));
    expect(onChoices).toHaveBeenCalledWith([1]);
    app.unmount();
    expect(el.querySelector(".ene-player")).toBeNull();
  });

  it("autoplay and loop default to on, like the player", () => {
    const props = EneDiagram.props as Record<string, { default?: unknown }>;
    expect(props.autoplay.default).toBe(true);
    expect(props.loop.default).toBe(true);
  });

  it("server rendering shows the source text", async () => {
    const html = await renderToString(createSSRApp({ render: () => h(EneDiagram, { source: "a -> b : <hi>" }) }));
    expect(html).toContain('<pre class="ene-source">a -&gt; b : &lt;hi&gt;</pre>');
  });
});
