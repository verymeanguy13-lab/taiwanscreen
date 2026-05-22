// =============================================================================
// lib/treemap.ts — Squarified treemap layout algorithm
// Bruls, Huizing, van Wijk (2000): "Squarified Treemaps"
// =============================================================================

export interface HeatItem {
  symbol:     string;
  name_zh:    string;
  change_pct: number;
  value:      number;
}

export interface LayoutRect {
  symbol:     string;
  name_zh:    string;
  change_pct: number;
  x:          number;
  y:          number;
  w:          number;
  h:          number;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Worst aspect ratio in a row of rectangles laid into a strip of given length.
function worstRatio(row: number[], length: number): number {
  const s   = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max(
    (length * length * max) / (s * s),
    (s * s) / (length * length * min),
  );
}

// Lay out one row of normalised values along the short side of the bounds,
// returning an array of LayoutRect and the remaining bounds.
function layoutRow(
  row:      number[],
  items:    HeatItem[],
  bounds:   Bounds,
  isHoriz:  boolean,
): LayoutRect[] {
  const rects: LayoutRect[] = [];
  const rowSum = row.reduce((a, b) => a + b, 0);

  // Thickness of the strip (perpendicular dimension)
  const thickness = isHoriz
    ? (bounds.h * rowSum) / (bounds.w * bounds.h / bounds.w)   // simplified below
    : (bounds.w * rowSum) / (bounds.w * bounds.h / bounds.h);

  // Simpler: thickness = total_area_of_row / strip_length
  const stripLen   = isHoriz ? bounds.w : bounds.h;
  const stripThick = rowSum / stripLen;

  let offset = 0;
  for (let i = 0; i < row.length; i++) {
    const span = row[i] / stripThick; // length along strip axis
    if (isHoriz) {
      rects.push({
        symbol:     items[i].symbol,
        name_zh:    items[i].name_zh,
        change_pct: items[i].change_pct,
        x: bounds.x + offset,
        y: bounds.y,
        w: span,
        h: stripThick,
      });
    } else {
      rects.push({
        symbol:     items[i].symbol,
        name_zh:    items[i].name_zh,
        change_pct: items[i].change_pct,
        x: bounds.x,
        y: bounds.y + offset,
        w: stripThick,
        h: span,
      });
    }
    offset += span;
  }
  return rects;
}

// Remaining bounds after committing a row
function remainingBounds(
  row:     number[],
  bounds:  Bounds,
  isHoriz: boolean,
): Bounds {
  const rowSum     = row.reduce((a, b) => a + b, 0);
  const stripLen   = isHoriz ? bounds.w : bounds.h;
  const stripThick = rowSum / stripLen;

  if (isHoriz) {
    return { x: bounds.x, y: bounds.y + stripThick, w: bounds.w, h: bounds.h - stripThick };
  } else {
    return { x: bounds.x + stripThick, y: bounds.y, w: bounds.w - stripThick, h: bounds.h };
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function squarify(items: HeatItem[], bounds: Bounds): LayoutRect[] {
  if (!items.length || bounds.w <= 0 || bounds.h <= 0) return [];

  // 1. Sort descending by value
  const sorted = [...items].sort((a, b) => b.value - a.value);

  // 2. Normalise values to total pixel area
  const totalValue = sorted.reduce((s, it) => s + Math.max(it.value, 0), 0);
  if (totalValue === 0) return [];

  const area     = bounds.w * bounds.h;
  const normed   = sorted.map(it => (Math.max(it.value, 0) / totalValue) * area);

  // 3. Recursive squarify
  return squarifyNormed(normed, sorted, bounds);
}

function squarifyNormed(
  normed: number[],
  items:  HeatItem[],
  bounds: Bounds,
): LayoutRect[] {
  if (normed.length === 0) return [];
  if (normed.length === 1) {
    return [{
      symbol:     items[0].symbol,
      name_zh:    items[0].name_zh,
      change_pct: items[0].change_pct,
      x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h,
    }];
  }

  const isHoriz = bounds.w >= bounds.h;
  const stripLen = isHoriz ? bounds.w : bounds.h;

  let row:      number[]   = [];
  let rowItems: HeatItem[] = [];

  for (let i = 0; i < normed.length; i++) {
    const candidate = [...row, normed[i]];
    if (
      row.length === 0 ||
      worstRatio(candidate, stripLen) <= worstRatio(row, stripLen)
    ) {
      row.push(normed[i]);
      rowItems.push(items[i]);
    } else {
      // Commit row and recurse
      const committed = layoutRow(row, rowItems, bounds, isHoriz);
      const next      = remainingBounds(row, bounds, isHoriz);
      return [
        ...committed,
        ...squarifyNormed(normed.slice(i), items.slice(i), next),
      ];
    }
  }

  // Commit final row
  return layoutRow(row, rowItems, bounds, isHoriz);
}