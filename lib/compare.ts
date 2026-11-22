/**
 * Comparing pictures of the same page in two browsers.
 *
 * Two browsers never draw a page pixel for pixel alike: letters are smoothed
 * differently, toolbars have different heights, and some browsers have a
 * sidebar that pushes the page to the right. So this:
 *
 * 1. works on small pictures where one pixel is two points on the screen,
 * 2. finds where each browser's own toolbar and sidebar end and leaves them
 *    out, because only the page is meant to look alike,
 * 3. slides one picture over the other until the pages line up, and
 * 4. compares squares of the page by their colour and by how much detail
 *    (text, edges) they hold, allowing a pixel or two of drift, so that
 *    what it marks is laid out differently, missing or extra, rather than
 *    letters drawn a shade differently.
 */

/** A picture as red, green and blue values (0 to 255), row by row. */
export type Picture = { width: number; height: number; rgb: Uint8Array };

/** A rectangle given as shares (0 to 1) of a picture's width and height. */
export type Box = { x: number; y: number; width: number; height: number };

/** Where the page sits inside a window's picture, in pixels of that picture. */
export type PageArea = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type Comparison = {
  /**
   * The squares that look different, merged into rectangles, as shares of
   * the second picture's width and height.
   */
  marks: Box[];
  /** Separate places that look different (marks close together count once). */
  areas: number;
  /** Share of the compared page that differs, from 0 to 1. */
  share: number;
  /** Size of each picture's page area, in screen points. */
  pageSizes: [
    { width: number; height: number },
    { width: number; height: number },
  ];
  /** How far the second page had to be moved to line up, in screen points. */
  shift: { x: number; y: number };
  /** Whether the two pictures could be lined up at all. */
  aligned: boolean;
};

/** Page widths this close, in points, count as the same. */
export const SAME_WIDTH_WITHIN = 1;

/**
 * Pixels per screen point in the pictures this works on. One pixel a point
 * measures page widths to the point, which matters: two points narrower is
 * enough for a word to wrap onto the next line.
 */
export const PIXELS_PER_POINT = 1;
/** Side of a compared square, in pixels (16 points). */
const BLOCK = Math.round(16 * PIXELS_PER_POINT);
/** How far, in pixels, a square may drift and still count as the same (4 points). */
const DRIFT = Math.round(4 * PIXELS_PER_POINT);
/** Drift offsets to try, nearest first, so a square in place is found at once. */
const OFFSETS: [number, number][] = [];
for (let oy = -DRIFT; oy <= DRIFT; oy++) {
  for (let ox = -DRIFT; ox <= DRIFT; ox++) OFFSETS.push([ox, oy]);
}
OFFSETS.sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
/** Toolbars end somewhere in this band from the top of a window, in points. */
const TOOLBAR_BAND: [number, number] = [20, 170];
/** A sidebar ends within this many points of a window's left edge. */
const SIDEBAR_MAX = 90;
/** A window's rounded rim, in pixels, left out on every side (2 points). */
const RIM = Math.max(1, Math.round(2 * PIXELS_PER_POINT));

/** Reads a BMP file (24 or 32 bits a pixel), as `sips` writes them. */
export function pictureFromBmp(file: Uint8Array): Picture | null {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.byteLength < 54 || view.getUint16(0, false) !== 0x424d) return null;
  const offset = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const bytes = view.getUint16(28, true) / 8;
  if (width <= 0 || rawHeight === 0 || (bytes !== 3 && bytes !== 4))
    return null;
  const height = Math.abs(rawHeight);
  const stride = Math.ceil((width * bytes) / 4) * 4;
  if (offset + stride * height > file.byteLength) return null;

  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    // Rows are stored bottom-up unless the height is negative.
    const row = offset + (rawHeight > 0 ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x++) {
      const from = row + x * bytes;
      const to = (y * width + x) * 3;
      const alpha = bytes === 4 ? file[from + 3] / 255 : 1;
      // See-through corners count as mid-grey.
      rgb[to] = Math.round(file[from + 2] * alpha + 128 * (1 - alpha));
      rgb[to + 1] = Math.round(file[from + 1] * alpha + 128 * (1 - alpha));
      rgb[to + 2] = Math.round(file[from] * alpha + 128 * (1 - alpha));
    }
  }
  return { width, height, rgb };
}

function grayOf(picture: Picture): Float32Array {
  const gray = new Float32Array(picture.width * picture.height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] =
      0.299 * picture.rgb[i * 3] +
      0.587 * picture.rgb[i * 3 + 1] +
      0.114 * picture.rgb[i * 3 + 2];
  }
  return gray;
}

/** The largest step in red, green or blue between two pixels. */
function step(rgb: Uint8Array, a: number, b: number): number {
  return Math.max(
    Math.abs(rgb[a * 3] - rgb[b * 3]),
    Math.abs(rgb[a * 3 + 1] - rgb[b * 3 + 1]),
    Math.abs(rgb[a * 3 + 2] - rgb[b * 3 + 2]),
  );
}

/** Rows (from the top) where the colour changes across nearly the whole width. */
function horizontalEdges(picture: Picture): number[] {
  const { width, rgb } = picture;
  const from = Math.max(1, Math.round(TOOLBAR_BAND[0] * PIXELS_PER_POINT));
  const to = Math.min(
    picture.height - 1,
    Math.round(TOOLBAR_BAND[1] * PIXELS_PER_POINT),
  );
  const left = Math.round(width * 0.05);
  const right = Math.round(width * 0.95);
  const edges: number[] = [];
  for (let y = from; y <= to; y++) {
    let changed = 0;
    for (let x = left; x < right; x++) {
      if (step(rgb, y * width + x, (y - 1) * width + x) >= 6) changed++;
    }
    if (changed / (right - left) >= 0.8) edges.push(y);
  }
  return edges;
}

/** The right edge of a sidebar along the window's left side, or 0. */
function sidebarEdge(picture: Picture): number {
  const { width, height, rgb } = picture;
  const top = Math.round(height * 0.3);
  const bottom = Math.round(height * 0.95);
  const limit = Math.min(width - 1, Math.round(SIDEBAR_MAX * PIXELS_PER_POINT));
  let edge = 0;
  for (let x = RIM + 1; x <= limit; x++) {
    let changed = 0;
    for (let y = top; y < bottom; y++) {
      if (step(rgb, y * width + x, y * width + x - 1) >= 6) changed++;
    }
    if (changed / (bottom - top) >= 0.8) edge = x;
  }
  return edge;
}

/**
 * Average brightness of each `size`-pixel square, used to line pictures up
 * without letters getting in the way.
 */
function shrink(
  gray: Float32Array,
  width: number,
  height: number,
  size: number,
) {
  const w = Math.floor(width / size);
  const h = Math.floor(height / size);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h * size; y++) {
    for (let x = 0; x < w * size; x++) {
      out[Math.floor(y / size) * w + Math.floor(x / size)] +=
        gray[y * width + x];
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= size * size;
  return { w, h, data: out };
}

/**
 * How far `b` has to be moved (right and down, in pixels) for its page to
 * sit on `a`'s, judged on the part of `a` inside `region`. Also returns how
 * well they then match: the average brightness gap.
 *
 * Searches a wide range around no move at all (toolbars and sidebars differ
 * by up to about a hundred points), first on 8-point squares, then finer
 * around the best guess at each step.
 */
function lineUp(
  a: Float32Array,
  aw: number,
  ah: number,
  b: Float32Array,
  bw: number,
  bh: number,
  region: PageArea,
): { dx: number; dy: number; cost: number } {
  const costAt = (
    da: Float32Array,
    dw: number,
    db: Float32Array,
    dbw: number,
    dbh: number,
    area: PageArea,
    dx: number,
    dy: number,
    stride: number,
  ) => {
    let total = 0;
    let count = 0;
    for (let y = area.top; y < area.bottom; y += stride) {
      const yb = y - dy;
      if (yb < 0 || yb >= dbh) continue;
      for (let x = area.left; x < area.right; x += stride) {
        const xb = x - dx;
        if (xb < 0 || xb >= dbw) continue;
        total += Math.abs(da[y * dw + x] - db[yb * dbw + xb]);
        count++;
      }
    }
    // Too little overlap to judge counts as a bad match.
    return count < 50 ? Infinity : total / count;
  };

  let best = { dx: 0, dy: 0, cost: Infinity };
  const steps = [
    {
      size: Math.max(1, Math.round(8 * PIXELS_PER_POINT)),
      reachX: 100,
      reachY: 130,
    },
    {
      size: Math.max(1, Math.round(2 * PIXELS_PER_POINT)),
      reachX: 10,
      reachY: 10,
    },
    { size: 1, reachX: 2, reachY: 2 },
  ];
  for (const { size, reachX, reachY } of steps) {
    const sa = size === 1 ? { w: aw, h: ah, data: a } : shrink(a, aw, ah, size);
    const sb = size === 1 ? { w: bw, h: bh, data: b } : shrink(b, bw, bh, size);
    const area = {
      left: Math.ceil(region.left / size),
      top: Math.ceil(region.top / size),
      right: Math.floor(region.right / size),
      bottom: Math.floor(region.bottom / size),
    };
    const centreX = Math.round(best.dx / size);
    const centreY = Math.round(best.dy / size);
    const spanX = Math.ceil((reachX * PIXELS_PER_POINT) / size);
    const spanY = Math.ceil((reachY * PIXELS_PER_POINT) / size);
    // Small pictures are judged on every square, large ones on every other.
    const stride = size === 1 ? 2 : 1;
    let found = { dx: centreX, dy: centreY, cost: Infinity };
    for (let dy = centreY - spanY; dy <= centreY + spanY; dy++) {
      for (let dx = centreX - spanX; dx <= centreX + spanX; dx++) {
        const cost = costAt(
          sa.data,
          sa.w,
          sb.data,
          sb.w,
          sb.h,
          area,
          dx,
          dy,
          stride,
        );
        // On a near tie (plain backgrounds), prefer the smaller move.
        const nearer =
          Math.abs(dx) + Math.abs(dy) < Math.abs(found.dx) + Math.abs(found.dy);
        if (cost < found.cost - 0.05 || (cost <= found.cost + 0.05 && nearer)) {
          found = { dx, dy, cost };
        }
      }
    }
    best = { dx: found.dx * size, dy: found.dy * size, cost: found.cost };
  }
  return best;
}

/** The page inside a window's picture: below `top` and right of any sidebar. */
function pageArea(picture: Picture, top: number): PageArea {
  return {
    left: Math.max(RIM, sidebarEdge(picture)),
    top,
    right: picture.width - RIM,
    bottom: picture.height - RIM,
  };
}

/**
 * Running totals of red, green, blue and detail (how sharply brightness
 * changes) over a picture, so that any square's averages take four lookups
 * instead of adding up every pixel again for each try.
 */
type Totals = { width: number; height: number; sums: Uint32Array[] };

function totalsOf(picture: Picture, gray: Float32Array): Totals {
  const { width, height, rgb } = picture;
  const stride = width + 1;
  const sums = [0, 1, 2, 3].map(() => new Uint32Array(stride * (height + 1)));
  const row = [0, 0, 0, 0];
  for (let y = 0; y < height; y++) {
    row.fill(0);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      row[0] += rgb[i * 3];
      row[1] += rgb[i * 3 + 1];
      row[2] += rgb[i * 3 + 2];
      if (x > 0 && y > 0) {
        row[3] += Math.round(
          Math.abs(gray[i] - gray[i - 1]) + Math.abs(gray[i] - gray[i - width]),
        );
      }
      const at = (y + 1) * stride + x + 1;
      for (let c = 0; c < 4; c++) sums[c][at] = sums[c][at - stride] + row[c];
    }
  }
  return { width, height, sums };
}

/** Mean colour and amount of detail of one square, or null if it sticks out. */
function describeSquare(
  totals: Totals,
  x0: number,
  y0: number,
): [number, number, number, number] | null {
  const { width, height, sums } = totals;
  if (x0 < 1 || y0 < 1 || x0 + BLOCK > width || y0 + BLOCK > height)
    return null;
  const stride = width + 1;
  const topLeft = y0 * stride + x0;
  const topRight = topLeft + BLOCK;
  const bottomLeft = topLeft + BLOCK * stride;
  const bottomRight = bottomLeft + BLOCK;
  const n = BLOCK * BLOCK;
  const mean = (c: number) =>
    (sums[c][bottomRight] -
      sums[c][topRight] -
      sums[c][bottomLeft] +
      sums[c][topLeft]) /
    n;
  return [mean(0), mean(1), mean(2), mean(3)];
}

function squareGap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const colour = Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2]),
  );
  const detail = Math.abs(a[3] - b[3]);
  // Colour counts once past 24 levels apart; detail once past 12.
  return Math.max(colour / 24, detail / 12);
}

/**
 * Counts groups of marked squares. Squares up to `reach` apart belong to the
 * same group, so one changed paragraph counts once, not once a word.
 */
function countGroups(
  marked: Uint8Array,
  columns: number,
  rows: number,
  reach: number,
): number {
  const seen = new Uint8Array(marked.length);
  let count = 0;
  for (let start = 0; start < marked.length; start++) {
    if (!marked[start] || seen[start]) continue;
    count++;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop()!;
      const cx = at % columns;
      const cy = Math.floor(at / columns);
      for (let oy = -reach; oy <= reach; oy++) {
        for (let ox = -reach; ox <= reach; ox++) {
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
          const next = ny * columns + nx;
          if (marked[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
  }
  return count;
}

/**
 * Turns the marked squares into few rectangles: runs along each row, and
 * runs that repeat exactly on the rows below merged into one.
 */
function rectangles(marked: Uint8Array, columns: number, rows: number) {
  const done: { column: number; row: number; width: number; height: number }[] =
    [];
  let open = new Map<string, (typeof done)[number]>();
  for (let row = 0; row < rows; row++) {
    const next = new Map<string, (typeof done)[number]>();
    for (let column = 0; column < columns; column++) {
      if (!marked[row * columns + column]) continue;
      let end = column;
      while (end + 1 < columns && marked[row * columns + end + 1]) end++;
      const id = `${column}-${end}`;
      const above = open.get(id);
      if (above) {
        above.height++;
        open.delete(id);
        next.set(id, above);
      } else {
        next.set(id, { column, row, width: end - column + 1, height: 1 });
      }
      column = end;
    }
    done.push(...open.values());
    open = next;
  }
  done.push(...open.values());
  return done;
}

/**
 * Where the page in `b` looks different from the page in `a`. Both pictures
 * must be at PIXELS_PER_POINT pixels per screen point.
 */
export function comparePictures(a: Picture, b: Picture): Comparison {
  const grayA = grayOf(a);
  const grayB = grayOf(b);
  const edgesA = horizontalEdges(a);
  const edgesB = horizontalEdges(b);
  const fallbackTop = Math.round(TOOLBAR_BAND[1] * PIXELS_PER_POINT);

  // Line up first on what is surely page in both: below the lowest edge.
  const safeA = pageArea(a, edgesA.at(-1) ?? fallbackTop);
  const safeB = pageArea(b, edgesB.at(-1) ?? fallbackTop);
  const { dx, dy, cost } = lineUp(
    grayA,
    a.width,
    a.height,
    grayB,
    b.width,
    b.height,
    {
      ...safeA,
      // Judge by the middle of the page, away from the window's bottom edge.
      bottom: Math.max(
        safeA.top + 1,
        safeA.bottom - Math.round(8 * PIXELS_PER_POINT),
      ),
    },
  );

  // The page starts at the first edge in A whose twin in B sits exactly
  // `dy` higher (a page's own lines move together, toolbars don't) and
  // below which the two pictures agree.
  let topA = safeA.top;
  let topB = safeB.top;
  for (const ya of edgesA) {
    const yb = edgesB.find((y) => Math.abs(ya - dy - y) <= 1);
    if (yb === undefined) continue;
    let gap = 0;
    let count = 0;
    const until = Math.min(ya + Math.round(16 * PIXELS_PER_POINT), a.height);
    for (let y = ya; y < until; y++) {
      for (let x = safeA.left; x < safeA.right; x += 2) {
        const xb = x - dx;
        const ybRow = y - dy;
        if (xb < 0 || xb >= b.width || ybRow < 0 || ybRow >= b.height) continue;
        gap += Math.abs(grayA[y * a.width + x] - grayB[ybRow * b.width + xb]);
        count++;
      }
    }
    if (count > 0 && gap / count < 10) {
      topA = ya;
      topB = yb;
      break;
    }
  }
  const areaA = { ...safeA, top: topA };
  const areaB = { ...safeB, top: topB };

  // Compare, on a grid over A, the part where both pages are.
  const left = Math.max(areaA.left, areaB.left + dx);
  const top = Math.max(areaA.top, areaB.top + dy);
  const right = Math.min(areaA.right, areaB.right + dx);
  const bottom = Math.min(areaA.bottom, areaB.bottom + dy);
  const columns = Math.max(0, Math.floor((right - left) / BLOCK));
  const rows = Math.max(0, Math.floor((bottom - top) / BLOCK));
  const marked = new Uint8Array(columns * rows);
  let different = 0;
  const totalsA = totalsOf(a, grayA);
  const totalsB = totalsOf(b, grayB);

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x0 = left + column * BLOCK;
      const y0 = top + row * BLOCK;
      const square = describeSquare(totalsA, x0, y0);
      if (!square) continue;
      // Allow a little drift: the best match nearby counts.
      let best = Infinity;
      for (const [ox, oy] of OFFSETS) {
        const twin = describeSquare(totalsB, x0 - dx + ox, y0 - dy + oy);
        if (twin) best = Math.min(best, squareGap(square, twin));
        if (best <= 1) break;
      }
      if (best > 1) {
        marked[row * columns + column] = 1;
        different++;
      }
    }
  }

  const toPoints = (pixels: number) => Math.round(pixels / PIXELS_PER_POINT);
  const marks: Box[] = rectangles(marked, columns, rows).map((rect) => ({
    x: (left - dx + rect.column * BLOCK) / b.width,
    y: (top - dy + rect.row * BLOCK) / b.height,
    width: (rect.width * BLOCK) / b.width,
    height: (rect.height * BLOCK) / b.height,
  }));

  return {
    marks,
    areas: countGroups(marked, columns, rows, 2),
    share: columns * rows === 0 ? 0 : different / (columns * rows),
    // The page runs to the window's edges; the rim was only left out of
    // the comparison.
    pageSizes: [
      {
        width: toPoints(a.width - (areaA.left > RIM ? areaA.left : 0)),
        height: toPoints(a.height - areaA.top),
      },
      {
        width: toPoints(b.width - (areaB.left > RIM ? areaB.left : 0)),
        height: toPoints(b.height - areaB.top),
      },
    ],
    shift: { x: toPoints(dx), y: toPoints(dy) },
    aligned: Number.isFinite(cost),
  };
}
