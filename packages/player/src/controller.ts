import type { Timeline } from "@ene-diagram/core";

export interface ControllerOptions { loop?: boolean; hold?: number }

export interface Controller {
  time: number;
  rate: number;
  playing: boolean;
  readonly total: number;
  play(): void;
  pause(): void;
  toggle(): void;
  restart(): void;
  setRate(r: number): void;
  /** Advance by dt seconds (only while playing, scaled by rate) */
  tick(dt: number): void;
  next(): void;
  prev(): void;
  /** Last step started at time (-1 if there are no steps) */
  currentStep(): number;
}

export function createController(tl: Timeline, opts: ControllerOptions = {}): Controller {
  const loop = opts.loop ?? true, hold = opts.hold ?? 1.5;
  const starts = tl.steps.map((s) => s.start);
  const c: Controller = {
    time: 0,
    rate: 1,
    playing: false,
    total: tl.total,
    play() { if (!loop && c.time >= tl.total) c.time = 0; c.playing = true; },
    pause() { c.playing = false; },
    toggle() { c.playing ? c.pause() : c.play(); },
    restart() { c.time = 0; },
    setRate(r) { c.rate = r; },
    tick(dt) {
      if (!c.playing) return;
      c.time += dt * c.rate;
      if (loop) {
        const cycle = tl.total + hold;
        if (c.time >= cycle) c.time = cycle > 0 ? c.time % cycle : 0;
      } else if (c.time >= tl.total) {
        c.time = tl.total;
        c.playing = false;
      }
    },
    next() { c.time = starts.find((s) => s > c.time + 1e-9) ?? tl.total; },
    prev() {
      const i = c.currentStep();
      if (i < 0) return void (c.time = 0);
      const cur = c.time >= tl.total ? tl.total : starts[i];
      // If slightly past the current step's start, go to its start; otherwise go to the previous step
      if (c.time - cur > 0.3) c.time = cur;
      else c.time = starts.filter((s) => s < cur - 1e-9).pop() ?? 0;
    },
    currentStep() {
      let i = -1;
      starts.forEach((s, k) => { if (s <= c.time + 1e-9) i = k; });
      return i;
    },
  };
  return c;
}
