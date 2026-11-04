# Fixed vocabularies for posts. The front-end mirrors these in lib/taxonomy.js.

CATEGORIES = [
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
]

# Stored as keys; the front-end maps each key to an emoji + label.
MOOD_KEYS = [
    "dead_inside",
    "sobbing",
    "dying",
    "melting",
    "unbothered",
    "unhinged",
    "soft",
    "numb",
]

# One primary reaction per user per post. Front-end maps each key to emoji + color.
REACTION_KEYS = [
    "life_sucks",
    "been_there",
    "this_hurts",
    "you_deserved_better",
    "you_deserve_this",
    "im_crying",
    "relatable",
    "sending_support",
    "fucked_up",
    "skill_issue",
    "couldnt_be_me",
    "massive_l",
    "sucks_to_suck",
    "no_thoughts",
]

CATEGORY_SET = set(CATEGORIES)
MOOD_SET = set(MOOD_KEYS)
REACTION_SET = set(REACTION_KEYS)
