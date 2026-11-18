import { render, type Player, type PlayerOptions } from "./player.js";

/** Options for `mount`: the player options without `signal` (mount owns it), plus lifecycle callbacks */
export interface MountOptions extends Omit<PlayerOptions, "signal"> {
  /**
   * Called each time a render finishes: with the player, or undefined when the source has errors (the diagnostics are
   * shown in the element instead). Not called for renders that were superseded or cancelled
   */
  onReady?: (player: Player | undefined) => void;
  /** Called when a render throws (for example a failed icon pack); the element is left empty */
  onError?: (error: unknown) => void;
}

/** A player kept in sync with changing props, for framework components */
export interface Mounted {
  /**
   * The player on screen: while a new render runs it is still the previous one. Undefined before the first render
   * finishes, after an error, or when the source has errors
   */
  readonly player: Player | undefined;
  /**
   * Apply new props. A changed source or a changed render option (lang, autoplay, loop, focus, theme, include) renders
   * again; changed choices alone go to `setChoices`; changed callbacks are just remembered
   */
  update(source: string, opts?: MountOptions): void;
  /** Destroy the player and cancel a render in progress. Later calls to `update` do nothing */
  destroy(): void;
}

const RENDER_KEYS = ["lang", "autoplay", "loop", "focus", "theme", "include"] as const;
const sameChoices = (a: readonly number[] | undefined, b: readonly number[] | undefined) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));

/**
 * Render `source` into `el` and keep it in sync with later `update` calls. This is what the framework packages
 * (`@ene-diagram/react`, `vue`, `svelte`, `solid`, `angular`, `element`) use, so they behave the same:
 *
 * - only the latest render may touch `el`; `destroy` cancels one in progress
 * - without a `choices` option, the viewer's branch picks are kept when the source changes
 * - with one, a changed `choices` value is applied to the player without rebuilding it
 *
 * `el` should be an element only the player writes to: rendering replaces its children.
 */
export function mount(el: HTMLElement, source: string, opts: MountOptions = {}): Mounted {
  let cur = { source, opts };
  let player: Player | undefined;
  let ctrl: AbortController | undefined;
  let gen = 0;
  let dead = false;
  // A render is in progress (the player shown, if any, is the previous one)
  let pending = false;
  // The viewer's picks, kept across re-renders when the choices are not controlled
  let picked: number[] | undefined;

  const go = () => {
    ctrl?.abort();
    const mine = new AbortController();
    ctrl = mine;
    const n = ++gen;
    const o = cur.opts;
    const choices = o.choices ?? picked ?? player?.choices;
    // The current player keeps showing until the new one replaces it (render does the swap)
    pending = true;
    const done = (fn: () => void) => {
      if (dead || n !== gen || mine.signal.aborted) return false;
      fn();
      return true;
    };
    render(el, cur.source, {
      ...o,
      choices,
      signal: mine.signal,
      // Read the latest callback at call time so a changed handler does not need a new player
      onChoicesChange: (c) => {
        picked = c;
        cur.opts.onChoicesChange?.(c);
      },
    }).then(
      (p) => {
        if (
          !done(() => {
            pending = false;
            player = p;
            // The viewer may have picked an arm on the previous player while this one was being built
            if (p && cur.opts.choices === undefined && picked && !sameChoices(picked, p.choices)) p.setChoices(picked);
          })
        ) {
          // Finished after it was superseded or destroyed: never leave a live player behind
          if (p && p !== player) p.destroy();
          return;
        }
        cur.opts.onReady?.(p);
      },
      (e) =>
        done(() => {
          pending = false;
          // The previous player belongs to the old props: do not leave it playing next to the error
          player?.destroy();
          player = undefined;
          el.replaceChildren();
          cur.opts.onError?.(e);
        }),
    );
  };

  go();
  return {
    get player() {
      return player;
    },
    update(source, next = {}) {
      if (dead) return;
      const prev = cur;
      cur = { source, opts: next };
      if (source !== prev.source || RENDER_KEYS.some((k) => next[k] !== prev.opts[k])) {
        if (source !== prev.source && next.choices === undefined) picked = player?.choices ?? picked;
        go();
        return;
      }
      if (next.choices !== undefined && !sameChoices(next.choices, prev.opts.choices)) {
        picked = undefined;
        // Applied now if the player exists; a render in progress reads cur.opts.choices when it starts, so restart it
        if (player && !pending) {
          if (!sameChoices(next.choices, player.choices)) player.setChoices(next.choices);
        } else go();
      }
    },
    destroy() {
      if (dead) return;
      dead = true;
      ctrl?.abort();
      player?.destroy();
      player = undefined;
    },
  };
}
