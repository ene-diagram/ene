# @ene-diagram/layout

## 0.2.0

### Minor Changes

- [#108](https://github.com/ene-diagram/ene/pull/108) [`5bb1b51`](https://github.com/ene-diagram/ene/commit/5bb1b51b324672a590598f5e74861899ad3cde53) Thanks [@HelloWook](https://github.com/HelloWook)! - Sequence diagrams draw activation bars: a participant is marked busy from each request (`->`) until it answers the caller (`-->` or `-x`), appearing when the request arrives. No new syntax; requests that are never answered get no bar. `Layout.activations` is new.

### Patch Changes

- Updated dependencies [[`45f4df8`](https://github.com/ene-diagram/ene/commit/45f4df8d81e55a5602b97f1f089b825c5c34c5bc), [`835c6a8`](https://github.com/ene-diagram/ene/commit/835c6a8284df3750f341c56685028657f4455aaa)]:
  - @ene-diagram/core@0.2.0
