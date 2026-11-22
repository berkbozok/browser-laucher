/** A rectangle on the screen, measured from the top left corner. */
export type Rect = { x: number; y: number; width: number; height: number };

/** How to lay windows out: fill the screen, or all at one size. */
export type Layout = "tile" | { width: number; height: number };

/**
 * Splits `area` into a grid with one cell per window, as close to square as
 * the count allows and never taller than it is wide. The last row may have
 * cells to spare.
 */
export function tile(area: Rect, count: number): Rect[] {
  if (count <= 0) return [];
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const width = Math.floor(area.width / columns);
  const height = Math.floor(area.height / rows);

  return Array.from({ length: count }, (_, index) => ({
    x: area.x + (index % columns) * width,
    y: area.y + Math.floor(index / columns) * height,
    width,
    height,
  }));
}

/** How far each window is shifted from the one before it. */
const STEP = 28;

/**
 * Gives every window the same size and stacks them like a hand of cards,
 * each a little down and to the right of the last, starting over at the top
 * left when the next one would leave the screen. A size bigger than the
 * screen is cut down to fit.
 */
export function cascade(
  area: Rect,
  count: number,
  size: { width: number; height: number },
): Rect[] {
  const width = Math.min(Math.round(size.width), area.width);
  const height = Math.min(Math.round(size.height), area.height);
  // How many steps fit before a window would stick out.
  const room = Math.max(
    1,
    1 +
      Math.floor(
        Math.min(area.width - width, area.height - height) / STEP,
      ),
  );

  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    x: area.x + (index % room) * STEP,
    y: area.y + (index % room) * STEP,
    width,
    height,
  }));
}

/** The rectangles for `count` windows under the chosen layout. */
export function arrange(area: Rect, count: number, layout: Layout): Rect[] {
  return layout === "tile" ? tile(area, count) : cascade(area, count, layout);
}
