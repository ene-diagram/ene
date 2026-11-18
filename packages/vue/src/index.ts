import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from "vue";
import { mount, type Mounted, type MountOptions, type Player } from "@ene-diagram/player";

export type { Player } from "@ene-diagram/player";

/**
 * `<EneDiagram :source="text" />`: an ene player. On the server and before the player is ready it shows the source
 * text in a `<pre class="ene-source">`.
 *
 * Events: `ready` (the player, or undefined when the source has errors), `choicesChange` (`@choices-change`), `error`.
 * Changing `choices` picks other branch arms without rebuilding; without it, the viewer's picks are kept across source
 * changes.
 */
export const EneDiagram = defineComponent({
  name: "EneDiagram",
  props: {
    source: { type: String, required: true },
    lang: { type: String as PropType<MountOptions["lang"]>, default: undefined },
    autoplay: { type: Boolean, default: true },
    loop: { type: Boolean, default: true },
    focus: { type: [Boolean, String] as PropType<MountOptions["focus"]>, default: "auto" },
    theme: { type: String as PropType<MountOptions["theme"]>, default: undefined },
    choices: { type: Array as PropType<number[]>, default: undefined },
    include: { type: Function as PropType<MountOptions["include"]>, default: undefined },
  },
  emits: {
    ready: (_player: Player | undefined) => true,
    choicesChange: (_choices: number[]) => true,
    error: (_error: unknown) => true,
  },
  setup(props, { emit }) {
    const host = ref<HTMLDivElement>();
    const ready = ref(false);
    let mounted: Mounted | undefined;
    const options = (): MountOptions => ({
      lang: props.lang,
      autoplay: props.autoplay,
      loop: props.loop,
      focus: props.focus,
      theme: props.theme,
      include: props.include,
      // A copy, so a parent that edits its array in place is still seen as a change
      choices: props.choices ? [...props.choices] : undefined,
      onChoicesChange: (c) => emit("choicesChange", c),
      onReady: (p) => {
        ready.value = true;
        emit("ready", p);
      },
      onError: (e) => {
        ready.value = false;
        emit("error", e);
      },
    });
    onMounted(() => {
      mounted = mount(host.value!, props.source, options());
    });
    watch(
      () => [
        props.source,
        props.lang,
        props.autoplay,
        props.loop,
        props.focus,
        props.theme,
        props.include,
        props.choices?.join(","),
      ],
      () => mounted?.update(props.source, options()),
    );
    onBeforeUnmount(() => {
      mounted?.destroy();
      mounted = undefined;
    });
    return () =>
      h("div", { class: "ene-diagram" }, [
        h("pre", { class: "ene-source", hidden: ready.value }, props.source),
        h("div", { class: "ene-host", ref: host }),
      ]);
  },
});

export default EneDiagram;
