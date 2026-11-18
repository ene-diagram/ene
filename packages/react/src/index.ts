"use client";
import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { mount, type Mounted, type MountOptions } from "@ene-diagram/player";

export type { Player } from "@ene-diagram/player";

export interface EneDiagramProps extends MountOptions {
  /** The diagram text */
  source: string;
  className?: string;
  style?: CSSProperties;
  /** Accessible name of the wrapper (the player also labels itself with the diagram's title) */
  "aria-label"?: string;
}

/**
 * An ene player. On the server and before the player is ready it shows the source text in a `<pre class="ene-source">`.
 *
 * Changing `source` or a render option (lang, autoplay, loop, focus, theme, include) renders again; changing `choices`
 * picks other branch arms without rebuilding. Without `choices`, the viewer's picks are kept across source changes.
 */
export function EneDiagram(props: EneDiagramProps): ReactElement {
  const { source, className, style } = props;
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<Mounted | undefined>(undefined);
  const [ready, setReady] = useState(false);
  // Committed props for the callbacks (updated in the effect below, not during render), so a new handler never
  // rebuilds the player and an abandoned render never receives events
  const latest = useRef(props);

  const options = (p: EneDiagramProps): MountOptions => ({
    lang: p.lang,
    autoplay: p.autoplay,
    loop: p.loop,
    focus: p.focus,
    theme: p.theme,
    include: p.include,
    choices: p.choices,
    onChoicesChange: (c) => latest.current.onChoicesChange?.(c),
    onReady: (player) => {
      setReady(true);
      latest.current.onReady?.(player);
    },
    onError: (e) => {
      setReady(false);
      latest.current.onError?.(e);
    },
  });

  // Mount once; later prop changes go through update below (StrictMode's extra mount/unmount is handled by mount)
  // biome-ignore lint/correctness/useExhaustiveDependencies: options and source are read from `latest` on purpose
  useEffect(() => {
    const m = mount(host.current!, latest.current.source, options(latest.current));
    mounted.current = m;
    return () => {
      m.destroy();
      mounted.current = undefined;
    };
  }, []);

  useEffect(() => {
    latest.current = props;
    mounted.current?.update(props.source, options(props));
  });

  return createElement(
    "div",
    { className: className ? `ene-diagram ${className}` : "ene-diagram", style, "aria-label": props["aria-label"] },
    createElement("pre", { className: "ene-source", hidden: ready }, source),
    createElement("div", { className: "ene-host", ref: host }),
  );
}

export default EneDiagram;
