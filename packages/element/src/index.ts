import { mount, type Mounted, type MountOptions, type Player } from "@ene-diagram/player";

type Includer = NonNullable<MountOptions["include"]>;

export type { Player } from "@ene-diagram/player";

/** Events: `ready` (detail: the player, or undefined when the source has errors), `choiceschange`, `error` */
export interface EneDiagramEventMap {
  ready: CustomEvent<Player | undefined>;
  choiceschange: CustomEvent<number[]>;
  error: CustomEvent<unknown>;
}

const ATTRS = ["source", "lang", "autoplay", "loop", "focus", "theme", "choices"] as const;
// The class must exist on a server (SSR imports it) where there is no HTMLElement
const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

/** `autoplay` and `loop` are on unless the attribute is "false" */
const flag = (v: string | null) => v === null || v !== "false";
const parseChoices = (v: string | null) =>
  v === null || v.trim() === ""
    ? undefined
    : v
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isInteger(n) && n >= 0);

/**
 * `<ene-diagram>`: an ene player. The diagram is the `source` attribute or property, else the element's text when it
 * is first connected (so `<ene-diagram>a -> b</ene-diagram>` works and stays readable without JavaScript). Later text
 * edits are not watched; set `source` instead.
 *
 * Attributes: `source`, `lang` (en|ko), `autoplay` and `loop` (on; set to "false" to turn off), `focus`
 * (true|false|auto), `theme`, `choices` ("0,1"). Property only: `include`.
 */
export class EneDiagramElement extends Base {
  static observedAttributes = [...ATTRS];
  #source: string | undefined;
  #include: Includer | undefined;
  #mounted: Mounted | undefined;
  #fallback: HTMLPreElement | undefined;
  #host: HTMLDivElement | undefined;
  #pendingDisconnect = false;

  /** The diagram text */
  get source(): string {
    return this.getAttribute("source") ?? this.#source ?? "";
  }
  set source(v: string) {
    this.#source = v;
    if (this.hasAttribute("source")) this.setAttribute("source", v);
    else this.#sync();
  }
  /** Supplies `include`d files (see `PlayerOptions.include`) */
  get include(): Includer | undefined {
    return this.#include;
  }
  set include(v: Includer | undefined) {
    this.#include = v;
    this.#sync();
  }
  /** The current player, once rendered */
  get player(): Player | undefined {
    return this.#mounted?.player;
  }

  connectedCallback() {
    // A value set on the element before this class was registered is an own property that hides the setter: move it
    // through the setter
    for (const key of ["source", "include"] as const)
      if (Object.hasOwn(this, key)) {
        const v = (this as Record<string, unknown>)[key];
        delete (this as Record<string, unknown>)[key];
        (this as Record<string, unknown>)[key] = v;
      }
    if (this.#pendingDisconnect) {
      // Moved within the document: keep the player
      this.#pendingDisconnect = false;
      return;
    }
    if (
      !this.#host &&
      this.#source === undefined &&
      !this.hasAttribute("source") &&
      !this.textContent?.trim() &&
      document.readyState === "loading"
    ) {
      // Upgraded while the parser is still adding the text inside the tag: read it once the document is parsed
      document.addEventListener(
        "DOMContentLoaded",
        () => this.isConnected && !this.#mounted && this.connectedCallback(),
        {
          once: true,
        },
      );
      return;
    }
    if (!this.#host) {
      this.#source ??= this.textContent?.replace(/^\n/, "") ?? "";
      this.#fallback = document.createElement("pre");
      this.#fallback.className = "ene-source";
      this.#host = document.createElement("div");
      this.#host.className = "ene-host";
      this.replaceChildren(this.#fallback, this.#host);
    }
    this.#fallback!.textContent = this.source;
    this.#fallback!.hidden = false;
    this.#mounted = mount(this.#host!, this.source, this.#options());
  }

  disconnectedCallback() {
    // A move is a disconnect followed by a connect in the same task; only destroy when it stays disconnected
    this.#pendingDisconnect = true;
    queueMicrotask(() => {
      if (!this.#pendingDisconnect) return;
      this.#pendingDisconnect = false;
      this.#mounted?.destroy();
      this.#mounted = undefined;
    });
  }

  attributeChangedCallback() {
    this.#sync();
  }

  #sync() {
    if (!this.#mounted) return;
    if (this.#fallback) this.#fallback.textContent = this.source;
    this.#mounted.update(this.source, this.#options());
  }

  #options(): MountOptions {
    const focus = this.getAttribute("focus");
    const lang = this.getAttribute("lang");
    return {
      lang: lang === "ko" || lang === "en" ? lang : undefined,
      autoplay: flag(this.getAttribute("autoplay")),
      loop: flag(this.getAttribute("loop")),
      focus: focus === null || focus === "auto" ? "auto" : focus !== "false",
      theme: (this.getAttribute("theme") ?? undefined) as MountOptions["theme"],
      choices: parseChoices(this.getAttribute("choices")),
      include: this.#include,
      onReady: (p) => {
        if (this.#fallback) this.#fallback.hidden = true;
        this.dispatchEvent(new CustomEvent("ready", { detail: p }));
      },
      onChoicesChange: (c) => this.dispatchEvent(new CustomEvent("choiceschange", { detail: c })),
      onError: (e) => {
        if (this.#fallback) this.#fallback.hidden = false;
        this.dispatchEvent(new CustomEvent("error", { detail: e }));
      },
    };
  }
}

/** Register the element (done on import as `ene-diagram`); call it yourself for another tag name */
export function defineEneDiagram(tag = "ene-diagram"): void {
  if (typeof customElements === "undefined" || customElements.get(tag)) return;
  // A tag needs its own class: one constructor cannot be registered twice
  customElements.define(tag, tag === "ene-diagram" ? EneDiagramElement : class extends EneDiagramElement {});
}

defineEneDiagram();

declare global {
  interface HTMLElementTagNameMap {
    "ene-diagram": EneDiagramElement;
  }
}
