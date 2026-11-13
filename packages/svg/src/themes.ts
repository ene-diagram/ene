import { THEMES, type ThemeName } from "@ene-diagram/core";

/** The CSS variables every ene SVG is drawn with. A host page can override them (see README) */
export interface ThemeVars {
  bg: string;
  node: string;
  line: string;
  faint: string;
  fg: string;
  fg2: string;
  ok: string;
  fail: string;
  reply: string;
  async: string;
}

export const THEME_VARS: Record<ThemeName, { light: ThemeVars; dark: ThemeVars }> = {
  default: {
    light: {
      bg: "#fbfcfd",
      node: "#fff",
      line: "#c1c8d2",
      faint: "#d9dde3",
      fg: "#1c2024",
      fg2: "#3a4048",
      ok: "#3e63dd",
      fail: "#e5484d",
      reply: "#30a46c",
      async: "#8e4ec6",
    },
    dark: {
      bg: "#111113",
      node: "#1c1d21",
      line: "#3b3e45",
      faint: "#2e3036",
      fg: "#edeef0",
      fg2: "#b0b4ba",
      ok: "#7b9bff",
      fail: "#ff6369",
      reply: "#4cc38a",
      async: "#bf7af0",
    },
  },
  // Greys only, for print and documents; failure stays recognisable by its ✕ and the dot stopping halfway
  mono: {
    light: {
      bg: "#ffffff",
      node: "#ffffff",
      line: "#6f6f6f",
      faint: "#c8c8c8",
      fg: "#111111",
      fg2: "#333333",
      ok: "#111111",
      fail: "#111111",
      reply: "#6f6f6f",
      async: "#333333",
    },
    dark: {
      bg: "#111111",
      node: "#1a1a1a",
      line: "#9a9a9a",
      faint: "#3d3d3d",
      fg: "#f2f2f2",
      fg2: "#d0d0d0",
      ok: "#f2f2f2",
      fail: "#f2f2f2",
      reply: "#a8a8a8",
      async: "#d0d0d0",
    },
  },
  // Black/white surfaces; colours and idle edges reach WCAG AAA (at least 7:1) against the background
  "high-contrast": {
    light: {
      bg: "#ffffff",
      node: "#ffffff",
      line: "#000000",
      faint: "#595959",
      fg: "#000000",
      fg2: "#000000",
      ok: "#0033cc",
      fail: "#b00000",
      reply: "#005c1f",
      async: "#5b00b3",
    },
    dark: {
      bg: "#000000",
      node: "#000000",
      line: "#ffffff",
      faint: "#a6a6a6",
      fg: "#ffffff",
      fg2: "#ffffff",
      ok: "#9cb8ff",
      fail: "#ff9c9c",
      reply: "#7ee2a0",
      async: "#d9a6ff",
    },
  },
};

const vars = (v: ThemeVars) =>
  Object.entries(v)
    .map(([k, c]) => `--${k}:${c}`)
    .join(";");

/** Theme class on the root <svg> */
export const themeClass = (name: ThemeName = "default") => `ene-theme-${name}`;

/**
 * Variable rules for one theme: light, and dark under `prefers-color-scheme: dark`.
 * `standalone` (an exported SVG file) uses `svg.ene-theme-<name>`: a plain type+class selector every SVG renderer
 * understands, scoped so several exports pasted inline into one page keep their own palettes.
 * Inline (the player, possibly several themes on one page) scopes the rule to the theme class with
 * zero specificity, so any host-page rule that sets the variables wins.
 */
export function themeCss(name: ThemeName = "default", standalone = false): string {
  const t = THEME_VARS[name] ?? THEME_VARS.default,
    sel = standalone ? `svg.${themeClass(name)}` : `:where(svg.${themeClass(name)})`;
  return `${sel}{${vars(t.light)}}@media (prefers-color-scheme: dark){${sel}{${vars(t.dark)}}}`;
}

export { THEMES, type ThemeName };
