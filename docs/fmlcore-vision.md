# FMLCore vision

Persistent product memory. The short copy lives in `.cursor/rules/fmlcore.mdc`.

## What it is

A creative, expressive social platform for real life: embarrassing moments, bad days, 2 AM thoughts, heartbreak, work, friendship, money, and ridiculous incidents. People should feel that someone else experiences this too.

Core line: Life is weird. You're not the only one.

It is not Quora, Reddit, LinkedIn, a forum clone, a corporate dashboard, an AI chatbot, or an engagement farm. The weekly Top Painer leaderboard ranks posts by reactions, never people by suffering, and preserves anonymous authorship.

Audience: Gen Z and young adults, 18+, people who want to post without a perfect persona.

## Design

Chaos in appearance, simplicity in use. Underground community, not a SaaS dashboard.

Inspired by neo-brutalism, editorial experiment, memes, scrapbook, collage, playful type, stickers, doodles, Y2K accents.

Colors (use few at a time):

- Acid lime `#C5FF41`
- Electric purple `#A875FF`
- Chaos coral `#FF5C4D`
- Warm paper `#F5F0E8`
- Almost black `#171717`
- White `#FFFFFF`

UI: oversized headings, bold display type, occasional handwritten notes, thick black borders, bold shadows, irregular cards, sticker buttons, badges, grain, purposeful hover and spring motion. Support reduced motion. Skip glassmorphism, generic gradients, Bootstrap cards, and identical components.

## Experience

Opening the app should explain itself: welcoming, slightly unpredictable, fun.

People can discover stories, post easily, react expressively, find people who relate, talk, explore moods, and build a recognizable identity. Meaningful interaction over follower counts.

### Home

Creative nav, personal feed, obvious composer, trending conversations, daily prompt, community highlights. Posts are individual experiences.

Examples:

- Funny: waved back at someone who was not waving.
- Heartbreaking: missing people you do not want back.
- Frustrating: "five minutes" that became three hours.
- Random: an embarrassing memory from 2016.

### Create

Easy, not a long form. Text, optional image, category, optional anonymous, mood, preview.

Prompts: What's the plot twist today? What happened this time? Something you cannot tell your friends? What's living rent-free in your head? Most embarrassing moment.

### Reactions

One primary reaction per post; the user can change it. Each reaction has its own icon, color, and small animation. Four are shown on every post (Life sucks, Been there, Relatable, You deserve this); the rest sit behind a "•••" more button and promote into the row when picked.

Current set (expanded past the original seven for the 18+ unfiltered tone): Life sucks, Been there, Relatable, You deserve this, This hurts, You deserved better, I'm crying, Sending support, That's fucked up, Skill issue, Couldn't be me, Massive L, Sucks to suck, No thoughts.

The weekly Top Painer leaderboard ranks posts by reactions received during the last seven days. Anonymous posts may rank and must display without exposing their author. Do not present an individual's pain as a score.

### Comments

Nested replies, reactions on comments, named or anonymous identity, reply notifications, light threading.

### Explore

Trending, random, popular discussions, categories, moods.

Categories: Relationships, Friendship, Work Life, College Life, Family, Confessions, Embarrassing Moments, Random Thoughts, Funny Incidents, Life Problems.

### Notifications

Reactions, comments, replies, mentions, community activity. Clear, not noisy.

### Profile

Username, avatar, bio, posts, reactions received, joined date, customization, optional anonymity. Personality through color, decorations, and stickers.

### Community

Daily prompts, weekly Top Painer post leaderboard, relatable story highlights, supportive community activity, random story discovery, and milestones. The leaderboard ranks posts by recent reactions rather than ranking people by suffering; anonymous posts display as Anonymous.

## Anonymity and safety

Public anonymous posts must not reveal the author. Keep the account link internally for abuse handling.

Include moderation, spam controls, rate limits, block, report, and mute from the start. FMLCore is not professional mental healthcare.

## Layout

Desktop: left nav, feed, optional right community panel, asymmetric layout, comfortable reading width.

Mobile: bottom nav, full-width feed, one-handed posting, touch targets. Design mobile on its own.

## Stack

- Front: Next.js, JavaScript, Tailwind, Motion
- Back: Python, FastAPI, REST; WebSockets only when real-time features exist
- Data: PostgreSQL
- Hosting: Git, VPS or similar

Modular, maintainable, secure. Do not overbuild the first release.

## Quality bar

Fast, responsive, consistent type, reusable components, accessible, loading empty and error states, validated APIs, auth checks, paginated lists. Demo data stays separate from production data. No interaction that only pretends to work.

## Stages

Do one stage at a time. Wait for an explicit yes and a stage number before writing product code.

0. Shell and design tokens. No social features. The empty app already looks like FMLCore.
1. Sign up, log in, profile, sessions.
2. Home feed and real posts (text, mood, category, optional image, optional anonymous, preview).
3. Expressive reactions and comments with replies.
4. Explore: categories, moods, trending, random, daily prompt.
5. Notifications plus block, mute, report, rate limits, moderation hooks.
6. Profile decorations, motion, and a weekly post leaderboard that preserves anonymous authorship.
7. Dynamic site-wide themes, active-screen navigation states, and button hover effects.
8. Real-time reactions, comments, and in-app notifications via WebSockets.
9. Email notifications for reactions and comments on a user's posts.
10. Voice rooms — folded into Stage 11, not a separate build stage.
11. Social voice rooms and full voice meeting rooms (future stage; deferred for now).

Later: milestones and richer customization.

## Status

Current version 0.7.0 — see `CHANGELOG.md`.

Stages 0 (shell and tokens), 1 (accounts and profile), 2 (feed and posts), and 3 (reactions and comments) are built, running, and verified end to end. `image/` holds the icons.

Stages 0–7 are complete. Stage 8 is next. Stage 10's voice-room scope is folded into deferred Stage 11. See `docs/PROGRESS.md` for the roadmap and handoff state.

The completed Stage 7 requirements and planned requirements for real-time WebSockets (Stage 8), email notifications (Stage 9), and the combined social voice rooms/full meeting-room experience (Stage 11) are recorded in `docs/PROGRESS.md`. Obtain explicit approval for each remaining stage before implementation.
