// TableForgeApp — the module's single ApplicationV2 window (Foundry v13).
// Tabs: Forge · Tables · Story · Ideas · Concepts · Maps · Loot.
// All persistent data lives in module settings (world scope) or native
// documents; this class holds only ephemeral UI state.

import {
  GENERATABLE, IDEA_TYPES, VIBES, BEAT_STATUS,
  forgePrompt, fleshPrompt, nextBeatsPrompt, fillGapPrompt, tableEntriesPrompt,
  parseCards, cardsToEntries, offlineCards, offlineFleshOut, offlineTableEntries,
} from "./lib/generators.js";
import { aiComplete, aiReady } from "./lib/ai.js";
import { DICE, defaultCount, rangeLabel } from "./lib/dice.js";
import { TERRAINS, terrainByCode, rarityColor } from "./lib/terrains.js";
import * as S from "./lib/store.js";
import * as M from "./lib/maps.js";
import {
  MOD, getSetting, setSetting, getAiSettings, buildCtx, esc,
  createJournalDoc, createJournalFromCard, createItemFromCard, exportRollTable,
  postTableRoll, gmWhisperIds, bodyToHtml,
  buildLootData, createStashActor, transferItem, ensureFolder, pickItemType,
} from "./lib/foundry.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TABS = [
  { key: "forge", label: "Forge", icon: "fas fa-hammer" },
  { key: "tables", label: "Tables", icon: "fas fa-dice-d20" },
  { key: "story", label: "Story", icon: "fas fa-book-open" },
  { key: "ideas", label: "Ideas", icon: "fas fa-lightbulb" },
  { key: "concepts", label: "Concepts", icon: "fas fa-diagram-project" },
  { key: "maps", label: "Maps", icon: "fas fa-map" },
  { key: "loot", label: "Loot", icon: "fas fa-gem" },
];

export class TableForgeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tableforge-app",
    classes: ["tableforge-app"],
    window: { title: "TableForge", icon: "fas fa-hammer", resizable: true },
    position: { width: 940, height: 760 },
    actions: {
      tab: this.onTab,
      forgeType: this.onForgeType, vibe: this.onVibe, forgeCount: this.onForgeCount,
      generate: this.onGenerate, rerollCard: this.onRerollCard, pinCard: this.onPinCard,
      saveCard: this.onSaveCard, fleshOut: this.onFleshOut,
      tableNew: this.onTableNew, tableSelect: this.onTableSelect, tableSaveEntries: this.onTableSaveEntries,
      tableGenEntries: this.onTableGenEntries, tableRoll: this.onTableRoll, tableDelete: this.onTableDelete,
      tableExport: this.onTableExport, tray: this.onTray,
      campaignSave: this.onCampaignSave, beatAdd: this.onBeatAdd, beatUp: this.onBeatUp,
      beatDown: this.onBeatDown, beatDelete: this.onBeatDelete, beatSuggest: this.onBeatSuggest,
      beatGap: this.onBeatGap, pendingAdd: this.onPendingAdd, pendingDismiss: this.onPendingDismiss,
      ideaAdd: this.onIdeaAdd, ideaFav: this.onIdeaFav, ideaUsed: this.onIdeaUsed, ideaDelete: this.onIdeaDelete,
      ideaToBeat: this.onIdeaToBeat, ideaToConcept: this.onIdeaToConcept, ideaToLoot: this.onIdeaToLoot,
      ideaToJournal: this.onIdeaToJournal,
      nodeAdd: this.onNodeAdd, nodeSave: this.onNodeSave, nodeDelete: this.onNodeDelete,
      edgeAdd: this.onEdgeAdd, edgeDelete: this.onEdgeDelete,
      mapNew: this.onMapNew, mapSelect: this.onMapSelect, mapDelete: this.onMapDelete,
      mapPaint: this.onMapPaint, mapRequest: this.onMapRequest, mapUndo: this.onMapUndo,
      mapNotesSave: this.onMapNotesSave, featureDelete: this.onFeatureDelete,
      mapExportScene: this.onMapExportScene,
      stashCreate: this.onStashCreate, itemAttune: this.onItemAttune, itemMove: this.onItemMove,
    },
  };

  static PARTS = {
    main: { template: "modules/tableforge/templates/app.hbs" },
  };

  constructor(options = {}) {
    super(options);
    this.tab = "forge";
    this.forgeState = { type: "NPC", vibes: new Set(), count: 4, cards: [], busy: false, steer: "" };
    this.tablesState = { selectedId: null, lastRoll: null };
    this.storyState = { pending: null };
    this.ideasState = { search: "", type: "", favOnly: false, unusedOnly: false };
    this.conceptsState = { selectedId: null };
    this.mapsState = { selectedId: null, sel: { x: 0, y: 0, w: 1, h: 1 }, paintCode: null, featureId: null, undo: [] };
    this.lootState = {};
  }

  // ---------- shared helpers ----------

  _el(sel) { return this.element?.querySelector(sel) ?? null; }
  _val(sel) { return this._el(sel)?.value?.trim() ?? ""; }

  async _generateCards(prompt, count) {
    // AI first (if configured), offline on any failure — the module's core rule.
    const settings = getAiSettings();
    if (aiReady(settings)) {
      try {
        const raw = await aiComplete(settings, prompt.system, prompt.user, prompt.maxTokens);
        return { cards: parseCards(raw), ai: true };
      } catch (err) {
        console.warn("TableForge | AI generation failed, falling back to offline:", err);
        ui.notifications.warn(`TableForge: AI unavailable (${err.message}) — used offline generation.`);
      }
    }
    return { cards: null, ai: false };
  }

  async _forgeCards(type, count, steer, avoid) {
    const ctx = buildCtx();
    const prompt = forgePrompt(ctx, type, count, steer, avoid);
    const res = await this._generateCards(prompt, count);
    return res.cards ?? offlineCards(type, count);
  }

  // ---------- context ----------

  async _prepareContext(options) {
    const ctx = {
      tabs: TABS.map((t) => ({ ...t, active: t.key === this.tab })),
      tab: this.tab,
      aiReady: aiReady(getAiSettings()),
    };
    for (const t of TABS) ctx[`is_${t.key}`] = t.key === this.tab;
    const builder = this[`_ctx_${this.tab}`];
    if (builder) Object.assign(ctx, builder.call(this));
    return ctx;
  }

  _ctx_forge() {
    const fs = this.forgeState;
    return {
      forgeTypes: GENERATABLE.map((t) => ({ key: t, label: IDEA_TYPES[t].label, active: t === fs.type })),
      vibes: VIBES.map((v) => ({ name: v, on: fs.vibes.has(v) })),
      counts: [1, 3, 4, 6, 8].map((n) => ({ n, active: n === fs.count })),
      steer: fs.steer,
      busy: fs.busy,
      cards: fs.cards.map((c) => ({ ...c, tagList: String(c.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean) })),
      hasCards: fs.cards.length > 0,
    };
  }

  _ctx_tables() {
    const tables = getSetting("tables") ?? [];
    const ts = this.tablesState;
    if (!ts.selectedId && tables.length) ts.selectedId = tables[0].id;
    const sel = tables.find((t) => t.id === ts.selectedId) ?? null;
    return {
      tables: tables.map((t) => ({ id: t.id, name: t.name, sides: t.sides, count: t.entries.length, active: t.id === ts.selectedId })),
      selTable: sel && {
        ...sel,
        entriesView: sel.entries.map((e) => ({ label: rangeLabel(e.minRoll, e.maxRoll, sel.sides), text: e.text })),
        entriesText: sel.entries.map((e) => e.text).join("\n"),
      },
      dice: DICE,
      newCounts: [4, 6, 8, 10, 12, 20, 100].map((n) => ({ n })),
      rollLog: (getSetting("rollLog") ?? []).slice(0, 25),
      lastRoll: ts.lastRoll,
    };
  }

  _ctx_story() {
    const beats = getSetting("beats") ?? [];
    const groups = S.groupBeatsByAct(beats).map((g) => ({
      act: g.act,
      actLabel: g.act || "No act",
      beats: g.beats.map((b) => ({
        ...b,
        globalIndex: beats.findIndex((x) => x.id === b.id),
        statusLabel: BEAT_STATUS[b.status] ?? "Planned",
        statuses: S.BEAT_STATUSES.map((k) => ({ k, label: BEAT_STATUS[k], sel: k === b.status })),
      })),
    }));
    const pending = this.storyState.pending;
    return {
      campaign: getSetting("campaign") ?? { name: "", premise: "", setting: "", tone: "" },
      groups,
      hasBeats: beats.length > 0,
      pending: pending && { mode: pending.mode, isNext: pending.mode === "next", cards: pending.cards },
    };
  }

  _ctx_ideas() {
    const all = getSetting("ideas") ?? [];
    const f = this.ideasState;
    const filtered = S.filterIdeas(all, { search: f.search, type: f.type, favoritesOnly: f.favOnly, unusedOnly: f.unusedOnly });
    return {
      ideas: filtered.map((i) => ({ ...i, typeLabel: IDEA_TYPES[i.type]?.label ?? i.type, tagList: String(i.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean) })),
      total: all.length,
      shown: filtered.length,
      filter: { ...f },
      typeOptions: [{ k: "", label: "All types" }, ...Object.entries(IDEA_TYPES).map(([k, v]) => ({ k, label: v.label, sel: k === f.type }))],
      addTypeOptions: Object.entries(IDEA_TYPES).map(([k, v]) => ({ k, label: v.singular })),
    };
  }

  _conceptsSvg(graph) {
    const sel = this.conceptsState.selectedId;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const parts = ['<svg id="tf-concepts-svg" viewBox="0 0 900 520" xmlns="http://www.w3.org/2000/svg">'];
    parts.push('<rect x="0" y="0" width="900" height="520" fill="#1d150e" data-board="1"/>');
    for (const e of graph.edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) continue;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      parts.push(`<g class="tf-edge" data-edge="${e.id}" data-from="${e.from}" data-to="${e.to}"><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#8a6d3b" stroke-width="1.5"/>${e.label ? `<text x="${mx}" y="${my - 4}" fill="#c9b98d" font-size="11" text-anchor="middle">${esc(e.label)}</text>` : ""}</g>`);
    }
    for (const n of graph.nodes) {
      const isSel = n.id === sel;
      parts.push(
        `<g class="tf-node" data-node="${n.id}" transform="translate(${n.x},${n.y})" cursor="grab">` +
        `<circle r="26" fill="#2a2018" stroke="${isSel ? "#f0d492" : "#d4a84b"}" stroke-width="${isSel ? 3 : 1.5}"/>` +
        `<text y="-2" fill="#e8dcc0" font-size="11" text-anchor="middle" pointer-events="none">${esc(String(n.label).slice(0, 16))}</text>` +
        `<text y="12" fill="#9b8a67" font-size="8.5" text-anchor="middle" pointer-events="none">${esc(String(n.kind ?? "").slice(0, 18))}</text></g>`,
      );
    }
    parts.push("</svg>");
    return parts.join("");
  }

  _ctx_concepts() {
    const graph = getSetting("concepts") ?? { nodes: [], edges: [] };
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const selNode = graph.nodes.find((n) => n.id === this.conceptsState.selectedId) ?? null;
    return {
      svg: this._conceptsSvg(graph),
      nodes: graph.nodes,
      edges: graph.edges.map((e) => ({ ...e, fromLabel: byId.get(e.from)?.label ?? "?", toLabel: byId.get(e.to)?.label ?? "?" })),
      selNode,
      hasNodes: graph.nodes.length > 0,
    };
  }

  _mapSvg(map) {
    const CELL = 28;
    const ms = this.mapsState;
    const parts = [`<svg id="tf-map-svg" viewBox="0 0 ${map.cols * CELL} ${map.rows * CELL}" xmlns="http://www.w3.org/2000/svg" data-cell="${CELL}">`];
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        const t = terrainByCode(map.terrain[y * map.cols + x]);
        parts.push(`<rect data-cellx="${x}" data-celly="${y}" x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}" fill="${t.color}" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>`);
      }
    }
    for (const f of map.features) {
      const isSel = f.id === ms.featureId;
      parts.push(
        `<g class="tf-feature" data-feature="${f.id}" transform="translate(${f.x * CELL},${f.y * CELL})" cursor="grab">` +
        `<rect x="1.5" y="1.5" width="${f.w * CELL - 3}" height="${f.h * CELL - 3}" rx="3" fill="${f.color || "rgba(212,168,75,0.8)"}" fill-opacity="0.85" stroke="${isSel ? "#ffffff" : "#17110c"}" stroke-width="${isSel ? 2 : 1}"/>` +
        `<text x="${(f.w * CELL) / 2}" y="${(f.h * CELL) / 2 + 5}" font-size="14" text-anchor="middle" pointer-events="none">${esc(f.icon || "🏠")}</text></g>`,
      );
    }
    const s = ms.sel;
    parts.push(`<rect id="tf-map-sel" x="${s.x * CELL}" y="${s.y * CELL}" width="${s.w * CELL}" height="${s.h * CELL}" fill="rgba(240,212,146,0.18)" stroke="#f0d492" stroke-width="1.5" stroke-dasharray="4 3" pointer-events="none"/>`);
    parts.push("</svg>");
    return parts.join("");
  }

  _ctx_maps() {
    const maps = getSetting("maps") ?? [];
    const ms = this.mapsState;
    if (!ms.selectedId && maps.length) ms.selectedId = maps[0].id;
    const map = maps.find((m) => m.id === ms.selectedId) ?? null;
    const selFeature = map?.features.find((f) => f.id === ms.featureId) ?? null;
    return {
      maps: maps.map((m) => ({ id: m.id, name: m.name, dims: `${m.cols}×${m.rows}`, active: m.id === ms.selectedId })),
      map: map && {
        ...map,
        svg: this._mapSvg(map),
        selLabel: M.rectLabel(ms.sel),
        palette: TERRAINS.map((t) => ({ ...t, active: ms.paintCode === t.code })),
        painting: Boolean(ms.paintCode),
        selFeature: selFeature && { ...selFeature, atLabel: M.rectLabel(selFeature) },
        features: map.features.map((f) => ({ ...f, atLabel: M.rectLabel(f), active: f.id === ms.featureId })),
        canUndo: ms.undo.length > 0,
      },
      baseTerrains: TERRAINS.map((t) => ({ code: t.code, label: t.label })),
    };
  }

  _ctx_loot() {
    const { holders, items } = buildLootData();
    return {
      holders: holders.map((h) => ({
        ...h,
        attunedCount: S.countAttuned(items, h.actorId),
        items: h.items.map((i) => ({ ...i, rarityStyle: `color:${rarityColor(i.rarity)}` })),
      })),
      hasStash: holders.some((h) => h.isStash),
      moveTargets: holders.map((h) => ({ actorId: h.actorId, name: h.name })),
      isEmpty: holders.length === 0,
    };
  }

  // ---------- render-time wiring (change events + board pointer control) ----------

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;

    root.querySelectorAll("[data-beat-status]").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const beats = S.setBeatStatus(getSetting("beats") ?? [], sel.dataset.beatStatus, sel.value);
        await setSetting("beats", beats);
        this.render();
      });
    });
    root.querySelectorAll("[data-idea-filter]").forEach((input) => {
      input.addEventListener("change", () => {
        const k = input.dataset.ideaFilter;
        this.ideasState[k] = input.type === "checkbox" ? input.checked : input.value;
        this.render();
      });
    });

    const board = root.querySelector("#tf-concepts-svg");
    if (board) this._wireConceptsBoard(board);
    const grid = root.querySelector("#tf-map-svg");
    if (grid) this._wireMapGrid(grid);
  }

  _svgPoint(svg, evt) {
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return { x: ((evt.clientX - r.left) / r.width) * vb.width, y: ((evt.clientY - r.top) / r.height) * vb.height };
  }

  _wireConceptsBoard(svg) {
    let drag = null;
    svg.addEventListener("pointerdown", (evt) => {
      const g = evt.target.closest("[data-node]");
      if (!g) return;
      const p = this._svgPoint(svg, evt);
      const graph = getSetting("concepts");
      const node = graph.nodes.find((n) => n.id === g.dataset.node);
      if (!node) return;
      drag = { id: node.id, dx: p.x - node.x, dy: p.y - node.y, moved: false, el: g };
      svg.setPointerCapture(evt.pointerId);
    });
    svg.addEventListener("pointermove", (evt) => {
      if (!drag) return;
      const p = this._svgPoint(svg, evt);
      const x = Math.round(Math.max(20, Math.min(880, p.x - drag.dx)));
      const y = Math.round(Math.max(20, Math.min(500, p.y - drag.dy)));
      drag.moved = true;
      drag.el.setAttribute("transform", `translate(${x},${y})`);
      drag.x = x; drag.y = y;
      svg.querySelectorAll(`[data-from="${drag.id}"], [data-to="${drag.id}"]`).forEach((edgeEl) => {
        const line = edgeEl.querySelector("line");
        const text = edgeEl.querySelector("text");
        const graph = getSetting("concepts");
        const a = graph.nodes.find((n) => n.id === edgeEl.dataset.from);
        const b = graph.nodes.find((n) => n.id === edgeEl.dataset.to);
        const ax = edgeEl.dataset.from === drag.id ? x : a.x, ay = edgeEl.dataset.from === drag.id ? y : a.y;
        const bx = edgeEl.dataset.to === drag.id ? x : b.x, by = edgeEl.dataset.to === drag.id ? y : b.y;
        line.setAttribute("x1", ax); line.setAttribute("y1", ay);
        line.setAttribute("x2", bx); line.setAttribute("y2", by);
        if (text) { text.setAttribute("x", (ax + bx) / 2); text.setAttribute("y", (ay + by) / 2 - 4); }
      });
    });
    svg.addEventListener("pointerup", async () => {
      if (!drag) return;
      const { id, x, y, moved } = drag;
      drag = null;
      this.conceptsState.selectedId = id;
      if (moved && x != null) {
        await setSetting("concepts", S.moveNode(getSetting("concepts"), id, x, y));
      }
      this.render();
    });
    svg.addEventListener("dblclick", async (evt) => {
      if (evt.target.closest("[data-node]")) return;
      const p = this._svgPoint(svg, evt);
      const { graph, node } = S.addNode(getSetting("concepts"), { label: "New concept", x: p.x, y: p.y });
      this.conceptsState.selectedId = node.id;
      await setSetting("concepts", graph);
      this.render();
    });
  }

  _wireMapGrid(svg) {
    const CELL = Number(svg.dataset.cell || 28);
    let drag = null;
    const cellOf = (evt) => {
      const p = this._svgPoint(svg, evt);
      return { x: Math.floor(p.x / CELL), y: Math.floor(p.y / CELL) };
    };
    const currentMap = () => (getSetting("maps") ?? []).find((m) => m.id === this.mapsState.selectedId);
    svg.addEventListener("pointerdown", (evt) => {
      const map = currentMap();
      if (!map) return;
      const featEl = evt.target.closest("[data-feature]");
      const c = cellOf(evt);
      if (c.x < 0 || c.y < 0 || c.x >= map.cols || c.y >= map.rows) return;
      if (featEl && !this.mapsState.paintCode) {
        const f = map.features.find((x) => x.id === featEl.dataset.feature);
        if (f) {
          drag = { mode: "feature", id: f.id, grabDx: c.x - f.x, grabDy: c.y - f.y, el: featEl, moved: false };
          svg.setPointerCapture(evt.pointerId);
          return;
        }
      }
      drag = { mode: this.mapsState.paintCode ? "paint" : "select", ax: c.x, ay: c.y, cells: new Set() };
      if (drag.mode === "paint") this._paintCellLive(svg, map, c.x, c.y, drag.cells);
      svg.setPointerCapture(evt.pointerId);
    });
    svg.addEventListener("pointermove", (evt) => {
      if (!drag) return;
      const map = currentMap();
      if (!map) return;
      const c = cellOf(evt);
      if (drag.mode === "select") {
        const r = M.spanning(drag.ax, drag.ay, Math.max(0, Math.min(map.cols - 1, c.x)), Math.max(0, Math.min(map.rows - 1, c.y)));
        const selEl = svg.querySelector("#tf-map-sel");
        if (selEl) {
          selEl.setAttribute("x", r.x * CELL); selEl.setAttribute("y", r.y * CELL);
          selEl.setAttribute("width", r.w * CELL); selEl.setAttribute("height", r.h * CELL);
        }
        drag.rect = r;
      } else if (drag.mode === "paint") {
        if (c.x >= 0 && c.y >= 0 && c.x < map.cols && c.y < map.rows) this._paintCellLive(svg, map, c.x, c.y, drag.cells);
      } else if (drag.mode === "feature") {
        const f = map.features.find((x) => x.id === drag.id);
        if (!f) return;
        const nx = Math.max(0, Math.min(map.cols - f.w, c.x - drag.grabDx));
        const ny = Math.max(0, Math.min(map.rows - f.h, c.y - drag.grabDy));
        drag.nx = nx; drag.ny = ny; drag.moved = true;
        drag.el.setAttribute("transform", `translate(${nx * CELL},${ny * CELL})`);
      }
    });
    svg.addEventListener("pointerup", async () => {
      if (!drag) return;
      const map = currentMap();
      const d = drag;
      drag = null;
      if (!map) return;
      if (d.mode === "select") {
        if (d.rect) this.mapsState.sel = d.rect;
        this.mapsState.featureId = null;
        this.render();
      } else if (d.mode === "paint") {
        if (d.cells.size) {
          this._pushMapUndo(map);
          const terrain = terrainByCode(this.mapsState.paintCode);
          const cells = [...d.cells].map((k) => k.split(",").map(Number));
          const next = { ...map, terrain: M.paint(map, [{ terrain, cells }]) };
          await this._saveMap(next);
        }
        this.render();
      } else if (d.mode === "feature") {
        this.mapsState.featureId = d.id;
        if (d.moved && d.nx != null) {
          this._pushMapUndo(map);
          const next = structuredClone(map);
          const f = next.features.find((x) => x.id === d.id);
          f.x = d.nx; f.y = d.ny;
          await this._saveMap(next);
        }
        this.render();
      }
    });
  }

  _paintCellLive(svg, map, x, y, cellsSet) {
    const key = `${x},${y}`;
    if (cellsSet.has(key)) return;
    cellsSet.add(key);
    const rect = svg.querySelector(`[data-cellx="${x}"][data-celly="${y}"]`);
    if (rect) rect.setAttribute("fill", terrainByCode(this.mapsState.paintCode).color);
  }

  _pushMapUndo(map) {
    const ms = this.mapsState;
    ms.undo.push(JSON.stringify({ terrain: map.terrain, features: map.features }));
    if (ms.undo.length > 50) ms.undo.shift();
  }

  async _saveMap(next) {
    const maps = (getSetting("maps") ?? []).map((m) => (m.id === next.id ? next : m));
    await setSetting("maps", maps);
  }

  // ---------- actions: global ----------

  static async onTab(event, target) {
    if (this.tab === "forge") this.forgeState.steer = this._val("#tf-steer") || this.forgeState.steer;
    this.tab = target.dataset.tab;
    this.render();
  }

  // ---------- actions: Forge ----------

  static async onForgeType(event, target) {
    this.forgeState.type = target.dataset.type;
    this.render();
  }

  static async onVibe(event, target) {
    const v = target.dataset.vibe;
    this.forgeState.vibes.has(v) ? this.forgeState.vibes.delete(v) : this.forgeState.vibes.add(v);
    this.render();
  }

  static async onForgeCount(event, target) {
    this.forgeState.count = Number(target.dataset.count);
    this.render();
  }

  _steerText() {
    const fs = this.forgeState;
    return [fs.steer, ...fs.vibes].filter(Boolean).join("; ");
  }

  static async onGenerate(event, target) {
    const fs = this.forgeState;
    fs.steer = this._val("#tf-steer");
    const kept = fs.cards.filter((c) => c.pinned);
    const need = fs.count - kept.length;
    if (need <= 0) {
      ui.notifications.info("TableForge: every slot is pinned. Unpin a card or raise the count.");
      return;
    }
    fs.busy = true;
    await this.render();
    try {
      const fresh = await this._forgeCards(fs.type, need, this._steerText(), fs.cards.map((c) => c.title));
      fs.cards = [...kept, ...fresh];
    } finally {
      fs.busy = false;
      this.render();
    }
  }

  static async onRerollCard(event, target) {
    const fs = this.forgeState;
    fs.steer = this._val("#tf-steer") || fs.steer;
    const idx = fs.cards.findIndex((c) => c.key === target.dataset.key);
    if (idx < 0) return;
    const avoid = fs.cards.filter((_, i) => i !== idx).map((c) => c.title);
    const [fresh] = await this._forgeCards(fs.type, 1, this._steerText(), avoid);
    if (fresh) fs.cards[idx] = fresh;
    this.render();
  }

  static async onPinCard(event, target) {
    const card = this.forgeState.cards.find((c) => c.key === target.dataset.key);
    if (card) card.pinned = !card.pinned;
    this.render();
  }

  static async onSaveCard(event, target) {
    const fs = this.forgeState;
    const card = fs.cards.find((c) => c.key === target.dataset.key);
    if (!card || card.savedName) return;
    const doc = fs.type === "MAGIC_ITEM" ? await createItemFromCard(card) : await createJournalFromCard(card);
    if (!doc) return;
    card.savedName = doc.name;
    const { ideas } = S.addIdea(getSetting("ideas") ?? [], { type: fs.type, title: card.title, body: card.body, tags: card.tags });
    await setSetting("ideas", ideas);
    ui.notifications.info(`TableForge: saved "${doc.name}" to the world and the Ideas bank.`);
    this.render();
  }

  static async onFleshOut(event, target) {
    const fs = this.forgeState;
    const name = this._val("#tf-flesh-name");
    const notes = this._val("#tf-flesh-notes");
    const versions = Number(this._el("#tf-flesh-versions")?.value ?? 1);
    fs.busy = true;
    await this.render();
    try {
      const settings = getAiSettings();
      let cards = null;
      if (aiReady(settings)) {
        try {
          const prompt = fleshPrompt(buildCtx(), fs.type, name, notes, versions);
          const raw = await aiComplete(settings, prompt.system, prompt.user, prompt.maxTokens);
          cards = parseCards(raw).slice(0, versions);
          if (name.trim()) cards = cards.map((c) => ({ ...c, title: name.trim() }));
        } catch (err) {
          console.warn("TableForge | AI flesh-out failed, falling back to offline:", err);
        }
      }
      fs.cards = cards ?? offlineFleshOut(fs.type, name, notes, versions);
    } finally {
      fs.busy = false;
      this.render();
    }
  }

  // ---------- actions: Tables ----------

  _selectedTable() {
    return (getSetting("tables") ?? []).find((t) => t.id === this.tablesState.selectedId) ?? null;
  }

  async _saveTable(table) {
    const tables = (getSetting("tables") ?? []).map((t) => (t.id === table.id ? table : t));
    await setSetting("tables", tables);
  }

  static async onTableNew(event, target) {
    const name = this._val("#tf-tbl-name") || "Untitled table";
    const sides = Number(this._el("#tf-tbl-sides")?.value ?? 20);
    const description = this._val("#tf-tbl-desc");
    const count = Math.max(1, Number(this._el("#tf-tbl-count")?.value ?? defaultCount(sides)) || defaultCount(sides));
    const prefill = this._el("#tf-tbl-prefill")?.checked ?? true;
    const texts = prefill ? offlineTableEntries(name, count) : [];
    const table = S.buildTable({ name, sides, description, texts });
    await setSetting("tables", [...(getSetting("tables") ?? []), table]);
    this.tablesState.selectedId = table.id;
    this.render();
  }

  static async onTableSelect(event, target) {
    this.tablesState.selectedId = target.dataset.id;
    this.render();
  }

  static async onTableSaveEntries(event, target) {
    const sel = this._selectedTable();
    if (!sel) return;
    const texts = (this._el("#tf-tbl-entries")?.value ?? "").split("\n");
    await this._saveTable(S.setTableTexts(sel, texts));
    ui.notifications.info(`TableForge: "${sel.name}" saved with ${texts.filter((t) => t.trim()).length} entries.`);
    this.render();
  }

  static async onTableGenEntries(event, target) {
    const sel = this._selectedTable();
    if (!sel) return;
    const count = sel.entries.length || defaultCount(sel.sides);
    const settings = getAiSettings();
    let entries = null;
    if (aiReady(settings)) {
      try {
        const prompt = tableEntriesPrompt(buildCtx(), sel.name, sel.description, count);
        const raw = await aiComplete(settings, prompt.system, prompt.user, prompt.maxTokens);
        entries = cardsToEntries(parseCards(raw), count);
      } catch (err) {
        console.warn("TableForge | AI table entries failed, falling back to offline:", err);
      }
    }
    entries ??= offlineTableEntries(sel.name, count);
    const box = this._el("#tf-tbl-entries");
    if (box) box.value = entries.join("\n");
    ui.notifications.info("TableForge: entries generated into the editor — review, then Save entries.");
  }

  static async onTableRoll(event, target) {
    const sel = this._selectedTable();
    if (!sel) return;
    const { roll, entry } = S.rollOnTable(sel);
    this.tablesState.lastRoll = { table: sel.name, sides: sel.sides, roll, text: entry?.text ?? null };
    await postTableRoll(sel, roll, entry);
    const log = S.pushRollLog(getSetting("rollLog") ?? [], { table: sel.name, sides: sel.sides, roll, text: entry?.text ?? "", at: Date.now() });
    await setSetting("rollLog", log);
    this.render();
  }

  static async onTableDelete(event, target) {
    const sel = this._selectedTable();
    if (!sel) return;
    await setSetting("tables", (getSetting("tables") ?? []).filter((t) => t.id !== sel.id));
    this.tablesState.selectedId = null;
    ui.notifications.info(`TableForge: deleted table "${sel.name}".`);
    this.render();
  }

  static async onTableExport(event, target) {
    const sel = this._selectedTable();
    if (!sel) return;
    const doc = await exportRollTable(sel);
    if (doc) ui.notifications.info(`TableForge: created native RollTable "${doc.name}" (GM-only).`);
    this.render();
  }

  static async onTray(event, target) {
    const sides = Number(target.dataset.sides);
    const roll = await new Roll(`1d${sides}`).evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ alias: "TableForge" }),
      whisper: gmWhisperIds(),
    });
  }

  // ---------- actions: Story ----------

  static async onCampaignSave(event, target) {
    await setSetting("campaign", {
      name: this._val("#tf-camp-name"),
      premise: this._val("#tf-camp-premise"),
      setting: this._val("#tf-camp-setting"),
      tone: this._val("#tf-camp-tone"),
    });
    ui.notifications.info("TableForge: campaign saved. The Forge and AI prompts use it as context.");
    this.render();
  }

  static async onBeatAdd(event, target) {
    const beats = S.addBeat(getSetting("beats") ?? [], {
      title: this._val("#tf-beat-title") || "Untitled beat",
      act: this._val("#tf-beat-act"),
      summary: this._val("#tf-beat-summary"),
    });
    await setSetting("beats", beats);
    this.render();
  }

  static async onBeatUp(event, target) {
    await setSetting("beats", S.moveBeat(getSetting("beats") ?? [], target.dataset.id, -1));
    this.render();
  }

  static async onBeatDown(event, target) {
    await setSetting("beats", S.moveBeat(getSetting("beats") ?? [], target.dataset.id, 1));
    this.render();
  }

  static async onBeatDelete(event, target) {
    await setSetting("beats", S.removeBeat(getSetting("beats") ?? [], target.dataset.id));
    this.render();
  }

  async _beatCards(mode, afterIndex) {
    const beats = getSetting("beats") ?? [];
    const steer = this._val("#tf-story-steer");
    const ctx = buildCtx();
    const settings = getAiSettings();
    let cards = null;
    if (aiReady(settings)) {
      try {
        const prompt = mode === "next"
          ? nextBeatsPrompt(ctx, steer)
          : fillGapPrompt(ctx, beats[afterIndex] ?? null, beats[afterIndex + 1] ?? null, steer);
        const raw = await aiComplete(settings, prompt.system, prompt.user, prompt.maxTokens);
        cards = parseCards(raw);
      } catch (err) {
        console.warn("TableForge | AI beat suggestion failed, falling back to offline:", err);
      }
    }
    cards ??= offlineCards("STORY_BEAT", mode === "next" ? 4 : 3);
    this.storyState.pending = { mode, afterIndex, cards };
    this.render();
  }

  static async onBeatSuggest(event, target) {
    const beats = getSetting("beats") ?? [];
    await this._beatCards("next", beats.length - 1);
  }

  static async onBeatGap(event, target) {
    await this._beatCards("gap", Number(target.dataset.index));
  }

  static async onPendingAdd(event, target) {
    const pending = this.storyState.pending;
    if (!pending) return;
    const card = pending.cards.find((c) => c.key === target.dataset.key);
    if (!card) return;
    const beats = getSetting("beats") ?? [];
    const act = pending.mode === "gap" ? (beats[pending.afterIndex]?.act ?? "") : "";
    const data = S.cardToBeat(card, act);
    const next = pending.mode === "gap" ? S.insertBeat(beats, pending.afterIndex, data).beats : S.addBeat(beats, data);
    await setSetting("beats", next);
    pending.cards = pending.cards.filter((c) => c.key !== card.key);
    if (!pending.cards.length) this.storyState.pending = null;
    this.render();
  }

  static async onPendingDismiss(event, target) {
    this.storyState.pending = null;
    this.render();
  }

  // ---------- actions: Ideas ----------

  _ideaById(id) {
    return (getSetting("ideas") ?? []).find((i) => i.id === id) ?? null;
  }

  static async onIdeaAdd(event, target) {
    const { ideas } = S.addIdea(getSetting("ideas") ?? [], {
      type: this._el("#tf-idea-type")?.value ?? "NOTE",
      title: this._val("#tf-idea-title") || "Untitled idea",
      body: this._val("#tf-idea-body"),
      tags: this._val("#tf-idea-tags"),
      isOwn: true,
    });
    await setSetting("ideas", ideas);
    this.render();
  }

  static async onIdeaFav(event, target) {
    const idea = this._ideaById(target.dataset.id);
    if (!idea) return;
    await setSetting("ideas", S.updateIdea(getSetting("ideas") ?? [], idea.id, { favorite: !idea.favorite }));
    this.render();
  }

  static async onIdeaUsed(event, target) {
    const idea = this._ideaById(target.dataset.id);
    if (!idea) return;
    await setSetting("ideas", S.updateIdea(getSetting("ideas") ?? [], idea.id, { used: !idea.used }));
    this.render();
  }

  static async onIdeaDelete(event, target) {
    await setSetting("ideas", S.removeIdea(getSetting("ideas") ?? [], target.dataset.id));
    this.render();
  }

  static async onIdeaToBeat(event, target) {
    const idea = this._ideaById(target.dataset.id);
    if (!idea) return;
    await setSetting("beats", S.addBeat(getSetting("beats") ?? [], S.ideaToBeat(idea)));
    ui.notifications.info(`TableForge: "${idea.title}" added to the Story outline.`);
  }

  static async onIdeaToConcept(event, target) {
    const idea = this._ideaById(target.dataset.id);
    if (!idea) return;
    const graph = getSetting("concepts") ?? { nodes: [], edges: [] };
    const n = graph.nodes.length;
    const { graph: next } = S.addNode(graph, S.ideaToNode(idea, 90 + (n % 6) * 40, 90 + (n % 5) * 34));
    await setSetting("concepts", next);
    ui.notifications.info(`TableForge: "${idea.title}" added to the Concepts board.`);
  }

  static async onIdeaToLoot(event, target) {
    const idea = this._ideaById(target.dataset.id);
    if (!idea) return;
    const stash = await createStashActor();
    if (!stash) return;
    await stash.createEmbeddedDocuments("Item", [{
      name: idea.title,
      type: pickItemType(),
      flags: { [MOD]: { body: idea.body, tags: idea.tags, source: "tableforge" } },
    }]);
    ui.notifications.info(`TableForge: "${idea.title}" created in the Party Stash.`);
    this.render();
  }

  static async onIdeaToJournal(event, target) {
    const idea = this._ideaById(target.dataset.id);
    if (!idea) return;
    const doc = await createJournalFromCard(idea);
    if (doc) ui.notifications.info(`TableForge: journal "${doc.name}" created (GM-only).`);
  }

  // ---------- actions: Concepts ----------

  static async onNodeAdd(event, target) {
    const graph = getSetting("concepts") ?? { nodes: [], edges: [] };
    const n = graph.nodes.length;
    const { graph: next, node } = S.addNode(graph, {
      label: this._val("#tf-node-label") || "New concept",
      kind: this._val("#tf-node-kind"),
      note: this._val("#tf-node-note"),
      x: 90 + (n % 6) * 40, y: 90 + (n % 5) * 34,
    });
    this.conceptsState.selectedId = node.id;
    await setSetting("concepts", next);
    this.render();
  }

  static async onNodeSave(event, target) {
    const id = this.conceptsState.selectedId;
    if (!id) return;
    const graph = getSetting("concepts") ?? { nodes: [], edges: [] };
    const next = {
      nodes: graph.nodes.map((n) => (n.id === id ? { ...n, label: this._val("#tf-node-label") || n.label, kind: this._val("#tf-node-kind"), note: this._val("#tf-node-note") } : n)),
      edges: graph.edges,
    };
    await setSetting("concepts", next);
    this.render();
  }

  static async onNodeDelete(event, target) {
    const id = this.conceptsState.selectedId;
    if (!id) return;
    await setSetting("concepts", S.removeNode(getSetting("concepts") ?? { nodes: [], edges: [] }, id));
    this.conceptsState.selectedId = null;
    this.render();
  }

  static async onEdgeAdd(event, target) {
    const graph = getSetting("concepts") ?? { nodes: [], edges: [] };
    const { graph: next, edge } = S.addEdge(graph, {
      from: this._el("#tf-edge-from")?.value,
      to: this._el("#tf-edge-to")?.value,
      label: this._val("#tf-edge-label"),
    });
    if (!edge) {
      ui.notifications.warn("TableForge: a concept can't link to itself.");
      return;
    }
    await setSetting("concepts", next);
    this.render();
  }

  static async onEdgeDelete(event, target) {
    await setSetting("concepts", S.removeEdge(getSetting("concepts") ?? { nodes: [], edges: [] }, target.dataset.id));
    this.render();
  }

  // ---------- actions: Maps ----------

  _currentMap() {
    return (getSetting("maps") ?? []).find((m) => m.id === this.mapsState.selectedId) ?? null;
  }

  static async onMapNew(event, target) {
    const name = this._val("#tf-map-name") || "Untitled map";
    const cols = Math.max(4, Math.min(40, Number(this._el("#tf-map-cols")?.value ?? 16) || 16));
    const rows = Math.max(4, Math.min(40, Number(this._el("#tf-map-rows")?.value ?? 12) || 12));
    const base = this._el("#tf-map-base")?.value ?? "g";
    const feet = Math.max(1, Number(this._el("#tf-map-feet")?.value ?? 5) || 5);
    const map = M.newMap(name, cols, rows, base, feet);
    await setSetting("maps", [...(getSetting("maps") ?? []), map]);
    this.mapsState.selectedId = map.id;
    this.mapsState.sel = { x: 0, y: 0, w: 1, h: 1 };
    this.mapsState.featureId = null;
    this.mapsState.undo = [];
    this.render();
  }

  static async onMapSelect(event, target) {
    this.mapsState.selectedId = target.dataset.id;
    this.mapsState.sel = { x: 0, y: 0, w: 1, h: 1 };
    this.mapsState.featureId = null;
    this.mapsState.undo = [];
    this.render();
  }

  static async onMapDelete(event, target) {
    const map = this._currentMap();
    if (!map) return;
    await setSetting("maps", (getSetting("maps") ?? []).filter((m) => m.id !== map.id));
    this.mapsState.selectedId = null;
    ui.notifications.info(`TableForge: deleted map "${map.name}".`);
    this.render();
  }

  static async onMapPaint(event, target) {
    const code = target.dataset.code;
    this.mapsState.paintCode = code === "select" ? null : code;
    this.render();
  }

  static async onMapRequest(event, target) {
    const map = this._currentMap();
    if (!map) return;
    const request = this._val("#tf-map-request");
    if (!request) return;
    const settings = getAiSettings();
    let edit = null;
    if (aiReady(settings)) {
      try {
        const campaign = getSetting("campaign") ?? {};
        const prompt = M.mapPrompt(campaign, map, this.mapsState.sel, request);
        const raw = await aiComplete(settings, prompt.system, prompt.user, prompt.maxTokens);
        edit = M.parseMapEdit(raw, map);
      } catch (err) {
        console.warn("TableForge | AI map edit failed, falling back to offline:", err);
        ui.notifications.warn("TableForge: AI unavailable — used the offline map builder.");
      }
    }
    edit ??= M.offlineMapEdit(map, this.mapsState.sel, request);
    this._pushMapUndo(map);
    await this._saveMap(M.applyMapEdit(map, edit));
    if (edit.summary) ui.notifications.info(`TableForge: ${edit.summary}`);
    this.render();
  }

  static async onMapUndo(event, target) {
    const map = this._currentMap();
    const snapshot = this.mapsState.undo.pop();
    if (!map || !snapshot) return;
    const { terrain, features } = JSON.parse(snapshot);
    await this._saveMap({ ...map, terrain, features });
    this.render();
  }

  static async onMapNotesSave(event, target) {
    const map = this._currentMap();
    if (!map) return;
    await this._saveMap({ ...map, name: this._val("#tf-map-edit-name") || map.name, notes: this._val("#tf-map-notes") });
    ui.notifications.info("TableForge: map saved.");
    this.render();
  }

  static async onFeatureDelete(event, target) {
    const map = this._currentMap();
    if (!map) return;
    this._pushMapUndo(map);
    const next = { ...map, features: map.features.filter((f) => f.id !== target.dataset.id) };
    if (this.mapsState.featureId === target.dataset.id) this.mapsState.featureId = null;
    await this._saveMap(next);
    this.render();
  }

  static async onMapExportScene(event, target) {
    const map = this._currentMap();
    if (!map) return;
    const dataUrl = M.renderMapDataUrl(map);
    if (!dataUrl) {
      ui.notifications.error("TableForge: couldn't render the map image in this client.");
      return;
    }
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const fileName = `${map.name.replace(/[^\w-]+/g, "_")}.png`;
      const file = new File([blob], fileName, { type: "image/png" });
      const uploaded = await FilePicker.upload("data", "tableforge-maps", file, {});
      const sceneData = M.mapToSceneData(map, uploaded.path);
      sceneData.folder = await ensureFolder("Scene");
      const scene = await Scene.create(sceneData);
      await createJournalDoc(`${map.name} — notes`, M.mapJournalHtml(map));
      ui.notifications.info(`TableForge: scene "${scene?.name ?? map.name}" created (GM-only) with a notes journal.`);
    } catch (err) {
      console.error("TableForge | scene export failed:", err);
      ui.notifications.error(`TableForge: scene export failed (${err.message}).`);
    }
    this.render();
  }

  // ---------- actions: Loot ----------

  static async onStashCreate(event, target) {
    const stash = await createStashActor();
    if (stash) ui.notifications.info(`TableForge: party stash "${stash.name}" is ready (GM-only).`);
    this.render();
  }

  static async onItemAttune(event, target) {
    const { actor: actorId, id: itemId } = target.dataset;
    const { items } = buildLootData();
    const current = items.find((i) => i.id === itemId && i.actorId === actorId);
    if (!current) return;
    const result = S.setAttuned(items, itemId, !current.attuned);
    if (!result.ok) {
      ui.notifications.warn(`TableForge: ${result.reason}`);
      return;
    }
    const item = game.actors.get(actorId)?.items.get(itemId);
    if (item) await item.setFlag(MOD, "attuned", !current.attuned);
    this.render();
  }

  static async onItemMove(event, target) {
    const row = target.closest("[data-loot-item]");
    const targetActorId = row?.querySelector("select")?.value;
    const { actor: actorId, id: itemId } = target.dataset;
    const source = game.actors.get(actorId);
    const dest = game.actors.get(targetActorId);
    if (!source || !dest || source.id === dest.id) return;
    const moved = await transferItem(source, itemId, dest);
    if (moved) ui.notifications.info(`TableForge: moved "${moved.name}" to ${dest.name}.`);
    this.render();
  }
}
