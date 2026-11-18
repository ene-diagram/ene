<!--
  @component
  An ene player. On the server and before the player is ready it shows the source text in a `<pre class="ene-source">`.
  Changing `choices` picks other branch arms without rebuilding; without it, the viewer's picks are kept across source
  changes.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { mount, type Mounted, type MountOptions, type Player } from "@ene-diagram/player";

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, "onerror"> {
    /** The diagram text */
    source: string;
    lang?: MountOptions["lang"];
    autoplay?: boolean;
    loop?: boolean;
    focus?: MountOptions["focus"];
    theme?: MountOptions["theme"];
    choices?: number[];
    include?: MountOptions["include"];
    /** The player after each render (undefined when the source has errors) */
    onready?: (player: Player | undefined) => void;
    /** The viewer picked another branch arm */
    onchoiceschange?: (choices: number[]) => void;
    /** A render threw */
    onerror?: (error: unknown) => void;
  }

  let {
    source,
    lang,
    autoplay,
    loop,
    focus,
    theme,
    choices,
    include,
    onready,
    onchoiceschange,
    onerror,
    class: cls = "",
    ...rest
  }: Props = $props();

  let host: HTMLDivElement;
  let ready = $state(false);
  let mounted: Mounted | undefined;

  const options = (): MountOptions => ({
    lang,
    autoplay,
    loop,
    focus,
    theme,
    include,
    choices: choices ? [...choices] : undefined,
    onChoicesChange: (c) => onchoiceschange?.(c),
    onReady: (p) => {
      ready = true;
      onready?.(p);
    },
    onError: (e) => {
      ready = false;
      onerror?.(e);
    },
  });

  onMount(() => {
    mounted = mount(host, source, options());
    return () => {
      mounted?.destroy();
      mounted = undefined;
    };
  });

  $effect(() => {
    const opts = options();
    choices?.join(",");
    mounted?.update(source, opts);
  });
</script>

<div class={cls ? `ene-diagram ${cls}` : "ene-diagram"} {...rest}>
  <pre class="ene-source" hidden={ready}>{source}</pre>
  <div class="ene-host" bind:this={host}></div>
</div>
