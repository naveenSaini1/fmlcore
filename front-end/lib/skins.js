export const SKINS = [
  {
    id: "common-ground", name: "Common Ground", tagline: "A warmer place to read, relate, and feel at home.",
    layout: "common-ground", preview: ["#f5f6f2", "#ffffff", "#28634f", "#dcebe4"],
  },
  {
    id: "frappe", name: "Frappe", tagline: "A calm workspace for your stories and conversations.",
    layout: "frappe", preview: ["#f8f8f8", "#ffffff", "#171717", "#e8f0fe"],
  },
  {
    id: "calm", name: "Calm Chaos", tagline: "The original. Bold borders, paper texture, and playful cards.",
    layout: "calm", preview: ["#f7f6f2", "#ffffff", "#c5ff41", "#ff5c4d"],
  },
  {
    id: "social", name: "Social Classic", tagline: "Familiar social networking, made simple.",
    layout: "social", preview: ["#f4f5f7", "#ffffff", "#536dfe", "#a875ff"],
  },
  {
    id: "after-hours", name: "After Hours", tagline: "A dark, focused home for late-night thoughts.",
    layout: "after-hours", preview: ["#171717", "#242424", "#c5ff41", "#a875ff"],
  },
];

export const DEFAULT_SKIN = "calm";

export function skinById(id) {
  return SKINS.find((skin) => skin.id === id) || SKINS.find((skin) => skin.id === DEFAULT_SKIN);
}

export function isSkinId(id) {
  return SKINS.some((skin) => skin.id === id);
}
