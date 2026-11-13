// Foundry-facing helpers: settings access, campaign context, document
// creation. Everything here touches Foundry globals (game, ui, CONFIG,
// document classes) and is only loaded inside the Foundry client — the pure
// lib/ modules never import this file.
//
// VISIBILITY RULE (module-wide): every document TableForge creates gets
// ownership { default: 0 } — GM-only. The host of the world may be a player;
// nothing a GM generates here may leak to players by default.

export const MOD = "tableforge";

export const getSetting = (key) => game.settings.get(MOD, key);
export const setSetting = (key, value) => game.settings.set(MOD, key, value);

export function getAiSettings() {
  return {
    anthropicKey: getSetting("anthropicKey") ?? "",
    claudeModel: getSetting("claudeModel") ?? "claude-sonnet-4-5",
    ollamaUrl: getSetting("ollamaUrl") ?? "",
    ollamaModel: getSetting("ollamaModel") ?? "llama3.1",
  };
}

/** Builds the plain campaign-context object the generators consume. */
export function buildCtx() {
  const party = game.actors
    .filter((a) => a.type === "character" || a.hasPlayerOwner)
    .map((a) => a.name);
  return {
    campaign: getSetting("campaign") ?? { name: "", premise: "", setting: "", tone: "" },
    beats: getSetting("beats") ?? [],
    ideas: getSetting("ideas") ?? [],
    party,
  };
}

export const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Converts a card body's labeled lines ("Role: ...") into simple journal HTML. */
export function bodyToHtml(body) {
  const lines = String(body ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "<p><em>No details.</em></p>";
  return lines
    .map((l) => {
      const m = /^([^:]{1,32}):\s*(.*)$/.exec(l);
      return m ? `<p><strong>${esc(m[1])}:</strong> ${esc(m[2])}</p>` : `<p>${esc(l)}</p>`;
    })
    .join("\n");
}

/** Finds or creates the "TableForge" folder for a document collection type. */
export async function ensureFolder(type) {
  const existing = game.folders.find((f) => f.type === type && f.name === "TableForge");
  if (existing) return existing.id;
  const folder = await Folder.create({ name: "TableForge", type, color: "#6b5236" });
  return folder?.id ?? null;
}

const GM_ONLY = { default: 0 };

/** Creates a GM-only journal entry with one text page. Returns the document. */
export async function createJournalDoc(name, html) {
  const folder = await ensureFolder("JournalEntry");
  return JournalEntry.create({
    name,
    folder,
    ownership: { ...GM_ONLY },
    pages: [{ name, type: "text", title: { show: false }, text: { content: html, format: 1 } }],
    flags: { [MOD]: { source: "tableforge" } },
  });
}

export const createJournalFromCard = (card) => createJournalDoc(card.title, bodyToHtml(card.body));

/** Picks a sane Item type for the active game system. */
export function pickItemType() {
  const types = Object.keys(CONFIG.Item?.typeLabels ?? {});
  for (const t of ["equipment", "loot", "weapon", "consumable", "tool", "backpack"]) {
    if (types.includes(t)) return t;
  }
  return types[0] ?? "equipment";
}

/**
 * Creates a GM-only Item from a magic-item card. The full card body always
 * lands in module flags; when the system's item schema has the common
 * description path it is filled too (best effort, failure is non-fatal).
 */
export async function createItemFromCard(card) {
  const folder = await ensureFolder("Item");
  const item = await Item.create({
    name: card.title,
    type: pickItemType(),
    folder,
    ownership: { ...GM_ONLY },
    flags: { [MOD]: { body: card.body, tags: card.tags, source: "tableforge" } },
  });
  if (item && item.system && "description" in item.system) {
    try {
      await item.update({ "system.description.value": bodyToHtml(card.body) });
    } catch { /* schema differs — flags copy remains canonical */ }
  }
  return item;
}

/** Creates a native GM-only RollTable from a stored module table. */
export async function exportRollTable(table) {
  const folder = await ensureFolder("RollTable");
  return RollTable.create({
    name: table.name,
    description: table.description ?? "",
    formula: `1d${table.sides}`,
    replacement: false,
    displayRoll: false,
    folder,
    ownership: { ...GM_ONLY },
    results: table.entries.map((e) => ({ type: "text", text: e.text, range: [e.minRoll, e.maxRoll] })),
    flags: { [MOD]: { source: "tableforge" } },
  });
}

/** User ids of all GMs — table/dice chat output is whispered to GMs only. */
export const gmWhisperIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);

/** Posts a table roll to chat, visible to GMs only. */
export async function postTableRoll(table, roll, entry) {
  const content = entry
    ? `<p><strong>${esc(table.name)}</strong> (d${table.sides}) — rolled <strong>${roll}</strong></p><p>${esc(entry.text)}</p>`
    : `<p><strong>${esc(table.name)}</strong> (d${table.sides}) — rolled <strong>${roll}</strong>, but the table is empty.</p>`;
  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ alias: "TableForge" }),
    content,
    whisper: gmWhisperIds(),
  });
}

// ---------- Loot (native-backed) ----------

function normalizeItem(actor, item) {
  const sys = item.system ?? {};
  const flags = item.flags?.[MOD] ?? {};
  const rarity = typeof sys.rarity === "string" && sys.rarity ? sys.rarity : flags.rarity ?? "";
  let requiresAttunement = flags.requiresAttunement;
  if (requiresAttunement === undefined) requiresAttunement = sys.attunement === 1 || sys.attunement === 2;
  let attuned = flags.attuned;
  if (attuned === undefined) attuned = sys.attunement === 2;
  let charges = "";
  if (sys.uses && (Number(sys.uses.max) > 0 || sys.uses.value != null)) charges = `${sys.uses.value ?? 0}/${sys.uses.max ?? 0}`;
  else if (flags.charges) charges = String(flags.charges);
  return { id: item.id, actorId: actor.id, name: item.name, rarity, requiresAttunement: Boolean(requiresAttunement), attuned: Boolean(attuned), charges };
}

/**
 * Reads the world's actors/items into the loot view model:
 * { holders: [{actorId, name, isStash, items: [normalized]}], items: [normalized] }
 * Holders: the stash actor, any actor with items, any player-owned actor.
 */
export function buildLootData() {
  const holders = [];
  const items = [];
  for (const actor of game.actors) {
    const isStash = Boolean(actor.flags?.[MOD]?.stash);
    const normalized = actor.items.map((i) => normalizeItem(actor, i));
    if (!isStash && !normalized.length && !actor.hasPlayerOwner) continue;
    holders.push({ actorId: actor.id, name: actor.name, isStash, items: normalized });
    items.push(...normalized);
  }
  holders.sort((a, b) => Number(b.isStash) - Number(a.isStash) || a.name.localeCompare(b.name));
  return { holders, items };
}

/** Creates the designated party-stash actor (GM-only) if absent. Returns it. */
export async function createStashActor() {
  const existing = game.actors.find((a) => a.flags?.[MOD]?.stash);
  if (existing) return existing;
  const types = Object.keys(CONFIG.Actor?.typeLabels ?? {});
  const type = types.includes("npc") ? "npc" : types[0] ?? "npc";
  const folder = await ensureFolder("Actor");
  return Actor.create({
    name: "Party Stash",
    type,
    folder,
    ownership: { ...GM_ONLY },
    flags: { [MOD]: { stash: true, source: "tableforge" } },
  });
}

/** Moves an item between actors the way Foundry models it: copy + delete. Flags ride along. */
export async function transferItem(sourceActor, itemId, targetActor) {
  const item = sourceActor.items.get(itemId);
  if (!item || !targetActor || sourceActor.id === targetActor.id) return null;
  const data = item.toObject();
  delete data._id;
  const [created] = await targetActor.createEmbeddedDocuments("Item", [data]);
  await item.delete();
  return created ?? null;
}
