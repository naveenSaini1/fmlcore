export const THEMES = [
  { key: "acid-lime", label: "Acid Lime", color: "#C5FF41", secondary: "#A875FF" },
  { key: "electric-purple", label: "Electric Purple", color: "#A875FF", secondary: "#C5FF41" },
  { key: "chaos-coral", label: "Chaos Coral", color: "#FF5C4D", secondary: "#A875FF" },
  { key: "midnight", label: "Midnight", color: "#202337", secondary: "#BD9BFF" },
  { key: "classic-paper", label: "Classic Paper", color: "#F5F0E8", secondary: "#171717" },
];

export const SYSTEM_THEME = { key: "system", label: "System", color: "conic-gradient(#C5FF41 0 25%, #A875FF 0 50%, #FF5C4D 0 75%, #F5F0E8 0)" };

export function themeByKey(key) {
  return key === "system" ? SYSTEM_THEME : THEMES.find((theme) => theme.key === key) || THEMES[0];
}

export function isThemeKey(key) {
  return key === "system" || THEMES.some((theme) => theme.key === key);
}
