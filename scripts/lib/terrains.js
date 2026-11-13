// Terrain + rarity data. Ported from TableForge-web (app/src/lib/types.ts).

export const TERRAINS = [
  { code: "g", key: "grass", label: "Grass", color: "#3E5230" },
  { code: "f", key: "forest", label: "Forest", color: "#27391F" },
  { code: "d", key: "dirt", label: "Dirt / road", color: "#6B5236" },
  { code: "s", key: "sand", label: "Sand", color: "#B49A64" },
  { code: "w", key: "water", label: "Shallow water", color: "#35617A" },
  { code: "D", key: "deep", label: "Deep water", color: "#1E3B52" },
  { code: "m", key: "swamp", label: "Swamp", color: "#3D4A2E" },
  { code: "r", key: "stone", label: "Stone floor", color: "#5A554E" },
  { code: "c", key: "cobble", label: "Cobblestone", color: "#6E655A" },
  { code: "o", key: "wood", label: "Wood floor", color: "#7A5634" },
  { code: "#", key: "wall", label: "Wall", color: "#26221E" },
  { code: "^", key: "mountain", label: "Mountain / rock", color: "#6F6A64" },
  { code: "n", key: "snow", label: "Snow / ice", color: "#C9D3D8" },
  { code: "l", key: "lava", label: "Lava", color: "#B5432A" },
  { code: "v", key: "void", label: "Pit / void", color: "#0B0907" },
];

export const terrainByCode = (c) => TERRAINS.find((t) => t.code === c) ?? TERRAINS[0];

export function terrainFromKey(k) {
  const s = String(k ?? "").trim().toLowerCase().replace(/ /g, "_");
  const direct = TERRAINS.find((t) => t.key === s || t.label.toLowerCase() === String(k ?? "").trim().toLowerCase());
  if (direct) return direct;
  const by = (key) => TERRAINS.find((t) => t.key === key);
  if (s.includes("tree") || s === "wood") return by("forest");
  if (s.includes("road") || s.includes("path")) return by("dirt");
  if (s.includes("river") || s.includes("pond") || s.includes("lake")) return by("water");
  if (s.includes("ocean") || s.includes("sea")) return by("deep");
  if (s.includes("rock") || s.includes("cliff") || s.includes("hill")) return by("mountain");
  if (s.includes("floor")) return by("stone");
  if (s.includes("ice")) return by("snow");
  return undefined;
}

export const RARITIES = ["Common", "Uncommon", "Rare", "Very rare", "Legendary", "Artifact"];

export const rarityColor = (r) =>
  ({
    common: "#C9BEA8",
    uncommon: "#7FC27A",
    rare: "#6AA8E6",
    "very rare": "#B487E6",
    legendary: "#E8A64A",
    artifact: "#E86E5E",
  })[String(r ?? "").toLowerCase()] ?? "#C9BEA8";
