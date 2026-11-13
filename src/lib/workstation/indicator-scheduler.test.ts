import { expect, it } from "vitest";
import { IndicatorScheduler } from "./indicator-scheduler";

it("waits for all foreground charts and serializes supplementary work", async () => {
  const queue = new IndicatorScheduler(), controller = new AbortController(), order: number[] = [];
  queue.foreground("one", true); queue.foreground("two", true);
  const first = queue.run(controller.signal, async () => { order.push(1); await new Promise(resolve => setTimeout(resolve, 5)); order.push(2); });
  const second = queue.run(controller.signal, async () => { order.push(3); });
  queue.foreground("one", false); await Promise.resolve(); expect(order).toEqual([]);
  queue.foreground("two", false); await Promise.all([first, second]); expect(order).toEqual([1, 2, 3]);
});
it("preempts an active indicator request then resumes after navigation", async () => {
  const queue = new IndicatorScheduler(), controller = new AbortController(); let calls = 0;
  const work = queue.run(controller.signal, async signal => { calls++; if (calls === 1) await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); return 7; });
  queue.foreground("navigation", true); await Promise.resolve(); queue.foreground("navigation", false);
  expect(await work).toBe(7); expect(calls).toBe(2);
});
it("removes cancelled waiting consumers without cancelling foreground work", async () => {
  const queue = new IndicatorScheduler(), controller = new AbortController(); queue.foreground("price", true);
  const work = queue.run(controller.signal, async () => 1); controller.abort(); await expect(work).rejects.toBeTruthy();
  queue.foreground("price", false); expect(await queue.run(new AbortController().signal, async () => 2)).toBe(2);
});
it("holds indicator activation until foreground work settles and cancels an obsolete activation", async () => {
  const queue = new IndicatorScheduler(), controller = new AbortController(); let ready = false;
  queue.foreground("price", true);
  const settled = queue.settled(controller.signal).then(() => { ready = true; });
  await new Promise(resolve => setTimeout(resolve, 5)); expect(ready).toBe(false);
  queue.foreground("price", false); await settled; expect(ready).toBe(true);
  const cancelled = new AbortController(), pending = queue.settled(cancelled.signal); cancelled.abort();
  await expect(pending).rejects.toBeTruthy();
});
