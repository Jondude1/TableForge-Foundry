// Grid-map logic: coordinates, terrain painting, the AI/offline map editor,
// and the Foundry Scene export payload. Ported from TableForge-web
// (app/src/lib/mapforge.ts). Pure except renderMapDataUrl(), which needs a
// browser canvas (Foundry client) and is guarded accordingly.
//
// A map: { id, name, cols, rows, terrain (string of terrain codes, row-major),
//          feetPerSquare, notes, features: [feature] }
// A feature: { id, x, y, w, h, name, kind, icon, color, description }

import { TERRAINS, terrainByCode, terrainFromKey } from "./terrains.js";
import { parseObject, AiError } from "./ai.js";
import { uid } from "./dice.js";

export function colName(x) {
  let n = x, s = "";
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
export const cellName = (x, y) => `${colName(x)}${y + 1}`;
export const rectLabel = (r) =>
  r.w === 1 && r.h === 1 ? cellName(r.x, r.y) : `${cellName(r.x, r.y)}–${cellName(r.x + r.w - 1, r.y + r.h - 1)} (${r.w}×${r.h})`;
export const spanning = (ax, ay, bx, by) =>
  ({ x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(ax - bx) + 1, h: Math.abs(ay - by) + 1 });

export const blankTerrain = (cols, rows, base) => base.code.repeat(cols * rows);

export function newMap(name, cols, rows, baseCode = "g", feetPerSquare = 5) {
  const base = terrainByCode(baseCode);
  return {
    id: uid("map"), name: name || "Untitled map",
    cols, rows, terrain: blankTerrain(cols, rows, base),
    feetPerSquare, notes: "", features: [],
  };
}

/** Applies terrain paints ([{terrain, cells:[[x,y],...]}]) to a terrain string. */
export function paint(map, paints) {
  const chars = map.terrain.split("");
  for (const p of paints) for (const [x, y] of p.cells) {
    if (x >= 0 && x < map.cols && y >= 0 && y < map.rows) chars[y * map.cols + x] = p.terrain.code;
  }
  return chars.join("");
}

/** All cells of a rect, clipped to the map. */
export function rectCells(map, r) {
  const cells = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (x >= 0 && x < map.cols && y >= 0 && y < map.rows) cells.push([x, y]);
  }
  return cells;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const int = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);

// ---------- AI map editing (donor: build / parse) ----------

const MAP_SYSTEM = `You are a map-building assistant for a Dungeons & Dragons Dungeon Master. You edit a square-grid map.
Coordinates: x is the column (0 = left edge), y is the row (0 = top edge). Squares are labeled with a column letter and a 1-based row number, so "C4" means x=2, y=3. Each square is a fixed number of feet.
You can do anything the DM asks by combining three operations:
1. "features": things placed on the map. Each occupies a w-by-h block of whole squares with its top-left at (x, y). Size things realistically for the square size unless the DM gives a size. "4 squares" means a 2x2 block. Large or irregular things (a ship, a wall, a camp) can be split into several features.
2. "terrain": repaint squares with one of these terrain types: ${TERRAINS.map((t) => t.key).join(", ")}. Use this for rivers, roads, forests, floors, walls, lava, swamps and so on. Give squares as "rects" [[x,y,w,h],...] and/or "cells" [[x,y],...].
3. "remove": ids of existing features to delete when the DM asks to remove or replace something.
Place things at or around the square(s) the DM selected unless they say otherwise. Keep everything inside the map bounds. Avoid covering existing features unless asked.
Each feature needs: name, kind (short noun), icon (a single emoji that best depicts it), color (a hex like #A0522D that suits it), x, y, w, h, and description.
The description is table-ready plain text with short labeled lines separated by \\n: "Read-aloud:" (1-2 vivid sentences), "Details:", and when it fits "Secret:" or "Encounter:".
Reply with JSON only: {"summary":"one short sentence of what you did","features":[...],"terrain":[{"terrain":"water","rects":[[x,y,w,h]],"cells":[[x,y]]}],"remove":[ids]}`;

export function mapPrompt(campaign, map, sel, request) {
  const lines = [];
  if (campaign?.name) {
    lines.push(`Campaign: ${campaign.name}`);
    if (campaign.premise) lines.push(`Plot: ${String(campaign.premise).slice(0, 600)}`);
    if (campaign.setting) lines.push(`Setting: ${campaign.setting}`);
    if (campaign.tone) lines.push(`Tone: ${campaign.tone}`);
    lines.push("");
  }
  lines.push(`MAP "${map.name}": ${map.cols} columns (x 0-${map.cols - 1}, A-${colName(map.cols - 1)}) by ${map.rows} rows (y 0-${map.rows - 1}, 1-${map.rows}). Each square is ${map.feetPerSquare} ft.`);
  if (map.notes) lines.push(`Map notes: ${map.notes}`);
  lines.push("Terrain legend: " + TERRAINS.map((t) => `${t.code}=${t.key}`).join(", "));
  lines.push("Current terrain, one line per row from y=0:");
  for (let y = 0; y < map.rows; y++) lines.push(map.terrain.slice(y * map.cols, (y + 1) * map.cols));
  if (!map.features.length) lines.push("Existing features: none");
  else {
    lines.push("Existing features:");
    map.features.forEach((f, i) => lines.push(`- id ${i + 1}: ${f.name} (${f.kind}) at x=${f.x}, y=${f.y}, size ${f.w}x${f.h}`));
  }
  lines.push("");
  lines.push(`The DM selected ${sel.w === 1 && sel.h === 1 ? "square" : "the area"} ${rectLabel(sel)}: x=${sel.x}, y=${sel.y}, w=${sel.w}, h=${sel.h}.`);
  lines.push(`DM's request: ${request}`);
  return { system: MAP_SYSTEM, user: lines.join("\n"), maxTokens: 4000 };
}

/** Parses a model map-edit reply into { summary, features, terrain, removeIds }. */
export function parseMapEdit(raw, map) {
  const json = parseObject(raw);
  const feats = [];
  for (const o of (Array.isArray(json.features) ? json.features : [])) {
    const w = clamp(int(o.w, 1), 1, map.cols), h = clamp(int(o.h, 1), 1, map.rows);
    const x = clamp(int(o.x, 0), 0, map.cols - w), y = clamp(int(o.y, 0), 0, map.rows - h);
    const name = String(o.name ?? "").trim() || String(o.kind ?? "").trim() || "Feature";
    const icon = String(o.icon ?? "").trim();
    const color = String(o.color ?? "").trim();
    feats.push({
      id: uid("feat"), x, y, w, h, name, kind: String(o.kind ?? "").trim(),
      icon: icon && icon.length <= 12 && !/[A-Za-z0-9]/.test(icon) ? icon : iconFor(name + " " + String(o.kind ?? "")),
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "",
      description: String(o.description ?? "").trim().replace(/\\n/g, "\n"),
    });
  }
  const paints = [];
  for (const o of (Array.isArray(json.terrain) ? json.terrain : [])) {
    const t = terrainFromKey(String(o.terrain ?? ""));
    if (!t) continue;
    const cells = [];
    for (const r of (Array.isArray(o.rects) ? o.rects : [])) {
      const [rx, ry, rw = 1, rh = 1] = r.map((v) => int(v, 0));
      for (let yy = ry; yy < ry + rh; yy++) for (let xx = rx; xx < rx + rw; xx++) cells.push([xx, yy]);
    }
    for (const c of (Array.isArray(o.cells) ? o.cells : [])) cells.push([int(c[0], -1), int(c[1], -1)]);
    const ok = cells.filter(([x, y]) => x >= 0 && x < map.cols && y >= 0 && y < map.rows);
    if (ok.length) paints.push({ terrain: t, cells: ok });
  }
  const removeIds = ((Array.isArray(json.remove) ? json.remove : []))
    .map((v) => map.features[int(v, 0) - 1]?.id).filter((u) => !!u);
  if (!feats.length && !paints.length && !removeIds.length) {
    throw new AiError(String(json.summary ?? "") || "Nothing to add for that request. Try describing it differently.");
  }
  return { summary: String(json.summary ?? "").trim(), features: feats, terrain: paints, removeIds };
}

/** Applies a parsed edit to a map, returning a NEW map object (input untouched). */
export function applyMapEdit(map, edit) {
  const next = structuredClone(map);
  if (edit.removeIds?.length) next.features = next.features.filter((f) => !edit.removeIds.includes(f.id));
  if (edit.terrain?.length) next.terrain = paint(next, edit.terrain);
  if (edit.features?.length) next.features.push(...edit.features);
  return next;
}

// ---------- Offline fallback (donor: offline) ----------

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, nine: 9, ten: 10, twelve: 12, sixteen: 16 };

export function blockFor(n) {
  let best = [n, 1];
  for (let a = 1; a <= Math.floor(Math.sqrt(n)); a++) if (n % a === 0) best = [n / a, a];
  return best;
}

export function offlineMapEdit(map, sel, request) {
  let req = String(request ?? "").trim();
  for (const [k, v] of Object.entries(WORDS)) req = req.replace(new RegExp(`\\b${k}\\b(?=\\s*(squares|tiles|spaces|cells))`, "gi"), String(v));
  const lower = req.toLowerCase();
  if (/^(make|turn|fill|paint|cover|change)\b/.test(lower)) {
    const t = TERRAINS.find((t) => lower.includes(t.key) || lower.includes(t.label.toLowerCase())) ?? lower.split(/\s+/).map(terrainFromKey).find(Boolean);
    if (t) {
      return { summary: `Painted ${rectLabel(sel)} as ${t.label.toLowerCase()}.`, features: [], terrain: [{ terrain: t, cells: rectCells(map, sel) }], removeIds: [] };
    }
  }
  let w = sel.w, h = sel.h;
  const wxh = /(\d+)\s*(?:x|×|by)\s*(\d+)/i.exec(req);
  const nsq = /(\d+)\s*(squares|tiles|spaces|cells)/i.exec(req);
  if (wxh) { w = Number(wxh[1]); h = Number(wxh[2]); } else if (nsq) [w, h] = blockFor(Math.max(1, Number(nsq[1])));
  w = clamp(w, 1, map.cols); h = clamp(h, 1, map.rows);
  const x = clamp(sel.x, 0, map.cols - w), y = clamp(sel.y, 0, map.rows - h);
  let name = req
    .replace(/(\d+)\s*(?:x|×|by)\s*(\d+)/i, "").replace(/(\d+)\s*(squares|tiles|spaces|cells)/i, "")
    .replace(/\b(that|which)\s+(takes|take|is|covers|fills)\s+(up)?\s*/i, "")
    .replace(/^(add|place|put|build|draw|make|create)\s+/i, "").replace(/^(a|an|the|some)\s+/i, "")
    .replace(/\s+(here|there)$/i, "").replace(/^[\s,.]+|[\s,.]+$/g, "");
  name = name ? name.charAt(0).toUpperCase() + name.slice(1) : "Feature";
  return {
    summary: `Placed ${name} at ${rectLabel({ x, y, w, h })}.`,
    features: [{ id: uid("feat"), x, y, w, h, name, kind: name.toLowerCase(), icon: iconFor(lower), color: "", description: `Details: ${request}` }],
    terrain: [], removeIds: [],
  };
}

const ICONS = [
  ["lighthouse", "🗼"], ["tower", "🗼"], ["castle", "🏰"], ["keep", "🏰"], ["fort", "🏰"], ["temple", "⛪"], ["shrine", "⛩️"], ["church", "⛪"],
  ["chapel", "⛪"], ["tavern", "🍺"], ["inn", "🍺"], ["shop", "🛒"], ["market", "🛒"], ["stall", "🛒"], ["smith", "⚒️"], ["forge", "⚒️"],
  ["ship", "⛵"], ["boat", "⛵"], ["dock", "⚓"], ["pier", "⚓"], ["bridge", "🌉"], ["tree", "🌲"], ["grove", "🌲"], ["forest", "🌲"],
  ["rock", "🪨"], ["boulder", "🪨"], ["mountain", "⛰️"], ["pond", "💧"], ["lake", "💧"], ["fountain", "⛲"], ["camp", "⛺"], ["tent", "⛺"],
  ["fire", "🔥"], ["cave", "🕳️"], ["ruin", "🏚️"], ["dragon", "🐉"], ["goblin", "👺"], ["orc", "👹"], ["lair", "🐉"], ["spider", "🕷️"],
  ["grave", "🪦"], ["crypt", "💀"], ["skull", "💀"], ["chest", "💰"], ["treasure", "💰"], ["door", "🚪"], ["gate", "🚪"], ["stair", "🪜"],
  ["ladder", "🪜"], ["statue", "🗿"], ["well", "🪣"], ["trap", "⚠️"], ["flag", "🚩"], ["altar", "🕯️"], ["library", "📚"], ["house", "🏠"],
  ["hut", "🛖"], ["cottage", "🏡"], ["shack", "🛖"], ["farm", "🌾"], ["barn", "🌾"], ["mill", "🌬️"], ["wizard", "🧙"], ["guard", "🛡️"],
];
export const iconFor = (text) => ICONS.find(([k]) => String(text).toLowerCase().includes(k))?.[1] ?? "🏠";

// ---------- Scene export ----------

/** Pixel size of one grid square in exported scene images. */
export const CELL_PX = 100;

/**
 * Builds the Scene.create() payload for a map (pure — smoke-testable).
 * Grid type 1 = square grid in Foundry v13 scene data.
 */
export function mapToSceneData(map, imgPath) {
  return {
    name: map.name,
    img: imgPath,
    width: map.cols * CELL_PX,
    height: map.rows * CELL_PX,
    padding: 0,
    grid: { type: 1, size: CELL_PX, distance: map.feetPerSquare || 5, units: "ft" },
    ownership: { default: 0 },
    flags: { tableforge: { mapId: map.id, exportedFrom: "tableforge" } },
  };
}

/** HTML for the journal that accompanies a scene export: read-alouds + feature notes. */
export function mapJournalHtml(map) {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = [`<h2>${esc(map.name)}</h2>`];
  if (map.notes) lines.push(`<p>${esc(map.notes)}</p>`);
  lines.push(`<p><em>${map.cols} × ${map.rows} squares, ${map.feetPerSquare || 5} ft per square.</em></p>`);
  for (const f of map.features) {
    lines.push(`<h3>${esc(f.icon ?? "")} ${esc(f.name)} <small>(${rectLabel(f)})</small></h3>`);
    if (f.description) lines.push(`<p>${esc(f.description).replace(/\n/g, "<br>")}</p>`);
  }
  return lines.join("\n");
}

/**
 * Renders the map to a PNG data URL via a browser canvas. Foundry client only;
 * returns null where no canvas exists (e.g. headless Node).
 */
export function renderMapDataUrl(map, cellPx = CELL_PX) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = map.cols * cellPx;
  canvas.height = map.rows * cellPx;
  const g = canvas.getContext("2d");
  if (!g) return null;
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      g.fillStyle = terrainByCode(map.terrain[y * map.cols + x]).color;
      g.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
    }
  }
  g.strokeStyle = "rgba(0,0,0,0.25)";
  g.lineWidth = 1;
  for (let x = 0; x <= map.cols; x++) { g.beginPath(); g.moveTo(x * cellPx + 0.5, 0); g.lineTo(x * cellPx + 0.5, canvas.height); g.stroke(); }
  for (let y = 0; y <= map.rows; y++) { g.beginPath(); g.moveTo(0, y * cellPx + 0.5); g.lineTo(canvas.width, y * cellPx + 0.5); g.stroke(); }
  for (const f of map.features) {
    g.fillStyle = f.color || "rgba(212,168,75,0.85)";
    g.fillRect(f.x * cellPx + 3, f.y * cellPx + 3, f.w * cellPx - 6, f.h * cellPx - 6);
    g.fillStyle = "#17110C";
    g.font = `${Math.floor(cellPx * 0.42)}px serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(f.icon || "🏠", (f.x + f.w / 2) * cellPx, (f.y + f.h / 2) * cellPx + 2);
  }
  return canvas.toDataURL("image/png");
}
