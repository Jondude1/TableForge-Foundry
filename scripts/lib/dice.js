// Dice + random-table math. Ported from TableForge-web (app/src/lib/tablemath.ts).
// Pure logic — no Foundry globals — so it can be smoke-tested headless in Node.

export const DICE = [4, 6, 8, 10, 12, 20, 100];

/** Roll one die with the given number of sides; result is in 1..sides. */
export const rollDie = (sides) => 1 + Math.floor(Math.random() * sides);

/**
 * Splits 1..sides into `count` contiguous ranges as evenly as possible
 * (4 entries on a d10 -> 1-3, 4-6, 7-8, 9-10).
 */
export function ranges(sides, count) {
  if (count <= 0) return [];
  const n = Math.min(count, sides);
  const base = Math.floor(sides / n);
  let extra = sides % n;
  let start = 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const size = base + (extra-- > 0 ? 1 : 0);
    out.push([start, start + size - 1]);
    start += size;
  }
  return out;
}

/** Turns a list of entry texts into ranged entries for a die of `sides`. */
export function entriesFor(sides, texts) {
  return ranges(sides, texts.length).map(([a, b], i) => ({ minRoll: a, maxRoll: b, text: texts[i] }));
}

/** Finds the entry whose range contains roll `n` (undefined if none). */
export const lookup = (entries, n) => entries.find((e) => n >= e.minRoll && n <= e.maxRoll);

export function rangeLabel(a, b, sides) {
  const f = (v) => (sides === 100 && v === 100 ? "00" : String(v));
  return a === b ? f(a) : `${f(a)}–${f(b)}`;
}

/** Default number of entries the donor app creates for a new table. */
export const defaultCount = (sides) => (sides === 100 ? 20 : sides);

/** Uniform pick from an array. */
export const pick = (a) => a[Math.floor(Math.random() * a.length)];

/** Fisher-Yates shuffle copy. */
export function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Small unique-id helper (timestamp + counter), same spirit as the donor's card keys. */
let counter = 0;
export const uid = (prefix = "tf") => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
