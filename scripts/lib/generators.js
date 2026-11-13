// Forge generators: offline card generation, AI prompt design, reply parsing.
// Ported from TableForge-web (app/src/lib/forge.ts).
//
// A "card" is { key, title, body, tags, pinned } — body is plain text with
// short labeled lines ("Role: ..."), exactly as in the donor app. `pinned`
// is UI state used by the pin/regenerate mechanics.
//
// Context ("ctx") is a plain object so this file stays Foundry-free:
//   { campaign: {name, premise, setting, tone},
//     beats: [{act, title, summary, status}],          status: PLANNED|IN_PLAY|DONE
//     ideas: [{type, title, body, isOwn}],
//     party: [string] }                                 e.g. "Barnaby, artificer"

import * as W from "./wordtables.js";
import { pick, shuffle, uid } from "./dice.js";
import { parseObject, AiError } from "./ai.js";

export const IDEA_TYPES = {
  NPC: { label: "NPCs", singular: "NPC" },
  EVENT: { label: "Events", singular: "event" },
  LOCATION: { label: "Locations", singular: "location" },
  DUNGEON_ROOM: { label: "Dungeon rooms", singular: "dungeon room" },
  MAGIC_ITEM: { label: "Magic items", singular: "magic item" },
  STORY_BEAT: { label: "Story beats", singular: "story beat" },
  NOTE: { label: "Notes", singular: "note" },
};
export const GENERATABLE = ["NPC", "EVENT", "LOCATION", "DUNGEON_ROOM", "MAGIC_ITEM", "STORY_BEAT"];
export const ALL_TYPES = Object.keys(IDEA_TYPES);
export const asType = (t) => (t in IDEA_TYPES ? t : "NOTE");

export const BEAT_STATUS = { PLANNED: "Planned", IN_PLAY: "In play", DONE: "Done" };

/** Vibe chips from the donor's Forge screen; they are folded into the steer text. */
export const VIBES = ["Darker", "Funnier", "Mysterious", "Tied to the main plot", "Low level (1-4)", "High level", "Urban", "Wilderness", "Morally gray", "Weird / fey"];

export const mkCard = (title, body, tags = "") => ({ key: uid("c"), title, body, tags, pinned: false });

// ---------- Campaign context (donor: describe(ctx)) ----------

export function describeContext(ctx) {
  const c = ctx?.campaign ?? {};
  const lines = [`CAMPAIGN: ${c.name || "Untitled campaign"}`];
  if (c.premise) lines.push(`Premise / overall plot: ${c.premise}`);
  if (c.setting) lines.push(`Setting: ${c.setting}`);
  if (c.tone) lines.push(`Tone: ${c.tone}`);
  if (ctx?.party?.length) lines.push("Party: " + ctx.party.join("; "));
  const beats = ctx?.beats ?? [];
  if (beats.length) {
    lines.push("Plot outline so far (in order):");
    beats.forEach((b, i) => {
      const status = BEAT_STATUS[b.status] ?? "Planned";
      lines.push(`${i + 1}. ${b.act ? `[${b.act}] ` : ""}${b.title} (${status})${b.summary ? " — " + String(b.summary).slice(0, 240) : ""}`);
    });
  }
  const named = (ctx?.ideas ?? []).filter((i) => i.type === "NPC" || i.type === "LOCATION");
  if (named.length) lines.push("Established NPCs and locations: " + named.slice(0, 40).map((i) => i.title).join(", "));
  const own = (ctx?.ideas ?? []).filter((i) => i.isOwn).slice(0, 15);
  if (own.length) {
    lines.push("The DM's own ideas to weave in where it fits:");
    own.forEach((i) => lines.push(`- ${i.title}: ${String(i.body ?? "").slice(0, 160)}`));
  }
  return lines.join("\n");
}

// ---------- AI prompt design (donor: SYSTEM / SHAPE / FLESH_SYSTEM) ----------

export const SYSTEM = `You are a creative assistant for a Dungeons & Dragons 5e Dungeon Master preparing sessions.
Give vivid, specific, table-ready ideas a DM can use immediately. Avoid generic fantasy clichés unless asked.
Keep each idea consistent with the campaign details provided. Don't reuse names already established, unless the DM names a specific character or place, in which case use exactly that name.
Always reply with JSON only, in exactly this shape: {"items":[{"title":"...","body":"...","tags":"..."}]}
"body" is plain text using short labeled lines separated by \\n. "tags" is 1-4 comma-separated keywords.`;

export const SHAPE = {
  NPC: "title = the NPC's name. body lines: Role, Look, Personality, Wants, Secret, Voice/mannerism, Hook (how the party meets them).",
  EVENT: "title = a short event name. body lines: Trigger, What happens, Stakes, Complication, Possible outcomes.",
  LOCATION: "title = the place name. body lines: Type, First impression (read-aloud, 2 sentences), Notable features, Who's here, Secret, Hooks.",
  DUNGEON_ROOM: "title = a room name. body lines: Read-aloud (2-3 sentences), Contents, Threat or trap (with a DC if relevant), Treasure, Exits, Twist.",
  MAGIC_ITEM: "title = the item name. body lines: Rarity, Attunement (yes/no and by whom), Appearance, Properties (5e mechanics), Quirk, History.",
  STORY_BEAT: "title = a short beat name. body lines: What happens, Why it matters, Connects to (existing beats/NPCs), Foreshadowing, Player choice.",
  NOTE: "title = a short name. body = a few useful lines.",
};

const FLESH_SYSTEM = `You help a Dungeons & Dragons 5e Dungeon Master flesh out an idea they have already started.
The DM's details are canon: keep every name exactly as written (spelling included), keep every fact they gave, and never contradict them.
Fill in everything they left open so the result is vivid, specific and table-ready, and consistent with the campaign.
Weave the DM's details into the labeled lines where they belong rather than repeating them in a list.
When asked for several versions, keep the DM's details identical in each and vary only what they left open.
Always reply with JSON only, in exactly this shape: {"items":[{"title":"...","body":"...","tags":"..."}]}
"body" is plain text using short labeled lines separated by \\n. "tags" is 1-4 comma-separated keywords.`;

/** Parses a model reply into cards (donor: toCards). Throws AiError if empty. */
export function parseCards(raw) {
  const obj = parseObject(raw);
  const items = Array.isArray(obj.items) ? obj.items : [];
  const cards = items
    .map((o) => {
      const title = String(o.title ?? "").trim();
      const body = String(o.body ?? "").trim().replace(/\\n/g, "\n");
      return title || body ? mkCard(title || body.slice(0, 40), body, String(o.tags ?? "").trim()) : null;
    })
    .filter((c) => c != null);
  if (!cards.length) throw new AiError("The model didn't return any ideas. Try again.");
  return cards;
}

export function forgePrompt(ctx, type, count, steer, avoid = []) {
  const user = [
    describeContext(ctx), "",
    `Generate ${count} distinct ${IDEA_TYPES[type].singular} ideas for this campaign.`,
    SHAPE[type],
    steer && `The DM wants: ${steer}`,
    avoid.length ? `Do not repeat or closely resemble these: ${avoid.join("; ")}` : "",
  ].filter(Boolean).join("\n");
  return { system: SYSTEM, user, maxTokens: 3000 };
}

export function fleshPrompt(ctx, type, name, notes, versions, avoid = []) {
  const user = [
    describeContext(ctx), "",
    `Flesh out this ${IDEA_TYPES[type].singular}${versions > 1 ? `, as ${versions} different versions` : ""}.`,
    name.trim() ? `Name (use exactly as the title): ${name.trim()}` : "Name: not decided — invent a fitting one.",
    notes.trim() ? `What the DM already knows:\n${notes.trim()}` : "The DM has no other details yet.",
    SHAPE[type],
    avoid.length ? `Make it clearly different from these earlier versions: ${avoid.join("; ")}` : "",
  ].filter(Boolean).join("\n");
  return { system: FLESH_SYSTEM, user, maxTokens: 3000 };
}

export function nextBeatsPrompt(ctx, steer = "") {
  const user = [
    describeContext(ctx), "",
    "Recommend 4 possible next story beats for the coming sessions. Build on beats marked In play or Done, pay off foreshadowing, and move toward the overall plot.",
    SHAPE.STORY_BEAT, steer && `The DM wants: ${steer}`,
  ].filter(Boolean).join("\n");
  return { system: SYSTEM, user, maxTokens: 3000 };
}

export function fillGapPrompt(ctx, before, after, steer = "") {
  const ask =
    before && after ? `There is a gap between "${before.title}" and "${after.title}". Propose 3 alternative bridging beats that get the story logically from one to the other.`
      : !before && after ? `Propose 3 alternative opening beats that lead into "${after.title}".`
        : before ? `Propose 3 alternative beats that follow "${before.title}" and push toward the campaign's climax.`
          : "Propose 3 alternative opening beats for this campaign.";
  const user = [describeContext(ctx), "", ask, "Each option should be a different direction, not variations of one idea.", SHAPE.STORY_BEAT, steer && `The DM wants: ${steer}`]
    .filter(Boolean).join("\n");
  return { system: SYSTEM, user, maxTokens: 3000 };
}

export function tableEntriesPrompt(ctx, name, description, count) {
  const user = [
    ctx ? describeContext(ctx) + "\n" : "",
    `Write ${count} entries for a random table called "${name}".`,
    description && `What the table is for: ${description}`,
    "Each entry is one or two punchy sentences a DM can read aloud or use immediately. All entries must be different.",
    "Put each entry's text in \"body\"; \"title\" can be a 1-3 word label.",
  ].filter(Boolean).join("\n");
  return { system: SYSTEM, user, maxTokens: 4000 };
}

/** Turns parsed AI cards into table entry strings (donor: tableEntries tail). */
export const cardsToEntries = (cards, count) => cards.map((c) => c.body || c.title).slice(0, count);

// ---------- Offline generation (donor: offlineOne / offlineCards / offlineTable) ----------

function offlineOne(type) {
  switch (type) {
    case "NPC":
      return mkCard(`${pick(W.firstNames)} ${pick(W.surnames)}`, [
        `Role: ${pick(W.ancestries)} ${pick(W.roles)}`, `Look: ${pick(W.looks)}`, `Personality: ${pick(W.personalities)}`,
        `Wants: ${pick(W.wants)}`, `Secret: ${pick(W.secrets)}`, `Voice: ${pick(W.voices)}`,
      ].join("\n"), "npc");
    case "EVENT":
      return mkCard(pick(W.eventNames), [`Trigger: ${pick(W.triggers)}`, `What happens: ${pick(W.happenings)}`, `Stakes: ${pick(W.stakes)}`, `Complication: ${pick(W.complications)}`].join("\n"), "event");
    case "LOCATION":
      return mkCard(`The ${pick(W.placeAdjs)} ${pick(W.placeNouns)}`, [
        `Type: ${pick(W.placeTypes)}`, `First impression: ${pick(W.impressions)}`, `Notable feature: ${pick(W.features)}`,
        `Who's here: ${pick(W.firstNames)}, a ${pick(W.roles)} who ${pick(W.secrets)}`,
      ].join("\n"), "location");
    case "DUNGEON_ROOM":
      return mkCard(pick(W.roomNames), [
        `Read-aloud: ${pick(W.readAlouds)}`, `Threat: ${pick(W.threats)}`, `Treasure: ${pick(W.treasures)}`,
        `Exits: ${1 + Math.floor(Math.random() * 3)} (${shuffle(["north", "east", "south", "west"]).slice(0, 2).join(", ")})`, `Twist: ${pick(W.twists)}`,
      ].join("\n"), "dungeon");
    case "MAGIC_ITEM":
      return mkCard(`${pick(W.itemAdjs)} ${pick(W.itemNouns)}`, [
        `Rarity: ${pick(["Uncommon", "Uncommon", "Rare", "Rare", "Very rare"])}`, `Attunement: ${Math.random() < 0.5 ? "yes" : "no"}`,
        `Properties: ${pick(W.itemProps)}`, `Quirk: ${pick(W.quirks)}`,
      ].join("\n"), "magic item");
    case "STORY_BEAT":
      return mkCard(pick(W.beatNames), [`What happens: ${pick(W.happenings)}`, `Why it matters: it puts ${pick(W.stakes)} at risk`, `Complication: ${pick(W.complications)}`].join("\n"), "story");
    default:
      return mkCard("Idea", pick(W.happenings));
  }
}

export const offlineCards = (type, count) => Array.from({ length: count }, () => offlineOne(asType(type)));

export function offlineFleshOut(type, name, notes, versions) {
  return offlineCards(type, versions).map((c) => mkCard(
    name.trim() || c.title,
    [...notes.trim().split("\n").filter(Boolean).map((l) => (l.includes(":") ? l.trim() : `Notes: ${l.trim()}`)), c.body].join("\n"),
    c.tags,
  ));
}

/** Offline random-table entries, themed by the table's name (donor: offlineTable). */
export function offlineTableEntries(name, count) {
  const n = String(name ?? "").toLowerCase();
  const pool =
    n.includes("npc") || n.includes("name") ? Array.from({ length: count }, () => `${pick(W.firstNames)} ${pick(W.surnames)}, ${pick(W.ancestries)} ${pick(W.roles)}`)
      : n.includes("loot") || n.includes("treasure") || n.includes("item") ? [...W.treasures, ...W.itemProps.map((p) => `${pick(W.itemAdjs)} ${pick(W.itemNouns)}: ${p}`)]
        : n.includes("event") || n.includes("encounter") ? [...W.happenings, ...W.threats]
          : n.includes("rumor") || n.includes("rumour") ? W.secrets.map((s) => `They say ${pick(W.firstNames)} ${s}.`)
            : n.includes("room") || n.includes("dungeon") ? [...W.readAlouds, ...W.twists]
              : [...W.happenings, ...W.features, ...W.complications];
  const sh = shuffle(pool);
  return Array.from({ length: count }, (_, i) => sh[i] ?? pick(pool));
}
