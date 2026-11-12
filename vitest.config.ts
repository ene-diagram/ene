import { defineConfig } from "vitest/config";
const src = (p: string) => new URL(`./packages/${p}/src/index.ts`, import.meta.url).pathname;
export default defineConfig({
  resolve: { alias: { "@ene/core": src("core"), "@ene/layout": src("layout"), "@ene/svg": src("svg"), "@ene/player": src("player"), "@ene/video": src("video") } },
  test: { include: ["packages/*/test/**/*.test.ts"], globals: true },
});
