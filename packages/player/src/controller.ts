import type { Timeline } from "@ene/core";

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
  /** dt 초만큼 진행 (재생 중일 때만, rate 배) */
  tick(dt: number): void;
  next(): void;
  prev(): void;
  /** time 시점에 시작된 마지막 단계 (단계가 없으면 -1) */
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
      // 현재 단계 시작에서 조금 지났으면 그 단계 처음으로, 아니면 이전 단계로
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
