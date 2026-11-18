# @ene-diagram/element

## 0.2.0

### Minor Changes

- [#110](https://github.com/ene-diagram/ene/pull/110) [`7e70c4b`](https://github.com/ene-diagram/ene/commit/7e70c4b722f4bba9b65984a8ec2eab99634d172a) Thanks [@HelloWook](https://github.com/HelloWook)! - New framework packages: `@ene-diagram/react`, `@ene-diagram/vue`, `@ene-diagram/svelte`, `@ene-diagram/solid` (1.8+ and 2.x), `@ene-diagram/angular` (standalone, 17+) and the Web Component `@ene-diagram/element` (`<ene-diagram>`). They show the source text on the server and until the player is ready, keep the viewer's branch picks when the source changes, and apply a changed `choices` without rebuilding. The player gains `mount(el, source, opts)` (the shared lifecycle these use: latest render wins, `destroy` cancels one in progress) and a `signal` option on `render`. Fix: installed from npm, the player no longer looks for `ene-elk.js` next to the page; flow diagrams take ELK from the `elkjs` package through the bundler. The `<script>` bundle still loads `ene-elk.js` (the configured URL, else next to `ene.js`).

### Patch Changes

- Updated dependencies [[`7e70c4b`](https://github.com/ene-diagram/ene/commit/7e70c4b722f4bba9b65984a8ec2eab99634d172a), [`45f4df8`](https://github.com/ene-diagram/ene/commit/45f4df8d81e55a5602b97f1f089b825c5c34c5bc), [`5bb1b51`](https://github.com/ene-diagram/ene/commit/5bb1b51b324672a590598f5e74861899ad3cde53), [`835c6a8`](https://github.com/ene-diagram/ene/commit/835c6a8284df3750f341c56685028657f4455aaa)]:
  - @ene-diagram/player@0.2.0
