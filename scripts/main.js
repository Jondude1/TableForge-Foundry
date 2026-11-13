// TableForge — Foundry VTT v13 module entry point.
// A DM session-prep toolkit ported from TableForge-web: Forge generators,
// random Tables, Story outline, Ideas bank, Concepts board, grid Maps with
// Scene export, and a native-backed party Loot sheet.
//
// GM-ONLY: the module is a GM tool living in a world whose host may be a
// player. The launcher is hidden from non-GMs, open() refuses non-GMs, and
// every document the module creates defaults to GM-only ownership.

import { TableForgeApp } from "./app.js";
import { MOD } from "./lib/foundry.js";

let app = null;

export function openTableForge() {
  if (!game.user?.isGM) {
    ui.notifications?.warn("TableForge is a GM tool.");
    return null;
  }
  if (!app) app = new TableForgeApp();
  app.render(true);
  return app;
}

Hooks.once("init", () => {
  const worldData = (key, def) =>
    game.settings.register(MOD, key, { scope: "world", config: false, type: Object, default: def });
  worldData("tables", []);
  worldData("rollLog", []);
  worldData("campaign", { name: "", premise: "", setting: "", tone: "" });
  worldData("beats", []);
  worldData("ideas", []);
  worldData("concepts", { nodes: [], edges: [] });
  worldData("maps", []);

  // AI settings are client-scoped: an API key must never live in world data
  // that syncs to connected players.
  game.settings.register(MOD, "anthropicKey", {
    name: "Claude API key (optional)",
    hint: "Your own Anthropic API key, stored only in this browser. Leave blank for offline mode. Get one at console.anthropic.com.",
    scope: "client", config: true, type: String, default: "",
  });
  game.settings.register(MOD, "claudeModel", {
    name: "Claude model",
    hint: "Model id used with the API key above.",
    scope: "client", config: true, type: String, default: "claude-sonnet-4-5",
  });
  game.settings.register(MOD, "ollamaUrl", {
    name: "Ollama base URL (optional)",
    hint: "e.g. http://192.168.1.10:11434 — used only when no Claude key is set. Leave blank for offline mode.",
    scope: "client", config: true, type: String, default: "",
  });
  game.settings.register(MOD, "ollamaModel", {
    name: "Ollama model",
    hint: "Model name served by your Ollama instance.",
    scope: "client", config: true, type: String, default: "llama3.1",
  });

  game.modules.get(MOD).api = { open: openTableForge };
  window.TableForge = { open: openTableForge };
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user?.isGM) return;
  controls.tableforge = {
    name: "tableforge",
    title: "TableForge",
    icon: "fas fa-hammer",
    layer: null,
    visible: true,
    tools: {
      open: {
        name: "open",
        title: "Open TableForge",
        icon: "fas fa-book-open",
        button: true,
        onChange: () => openTableForge(),
      },
    },
    activeTool: "open",
  };
});
