export const PROFILE_COLORS = [
  { key: "lime", label: "Lime", value: "#C5FF41" },
  { key: "purple", label: "Purple", value: "#A875FF" },
  { key: "coral", label: "Coral", value: "#FF5C4D" },
  { key: "paper", label: "Paper", value: "#F5F0E8" },
];

export const PROFILE_STICKERS = [
  { key: "star", label: "Star", emoji: "🌟" },
  { key: "heart", label: "Heart", emoji: "🫀" },
  { key: "ghost", label: "Ghost", emoji: "👻" },
  { key: "spark", label: "Spark", emoji: "✨" },
  { key: "moon", label: "Moon", emoji: "🌙" },
  { key: "flower", label: "Flower", emoji: "🌼" },
];

const COLOR_MAP = Object.fromEntries(PROFILE_COLORS.map((item) => [item.key, item.value]));
const STICKER_MAP = Object.fromEntries(PROFILE_STICKERS.map((item) => [item.key, item.emoji]));

export function profileColor(key) {
  return COLOR_MAP[key] || COLOR_MAP.lime;
}

export function profileSticker(key) {
  return STICKER_MAP[key] || STICKER_MAP.star;
}
