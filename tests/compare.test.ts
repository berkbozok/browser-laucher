import assert from "node:assert/strict";
import test from "node:test";
import { comparePictures, type Picture } from "../lib/compare.ts";

type Rect = [
  x: number,
  y: number,
  width: number,
  height: number,
  shade: number,
];

/**
 * A fake window picture: a toolbar `toolbar` pixels tall, then a dark page
 * with the given rectangles drawn on it (page coordinates). Optionally a
 * sidebar down the left side.
 */
function windowPicture(
  toolbar: number,
  rects: Rect[],
  { sidebar = 0, width = 600, height = 400 } = {},
): Picture {
  const rgb = new Uint8Array(width * height * 3);
  const paint = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 3;
    rgb[i] = r;
    rgb[i + 1] = g;
    rgb[i + 2] = b;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y < toolbar) paint(x, y, 70, 70, 80);
      else if (x < sidebar) paint(x, y, 40, 40, 90);
      else paint(x, y, 17, 17, 17);
    }
  }
  for (const [rx, ry, rw, rh, shade] of rects) {
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        paint(sidebar + x, toolbar + y, shade, shade / 2, 255 - shade);
      }
    }
  }
  return { width, height, rgb };
}

// A heading, some "lines of text" and three boxes.
const page: Rect[] = [
  [30, 30, 300, 24, 230],
  [30, 80, 500, 6, 200],
  [30, 96, 460, 6, 200],
  [30, 112, 380, 6, 200],
  [30, 150, 150, 100, 60],
  [210, 150, 150, 100, 140],
  [390, 150, 150, 100, 220],
];

test("the same page under toolbars of different heights looks the same", () => {
  const found = comparePictures(
    windowPicture(70, page),
    windowPicture(100, page),
  );
  assert.equal(found.areas, 0);
  assert.equal(found.marks.length, 0);
  assert.equal(found.shift.y, -30);
});

test("a box that moved is marked, and nothing else", () => {
  const moved = page.map((rect, index): Rect =>
    index === 5 ? [250, 150, 150, 100, 140] : rect,
  );
  const found = comparePictures(
    windowPicture(70, page),
    windowPicture(70, moved),
  );
  assert.ok(found.areas >= 1);
  // Every mark lies around the box's old and new place.
  for (const mark of found.marks) {
    const top = mark.y * 400;
    assert.ok(top >= 70 + 150 - 16 && top < 70 + 250, `mark at ${top}`);
  }
});

test("a sidebar is left out and makes the page narrower", () => {
  const found = comparePictures(
    windowPicture(70, page),
    windowPicture(70, page, { sidebar: 50, width: 650 }),
  );
  assert.equal(found.areas, 0);
  assert.equal(found.pageSizes[0].width, found.pageSizes[1].width);
});
