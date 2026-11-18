import { mount, type Mounted, type MountOptions, type Player } from "@ene-diagram/player";

export interface EneDiagramProps extends MountOptions {
  /** The diagram text */
  source: string;
  class?: string;
}

/** The parts of `solid-js` this component uses; 1.x and 2.x differ in how effects and mount hooks are spelled */
export interface SolidApi {
  createEffect: (...args: never[]) => unknown;
  onCleanup: (fn: () => void) => unknown;
  onMount?: (fn: () => void) => void;
  onSettled?: (fn: () => void) => void;
}

/** Builds the component for one copy of solid-js (exported for tests, which run it against 1.x and 2.x) */
export function createEneDiagram(solid: SolidApi) {
  const effect = solid.createEffect as unknown as (...args: unknown[]) => void;
  // 2.x splits an effect into a tracked read and a side effect; 1.x runs one tracked function
  const watch = <T>(read: () => T, run: (v: T) => void) =>
    solid.onSettled ? effect(read, run) : effect(() => run(read()));
  const onMounted = (fn: () => void) => (solid.onSettled ?? solid.onMount)!(fn);

  return function EneDiagram(props: EneDiagramProps): Node | string {
    // On the server there is no DOM; the text is rendered (escaped) instead. Use clientOnly() in SolidStart
    if (typeof document === "undefined") return props.source;
    const root = document.createElement("div");
    const fallback = document.createElement("pre");
    fallback.className = "ene-source";
    const host = document.createElement("div");
    host.className = "ene-host";
    root.append(fallback, host);
    let mounted: Mounted | undefined;

    const options = (): MountOptions => ({
      lang: props.lang,
      autoplay: props.autoplay,
      loop: props.loop,
      focus: props.focus,
      theme: props.theme,
      include: props.include,
      choices: props.choices ? [...props.choices] : undefined,
      onChoicesChange: (c) => props.onChoicesChange?.(c),
      onReady: (p: Player | undefined) => {
        fallback.hidden = true;
        props.onReady?.(p);
      },
      onError: (e) => {
        fallback.hidden = false;
        props.onError?.(e);
      },
    });

    watch(
      () => ({ source: props.source, cls: props.class, opts: options(), key: props.choices?.join(",") }),
      ({ source, cls, opts }) => {
        root.className = cls ? `ene-diagram ${cls}` : "ene-diagram";
        fallback.textContent = source;
        mounted?.update(source, opts);
      },
    );
    onMounted(() => {
      mounted = mount(host, props.source, options());
    });
    solid.onCleanup(() => {
      mounted?.destroy();
      mounted = undefined;
    });
    return root;
  };
}
