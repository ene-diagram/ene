import { autoRun, render, registerIconPacks } from "./player.js";
import { createController } from "./controller.js";
export { render, autoRun, registerIconPacks, createController };
declare global { interface Window { eneConfig?: { startOnLoad?: boolean; lang?: "en" | "ko" } } }
if (typeof window !== "undefined" && window.eneConfig?.startOnLoad !== false) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void autoRun(undefined, { lang: window.eneConfig?.lang }));
  else void autoRun(undefined, { lang: window.eneConfig?.lang });
}
