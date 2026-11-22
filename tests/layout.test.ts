import assert from "node:assert/strict";
import { test } from "node:test";
import { arrange, cascade, tile } from "../lib/layout.ts";

const screen = { x: 0, y: 25, width: 1500, height: 900 };

test("tiling uses a grid that is never taller than it is wide", () => {
  const shape = (count: number) => {
    const cells = tile(screen, count);
    return [new Set(cells.map((c) => c.x)).size, new Set(cells.map((c) => c.y)).size];
  };
  assert.deepEqual(shape(1), [1, 1]);
  assert.deepEqual(shape(2), [2, 1]);
  assert.deepEqual(shape(4), [2, 2]);
  assert.deepEqual(shape(6), [3, 2]);
  assert.deepEqual(shape(10), [4, 3]);
  assert.deepEqual(shape(18), [5, 4]);
});

test("tiled windows stay on the screen and don't overlap", () => {
  const cells = tile(screen, 7);
  assert.equal(cells.length, 7);
  for (const cell of cells) {
    assert.ok(cell.x >= screen.x && cell.y >= screen.y);
    assert.ok(cell.x + cell.width <= screen.x + screen.width);
    assert.ok(cell.y + cell.height <= screen.y + screen.height);
  }
  assert.equal(new Set(cells.map((c) => `${c.x},${c.y}`)).size, 7);
});

test("tiling nothing gives nothing", () => {
  assert.deepEqual(tile(screen, 0), []);
});

test("a fixed size gives every window that size, each a step from the last", () => {
  const cells = cascade(screen, 3, { width: 800, height: 600 });
  assert.deepEqual(cells.map((c) => [c.width, c.height]), [[800, 600], [800, 600], [800, 600]]);
  assert.equal(new Set(cells.map((c) => `${c.x},${c.y}`)).size, 3);
  assert.deepEqual([cells[0].x, cells[0].y], [screen.x, screen.y]);
});

test("a size bigger than the screen is cut down to fit", () => {
  const [cell] = cascade(screen, 1, { width: 5000, height: 5000 });
  assert.deepEqual([cell.width, cell.height], [screen.width, screen.height]);
});

test("a long cascade starts over rather than running off the screen", () => {
  const cells = cascade(screen, 40, { width: 1300, height: 800 });
  for (const cell of cells) {
    assert.ok(cell.x + cell.width <= screen.x + screen.width);
    assert.ok(cell.y + cell.height <= screen.y + screen.height);
  }
});

test("arrange picks the layout asked for", () => {
  assert.deepEqual(arrange(screen, 2, "tile"), tile(screen, 2));
  assert.deepEqual(arrange(screen, 2, { width: 500, height: 400 }), cascade(screen, 2, { width: 500, height: 400 }));
});
