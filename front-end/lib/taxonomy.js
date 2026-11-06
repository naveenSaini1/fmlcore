// Mirrors backend/app/taxonomy.py. Keep the keys in sync.

export const CATEGORIES = [
  "Relationships",
  "Friendship",
  "Work Life",
  "College Life",
  "Family",
  "Confessions",
  "Embarrassing Moments",
  "Random Thoughts",
  "Funny Incidents",
  "Life Problems",
];

export const MOODS = [
  { key: "dead_inside", emoji: "💀", label: "dead inside" },
  { key: "sobbing", emoji: "😭", label: "sobbing" },
  { key: "dying", emoji: "😂", label: "dying" },
  { key: "melting", emoji: "🫠", label: "melting" },
  { key: "unbothered", emoji: "🙃", label: "unbothered" },
  { key: "unhinged", emoji: "🔥", label: "unhinged" },
  { key: "soft", emoji: "🥹", label: "soft" },
  { key: "numb", emoji: "😐", label: "numb" },
];

const MOOD_MAP = Object.fromEntries(MOODS.map((m) => [m.key, m]));

export function moodByKey(key) {
  return MOOD_MAP[key] || { key, emoji: "", label: key };
}

// Cycle the brand colors so posts in a feed look like different experiences.
const ACCENTS = ["var(--color-lime)", "var(--color-purple)", "var(--color-coral)"];

export function categoryAccent(category) {
  const i = CATEGORIES.indexOf(category);
  return ACCENTS[(i < 0 ? 0 : i) % ACCENTS.length];
}

// One primary reaction per post. Names are fixed by the vision; order is stable
// (never sorted by count — reactions are not a scoreboard).
export const REACTIONS = [
  { key: "life_sucks", emoji: "💀", label: "Life sucks", color: "var(--color-coral)" },
  { key: "been_there", emoji: "🫡", label: "Been there", color: "var(--color-purple)" },
  { key: "this_hurts", emoji: "💔", label: "This hurts", color: "var(--color-coral)" },
  { key: "you_deserved_better", emoji: "👑", label: "You deserved better", color: "var(--color-purple)" },
  { key: "you_deserve_this", emoji: "🫵", label: "You deserve this", color: "var(--color-coral)" },
  { key: "im_crying", emoji: "😭", label: "I'm crying", color: "var(--color-lime)" },
  { key: "relatable", emoji: "💯", label: "Relatable", color: "var(--color-lime)" },
  { key: "sending_support", emoji: "🫂", label: "Sending support", color: "var(--color-purple)" },
  { key: "fucked_up", emoji: "🫨", label: "That's fucked up", color: "var(--color-coral)" },
  { key: "skill_issue", emoji: "🤡", label: "Skill issue", color: "var(--color-purple)" },
  { key: "couldnt_be_me", emoji: "💅", label: "Couldn't be me", color: "var(--color-coral)" },
  { key: "massive_l", emoji: "📉", label: "Massive L", color: "var(--color-purple)" },
  { key: "sucks_to_suck", emoji: "😮‍💨", label: "Sucks to suck", color: "var(--color-lime)" },
  { key: "no_thoughts", emoji: "🗿", label: "No thoughts", color: "var(--color-purple)" },
];

const REACTION_MAP = Object.fromEntries(REACTIONS.map((r) => [r.key, r]));

export function reactionByKey(key) {
  return REACTION_MAP[key] || { key, emoji: "", label: key, color: "var(--color-ink)" };
}

// Four reactions shown on every post; the rest live behind the "•••" more button.
// Picking an overflow one promotes it into the visible row.
export const PRIMARY_REACTION_KEYS = ["life_sucks", "been_there", "relatable", "you_deserve_this"];
export const PRIMARY_REACTIONS = PRIMARY_REACTION_KEYS.map(reactionByKey);
export const OVERFLOW_REACTIONS = REACTIONS.filter((r) => !PRIMARY_REACTION_KEYS.includes(r.key));
