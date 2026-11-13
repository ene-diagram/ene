/** Built-in colour themes, set with `theme <name>` (or the renderers' `theme` option) */
export const THEMES = ["default", "mono", "high-contrast"] as const;
export type ThemeName = (typeof THEMES)[number];
export const isTheme = (s: string): s is ThemeName => (THEMES as readonly string[]).includes(s);
