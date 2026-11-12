import { parse, buildTimeline } from "@ene-diagram/core";
import { createController } from "../src/controller";
const tl = buildTimeline(parse("speed 1\na -> b\nb -> c\nc -> d").doc); // 0,1,2 시작, total 3
test("starts paused at 0 before first step completes", () => {
  const c = createController(tl);
  expect(c.playing).toBe(false); expect(c.time).toBe(0); expect(c.currentStep()).toBe(0);
});
test("tick advances only while playing, scaled by rate", () => {
  const c = createController(tl);
  c.tick(0.5); expect(c.time).toBe(0);
  c.play(); c.setRate(2); c.tick(0.5); expect(c.time).toBe(1); expect(c.currentStep()).toBe(1);
});
test("next and prev jump to step starts", () => {
  const c = createController(tl);
  c.next(); expect(c.time).toBe(1);
  c.next(); c.next(); expect(c.time).toBe(3);
  c.prev(); expect(c.time).toBe(2);
  c.tick(0); c.time = 2.6; c.prev(); expect(c.time).toBe(2);
});
test("loops after hold when loop is on, stops at end otherwise", () => {
  const a = createController(tl, { loop: true, hold: 1 }); a.play(); a.tick(3.5); expect(a.time).toBe(3.5); a.tick(0.6); expect(a.time).toBeCloseTo(0.1);
  const b = createController(tl, { loop: false }); b.play(); b.tick(10); expect(b.time).toBe(3); expect(b.playing).toBe(false);
});
test("restart and toggle", () => {
  const c = createController(tl); c.toggle(); expect(c.playing).toBe(true);
  c.tick(2); c.restart(); expect(c.time).toBe(0);
});
