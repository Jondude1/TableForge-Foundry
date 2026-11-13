/**
 * Headless smoke tests for TableForge's pure logic libraries.
 * Run: node tests/smoke.mjs
 *
 * The module's lib files use `.js` ESM specifiers (Foundry convention), so
 * this harness copies them to a temp dir as `.mjs` with specifiers rewritten,
 * then imports and exercises them. No Foundry globals are needed: everything
 * under scripts/lib/ is Foundry-free by design.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const libDir = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "lib");
const tmp = mkdtempSync(join(tmpdir(), "tf-smoke-"));
for (const f of ["dice.js", "wordtables.js", "terrains.js", "ai.js", "generators.js", "maps.js", "store.js"]) {
  const src = readFileSync(join(libDir, f), "utf8").replace(/(from\s+["']\.\/)([a-z]+)(\.js)(["'])/g, "$1$2.mjs$4");
  writeFileSync(join(tmp, f.replace(/\.js$/, ".mjs")), src);
}
const imp = (n) => import(pathToFileURL(join(tmp, n)).href);

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${name}`); }
}
function section(name) { console.log(`\n== ${name}`); }

const dice = await imp("dice.mjs");
const G = await imp("generators.mjs");
const S = await imp("store.mjs");
const M = await imp("maps.mjs");
const T = await imp("terrains.mjs");
const AI = await imp("ai.mjs");

// ---------- dice & table math ----------
section("dice / table math");
for (const sides of dice.DICE) {
  let ok = true;
  for (let i = 0; i < 500; i++) { const r = dice.rollDie(sides); if (r < 1 || r > sides) ok = false; }
  check(`rollDie d${sides} in range`, ok);
}
for (const [sides, count] of [[100, 20], [20, 20], [6, 4], [12, 12], [4, 1]]) {
  const rs = dice.ranges(sides, count);
  const covered = new Set();
  let contiguous = rs.length === count && rs[0][0] === 1 && rs[rs.length - 1][1] === sides;
  for (const [lo, hi] of rs) for (let n = lo; n <= hi; n++) { if (covered.has(n)) contiguous = false; covered.add(n); }
  check(`ranges(${sides}, ${count}) contiguous over 1..${sides}`, contiguous && covered.size === sides);
}
check("d100 label shows 100 as 00", dice.rangeLabel(96, 100, 100) === "96–00");
check("defaultCount d100 = 20", dice.defaultCount(100) === 20);
check("defaultCount d6 = 6", dice.defaultCount(6) === 6);
const ef = dice.entriesFor(6, ["a", "b"]);
check("entriesFor splits text with ranges", ef.length === 2 && ef[0].minRoll === 1 && ef[1].maxRoll === 6);

// ---------- forge: offline cards for all types ----------
section("forge offline generators");
check("six generatable types", G.GENERATABLE.length === 6);
for (const type of G.GENERATABLE) {
  const cards = G.offlineCards(type, 4);
  check(`${type}: 4 well-formed cards`, cards.length === 4 && cards.every(
    (c) => typeof c.title === "string" && c.title.length > 0 &&
           typeof c.body === "string" && c.body.length > 0 &&
           typeof c.tags === "string" && typeof c.key === "string" && c.pinned === false));
}
const flesh = G.offlineFleshOut("NPC", "Maren Copperkettle", "Runs the ferry.", 2);
check("flesh-out keeps the given name", flesh.length === 2 && flesh.every((c) => c.title === "Maren Copperkettle" && c.body.includes("Runs the ferry.")));
const genEntries = G.offlineTableEntries("Tavern rumors", 10);
check("offline table entries: 10 non-empty strings", genEntries.length === 10 && genEntries.every((e) => typeof e === "string" && e.length > 0));
check("cardsToEntries maps cards to phrases", G.cardsToEntries([{ title: "A thing", body: "B" }], 3).length === 1);

// ---------- ai layer parsing ----------
section("ai layer");
check("parseObject: plain JSON", AI.parseObject('{"a":1}')?.a === 1);
check("parseObject: fenced JSON", AI.parseObject("```json\n{\"a\":2}\n```")?.a === 2);
let junkThrew = false;
try { AI.parseObject("not json at all"); } catch (e) { junkThrew = e instanceof AI.AiError; }
check("parseObject: junk → throws AiError (callers fall back to offline)", junkThrew);
check("aiReady: empty settings → false", AI.aiReady({}) === false);
check("aiReady: key → true", AI.aiReady({ anthropicKey: "sk-test" }) === true);
check("aiReady: ollama → true", AI.aiReady({ ollamaUrl: "http://localhost:11434" }) === true);

// ---------- tables (store) ----------
section("tables");
const t100 = S.buildTable({ name: "Omens", sides: 100, texts: Array.from({ length: 20 }, (_, i) => `Omen ${i + 1}`) });
check("d100 table: last entry ends at 100", t100.entries.length === 20 && t100.entries[19].maxRoll === 100);
let rollsOk = true;
for (let i = 0; i < 300; i++) {
  const { roll, entry } = S.rollOnTable(t100);
  if (roll < 1 || roll > 100 || !entry || roll < entry.minRoll || roll > entry.maxRoll) rollsOk = false;
}
check("rollOnTable: 300 rolls all land in their entry's range", rollsOk);
const t6 = S.setTableTexts(S.buildTable({ name: "Small", sides: 6, texts: [] }), ["a", "b", "c"]);
check("setTableTexts re-splits ranges over 1..6", t6.entries.length === 3 && t6.entries[0].minRoll === 1 && t6.entries[2].maxRoll === 6);
let log = [];
for (let i = 0; i < 105; i++) log = S.pushRollLog(log, { table: "T", sides: 6, roll: 1, text: "", at: i });
check("roll log caps at 100, newest first", log.length === 100 && log[0].at === 104);

// ---------- story beats ----------
section("story beats");
let beats = [];
beats = S.addBeat(beats, { title: "Opening", act: "Act I", summary: "s" });
beats = S.addBeat(beats, { title: "Complication", act: "Act I", summary: "" });
beats = S.addBeat(beats, { title: "Climax", act: "Act II", summary: "" });
check("beats append in order", beats.map((b) => b.title).join(",") === "Opening,Complication,Climax");
const groups = S.groupBeatsByAct(beats);
check("beats group by act in order", groups.length === 2 && groups[0].act === "Act I" && groups[0].beats.length === 2);
beats = S.setBeatStatus(beats, beats[0].id, "DONE");
check("beat status set", beats[0].status === "DONE" && G.BEAT_STATUS[beats[0].status] === "Done" && S.BEAT_STATUSES.includes("DONE"));
const ins = S.insertBeat(beats, 0, { title: "Bridge", act: "Act I" });
check("fill-gap insert lands after index 0", ins.beats.indexOf(ins.beat) === 1 && ins.beats.length === 4 && ins.beats[1].title === "Bridge");
beats = S.moveBeat(ins.beats, ins.beats[3].id, -1);
check("moveBeat reorders", beats[2].title === "Climax");
const beatFromCard = S.cardToBeat({ title: "Card beat", body: "body text", tags: [] }, "Act II");
check("cardToBeat shape", beatFromCard.title === "Card beat" && beatFromCard.summary === "body text" && beatFromCard.status === "PLANNED");

// ---------- ideas ----------
section("ideas");
let ideas = [];
({ ideas } = S.addIdea(ideas, { type: "NPC", title: "Ferryman", body: "Rows at night.", tags: "river, night" }));
({ ideas } = S.addIdea(ideas, { type: "MAGIC_ITEM", title: "Lantern", body: "Glows near lies.", tags: [] }));
({ ideas } = S.addIdea(ideas, { type: "NOTE", title: "Loose thread", body: "The bell tolls twice.", tags: [], isOwn: true }));
check("ideas added with ids", ideas.length === 3 && ideas.every((i) => i.id));
const ferryman = ideas.find((i) => i.title === "Ferryman");
const lantern = ideas.find((i) => i.title === "Lantern");
check("idea tags kept as the bank's string", ferryman.tags === "river, night");
check("filter by search", S.filterIdeas(ideas, { search: "ferry" }).length === 1);
check("filter by type", S.filterIdeas(ideas, { type: "MAGIC_ITEM" }).length === 1);
ideas = S.updateIdea(ideas, lantern.id, { favorite: true });
check("filter favorites", S.filterIdeas(ideas, { favoritesOnly: true }).length === 1);
check("filter unused", S.filterIdeas(ideas, { unusedOnly: true }).length === 3);
const ib = S.ideaToBeat(ferryman);
check("ideaToBeat shape", ib.title === "Ferryman" && ib.summary.includes("Rows at night."));
const inode = S.ideaToNode(ferryman, 10, 20);
check("ideaToNode shape", inode.label === "Ferryman" && inode.kind === "npc" && inode.x === 10 && inode.ideaId === ferryman.id);

// ---------- concepts graph ----------
section("concepts");
let graph = { nodes: [], edges: [] };
let nodeA, nodeB;
({ graph, node: nodeA } = S.addNode(graph, { label: "The Abbey", kind: "faction", x: 100, y: 80 }));
({ graph, node: nodeB } = S.addNode(graph, { label: "Brother Anselm", kind: "person", x: 300, y: 200 }));
const edgeRes = S.addEdge(graph, { from: nodeA.id, to: nodeB.id, label: "secretly funds" });
graph = edgeRes.graph;
check("edge added with label", graph.edges.length === 1 && graph.edges[0].label === "secretly funds");
check("self-link refused", S.addEdge(graph, { from: nodeA.id, to: nodeA.id, label: "x" }).edge === null);
graph = S.moveNode(graph, nodeA.id, 150, 90);
check("node moved", graph.nodes.find((n) => n.id === nodeA.id).x === 150);
const roundTripped = JSON.parse(JSON.stringify(graph));
check("graph JSON round-trip", roundTripped.nodes.length === 2 && roundTripped.edges[0].from === nodeA.id);
graph = S.removeNode(graph, nodeA.id);
check("removeNode cascades edges", graph.nodes.length === 1 && graph.edges.length === 0);

// ---------- maps ----------
section("maps");
const map = M.newMap("Test", 8, 6, "g", 5);
check("blank map terrain fills grid", map.terrain.length === 48 && map.terrain.split("").every((c) => c === "g"));
const painted = M.paint(map, [{ terrain: T.terrainFromKey("water"), cells: M.rectCells(map, { x: 0, y: 0, w: 2, h: 2 }) }]);
check("paint applies to rect cells", painted[0] === "w" && painted[1] === "w" && painted[8] === "w" && painted[2] === "g");
const sel = { x: 1, y: 1, w: 2, h: 2 };
const waterEdit = M.offlineMapEdit(map, sel, "make this water");
check("offline edit: 'make this water' paints selection", waterEdit.terrain.length === 1 && waterEdit.terrain[0].cells.length === 4 && waterEdit.terrain[0].terrain.key === "water");
const lightEdit = M.offlineMapEdit(map, { x: 0, y: 0, w: 1, h: 1 }, "a lighthouse that takes up 4 squares");
check("offline edit: 'takes up 4 squares' → 2x2 feature", lightEdit.features.length === 1 && lightEdit.features[0].w === 2 && lightEdit.features[0].h === 2 && /lighthouse/i.test(lightEdit.features[0].name));
const hutEdit = M.offlineMapEdit(map, { x: 0, y: 0, w: 1, h: 1 }, "add a 3x2 hut");
check("offline edit: '3x2' parsed", hutEdit.features.length === 1 && hutEdit.features[0].w === 3 && hutEdit.features[0].h === 2);
const applied = M.applyMapEdit(map, lightEdit);
check("applyMapEdit adds feature with id", applied.features.length === 1 && typeof applied.features[0].id === "string");
const parsed = M.parseMapEdit('{"summary":"s","paints":[],"features":[{"name":"Keep","x":0,"y":0,"w":99,"h":1}]}', map);
check("parseMapEdit clamps feature size to grid", parsed.features[0].w === 8);
const scene = M.mapToSceneData(map, "tableforge-maps/Test.png");
check("scene payload: pixel size = cells × 100", scene.width === 800 && scene.height === 600 && scene.grid.size === 100);
check("scene payload: GM-only + background set", scene.ownership.default === 0 && scene.img === "tableforge-maps/Test.png");
check("map journal html includes name", M.mapJournalHtml(map).includes("Test"));
check("renderMapDataUrl returns null headless (no document)", M.renderMapDataUrl(map) === null);

// ---------- loot ----------
section("loot");
const lootItems = [1, 2, 3, 4].map((n) => ({
  id: `i${n}`, actorId: "a1", name: `Item ${n}`, type: "equipment",
  rarity: "rare", requiresAttunement: true, attuned: false, charges: null, img: "",
}));
check("attune 1st ok", S.setAttuned(lootItems, "i1", true).ok === true);
lootItems[0].attuned = true;
S.setAttuned(lootItems, "i2", true); lootItems[1].attuned = true;
S.setAttuned(lootItems, "i3", true); lootItems[2].attuned = true;
check("countAttuned = 3", S.countAttuned(lootItems, "a1") === 3);
check("4th attunement blocked with reason", S.setAttuned(lootItems, "i4", true).ok === false);
check("un-attune always ok", S.setAttuned(lootItems, "i1", false).ok === true);
const grouped = S.groupLootByHolder([{ ...lootItems[0] }, { ...lootItems[1], actorId: "a2" }]);
check("groupLootByHolder splits by actor", grouped.get("a1").length === 1 && grouped.get("a2").length === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
