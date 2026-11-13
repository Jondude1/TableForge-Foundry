// Pure data operations for the module's stored collections: story beats,
// ideas bank, concept graph, random tables, and loot normalization.
// Everything here works on plain JSON objects (the shapes kept in module
// settings) and never touches Foundry globals, so it is smoke-testable.

import { entriesFor, lookup, rollDie, uid } from "./dice.js";

// ---------- Story beats ----------
// Beat: { id, act, title, summary, status } — array order IS the outline order.

export const BEAT_STATUSES = ["PLANNED", "IN_PLAY", "DONE"];

export function addBeat(beats, { act = "", title, summary = "", status = "PLANNED" }) {
  const beat = { id: uid("beat"), act: String(act ?? ""), title: String(title ?? "Untitled beat"), summary: String(summary ?? ""), status: BEAT_STATUSES.includes(status) ? status : "PLANNED" };
  return [...beats, beat];
}

/** Inserts a beat after index `afterIndex` (-1 inserts at the head) — the Fill-gap landing spot. */
export function insertBeat(beats, afterIndex, data) {
  const beat = { id: uid("beat"), act: String(data.act ?? ""), title: String(data.title ?? "Untitled beat"), summary: String(data.summary ?? ""), status: BEAT_STATUSES.includes(data.status) ? data.status : "PLANNED" };
  const next = [...beats];
  next.splice(Math.max(0, Math.min(afterIndex + 1, next.length)), 0, beat);
  return { beats: next, beat };
}

export function setBeatStatus(beats, id, status) {
  return beats.map((b) => (b.id === id ? { ...b, status: BEAT_STATUSES.includes(status) ? status : b.status } : b));
}

export function moveBeat(beats, id, delta) {
  const i = beats.findIndex((b) => b.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= beats.length) return beats;
  const next = [...beats];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function removeBeat(beats, id) {
  return beats.filter((b) => b.id !== id);
}

/** Groups beats by act, preserving first-appearance act order and outline order inside each act. */
export function groupBeatsByAct(beats) {
  const groups = [];
  const byAct = new Map();
  for (const b of beats) {
    const act = b.act || "";
    if (!byAct.has(act)) { byAct.set(act, []); groups.push({ act, beats: byAct.get(act) }); }
    byAct.get(act).push(b);
  }
  return groups;
}

/** A generated story card becomes beat data (donor beats keep the card body as the summary). */
export const cardToBeat = (card, act = "") => ({ act, title: card.title, summary: card.body, status: "PLANNED" });

// ---------- Ideas bank ----------
// Idea: { id, type, title, body, tags, isOwn, favorite, used, createdAt }

export function addIdea(ideas, { type = "NOTE", title, body = "", tags = "", isOwn = false }) {
  const idea = {
    id: uid("idea"), type, title: String(title ?? "Untitled"), body: String(body ?? ""), tags: String(tags ?? ""),
    isOwn: Boolean(isOwn), favorite: false, used: false, createdAt: Date.now(),
  };
  return { ideas: [idea, ...ideas], idea };
}

export function updateIdea(ideas, id, patch) {
  return ideas.map((i) => (i.id === id ? { ...i, ...patch } : i));
}

export function removeIdea(ideas, id) {
  return ideas.filter((i) => i.id !== id);
}

/** Search + type + state filtering for the Ideas tab. */
export function filterIdeas(ideas, { search = "", type = "", favoritesOnly = false, unusedOnly = false } = {}) {
  const q = search.trim().toLowerCase();
  return ideas.filter((i) => {
    if (type && i.type !== type) return false;
    if (favoritesOnly && !i.favorite) return false;
    if (unusedOnly && i.used) return false;
    if (q && !(`${i.title}\n${i.body}\n${i.tags}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

export const ideaToBeat = (idea, act = "") => ({ act, title: idea.title, summary: idea.body, status: "PLANNED" });
export const ideaToNode = (idea, x = 60, y = 60) => ({ label: idea.title, note: idea.body, kind: idea.type.toLowerCase(), x, y, ideaId: idea.id });

// ---------- Concepts graph ----------
// Graph: { nodes: [{id, label, note, kind, x, y, ideaId}], edges: [{id, from, to, label}] }

export function addNode(graph, { label, note = "", kind = "", x = 60, y = 60, ideaId = null }) {
  const node = { id: uid("node"), label: String(label ?? "Concept"), note: String(note ?? ""), kind: String(kind ?? ""), x: Math.round(x), y: Math.round(y), ideaId };
  return { graph: { nodes: [...graph.nodes, node], edges: [...graph.edges] }, node };
}

export function moveNode(graph, id, x, y) {
  return { nodes: graph.nodes.map((n) => (n.id === id ? { ...n, x: Math.round(x), y: Math.round(y) } : n)), edges: graph.edges };
}

/** Removing a node cascades to its edges (donor behavior). */
export function removeNode(graph, id) {
  return { nodes: graph.nodes.filter((n) => n.id !== id), edges: graph.edges.filter((e) => e.from !== id && e.to !== id) };
}

export function addEdge(graph, { from, to, label = "" }) {
  if (from === to) return { graph, edge: null };
  const edge = { id: uid("edge"), from, to, label: String(label ?? "") };
  return { graph: { nodes: graph.nodes, edges: [...graph.edges, edge] }, edge };
}

export function removeEdge(graph, id) {
  return { nodes: graph.nodes, edges: graph.edges.filter((e) => e.id !== id) };
}

// ---------- Random tables ----------
// Table: { id, name, sides, description, entries: [{minRoll, maxRoll, text}] }

export function buildTable({ name, sides, description = "", texts = [] }) {
  return {
    id: uid("tbl"), name: String(name ?? "Untitled table"), sides,
    description: String(description ?? ""), entries: entriesFor(sides, texts.filter((t) => String(t).trim() !== "")),
  };
}

export function setTableTexts(table, texts) {
  return { ...table, entries: entriesFor(table.sides, texts.filter((t) => String(t).trim() !== "")) };
}

/** Rolls on a table: { roll, entry } — entry is null for an empty table. */
export function rollOnTable(table) {
  const roll = rollDie(table.sides);
  return { roll, entry: table.entries.length ? lookup(table.entries, roll) ?? null : null };
}

/** Roll log entries are newest-first and capped. */
export function pushRollLog(log, entry, cap = 100) {
  return [entry, ...log].slice(0, cap);
}

// ---------- Loot (native-backed) ----------
// Normalized item: { id, actorId, name, rarity, requiresAttunement, attuned, charges }
// built by the Foundry-facing code from real Item documents.

export const ATTUNEMENT_LIMIT = 3;

export const countAttuned = (items, actorId) => items.filter((i) => i.actorId === actorId && i.attuned).length;

export const canAttune = (items, actorId) => countAttuned(items, actorId) < ATTUNEMENT_LIMIT;

/**
 * Toggles attunement on a normalized item list, enforcing the 3-item limit.
 * Returns { items, ok, reason } — when the limit blocks the change, items is
 * returned unchanged and ok is false.
 */
export function setAttuned(items, itemId, attuned) {
  const item = items.find((i) => i.id === itemId);
  if (!item) return { items, ok: false, reason: "Item not found." };
  if (attuned && !item.attuned && !canAttune(items, item.actorId)) {
    return { items, ok: false, reason: `Already attuned to ${ATTUNEMENT_LIMIT} items (the 5e limit). Unattune something first.` };
  }
  return { items: items.map((i) => (i.id === itemId ? { ...i, attuned: Boolean(attuned) } : i)), ok: true, reason: "" };
}

/** Groups normalized items by holder for the party loot sheet. */
export function groupLootByHolder(items) {
  const byHolder = new Map();
  for (const i of items) {
    if (!byHolder.has(i.actorId)) byHolder.set(i.actorId, []);
    byHolder.get(i.actorId).push(i);
  }
  return byHolder;
}
