import test from "node:test";
import assert from "node:assert/strict";
import { separateLabels } from "../label-stack.ts";

const H = 12;

test("UX-a: the SL flag and the MAE label no longer print on top of each other", () => {
  // As seen on the ex-sl chart: `≈ SL` at y 300 and `MAE ≈ −5.00 pts` at y 303, both near x 210.
  const [sl, mae] = separateLabels([{ x: 205, width: 30, y: 300 }, { x: 212, width: 96, y: 303 }], H, 0, 400);
  assert.ok(Math.abs(sl - mae) >= H, `${sl} ${mae}`);
  assert.ok(sl < mae, "order by wanted height is kept");
});

test("UX-a: labels that do not touch keep their place", () => {
  const labels = [{ x: 10, width: 40, y: 100 }, { x: 200, width: 40, y: 102 }, { x: 10, width: 40, y: 140 }];
  assert.deepEqual(separateLabels(labels, H, 0, 400), [100, 102, 140]);
});

test("UX-a: a chain of overlaps stacks as one group, inside the pane", () => {
  const labels = [{ x: 0, width: 50, y: 5 }, { x: 40, width: 50, y: 8 }, { x: 80, width: 50, y: 11 }];
  const ys = separateLabels(labels, H, 0, 400);
  assert.ok(ys.every((y) => y >= H / 2), ys.join(" "));
  assert.ok(ys[1] - ys[0] >= H && ys[2] - ys[1] >= H, ys.join(" "));
});
