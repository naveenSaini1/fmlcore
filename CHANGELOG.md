# Changelog

All notable changes to FMLCore. Versions track build stages as `0.<stage>.<patch>`.
Format loosely follows [Keep a Changelog](https://keepachangelog.com).

## [0.8.0] — 2026-11-05 — Stage 8: The Confession Sky

### Added
- A dedicated `/confessions` floating-balloon experience with independent CSS motion, glossy balloon bodies, paper tags, responsive density, and reduced-motion support.
- Real public/private confession records backed by the existing post, reaction, comment, safety, and moderation infrastructure.
- Confession composer with colour choice and anonymous/private controls; the sky loads up to 30 balloons and opens the selected confession after a click-to-pop animation.
- Persisted confession view counts increment when a balloon is popped. The sky detail view omits the safety-options menu; moderation and safety routes remain available elsewhere.
- Post reporting and account block/mute actions are grouped under a per-post three-dot menu; profiles list the signed-in user's reported posts and report statuses.
- Home includes My posts and My confessions views. Confession entries show their persisted view counts; account block/mute lists were removed from the profile safety area.
- The main navigation labels `/confessions` as “Confession”. The signed-in home page is a personal space with a composer and owned content only; each owned entry has a three-dot delete menu with confirmation.
- Signed-out home opens Explore, while signed-in users see their personal space on the home page. `/me` is a public About page with founder and platform information, linked from the navigation for every visitor.

## [0.7.0] — 2026-11-04 — Stage 7: themes + navigation polish

### Added
- Five site-wide palettes plus a system preference option, selected through an animated circular theme picker with live preview.
- Guest theme persistence in the browser and signed-in theme persistence on the user account through `PATCH /profile/theme`.
- Theme design tokens for surfaces, text, accents, borders, button contrast, and shadows, with a startup migration for existing user tables.
- Animated active navigation states for current and nested routes, plus consistent hover, press, focus, disabled, and reduced-motion feedback.

## [0.6.0] — 2026-11-04 — Stage 6: profile personality + motion

### Added
- Persistent profile color and sticker choices, shown on profile cards, post bylines, and comments.
- Reduced-motion-aware entrance and sticker motion on the profile.
- Weekly Top Painer leaderboard ranking posts by reactions received in the last seven days; anonymous posts remain eligible and display as Anonymous.
- Top-five leaderboard panel on the home feed, a full leaderboard page with load-more pagination, and navigation entry.

## [0.5.0] — 2026-11-04 — Stage 5: notifications + safety

### Added
- Notifications for new reactions, comments, and replies, with unread counts, individual and bulk read actions, pagination, and anonymous actor protection.
- Block and mute controls on posts and comments, plus profile settings to review and undo those choices; hidden accounts are filtered from feeds, comments, explore, and notifications.
- Report actions for posts, comments, and accounts. Reports are validated, rate-limited, and stored as pending moderation records.
- Rate limits for notification updates, block/mute/report actions, profile edits, and avatar uploads; reaction removal is rate-limited as well.
- Moderation-ready report status field and routes for account safety preferences.

## [0.4.0] — 2026-11-04 — Stage 4: explore

### Added
- Explore page with category and mood filters, newest-first browsing with pagination, activity-based trending, and random story discovery.
- Trending ranks posts from the last seven days by recent reactions and comments, weighted toward newer activity.
- Daily prompt endpoint and shared prompt card; signed-in users can open the post composer with the prompt prefilled.
- Explore navigation entry available to signed-in and signed-out visitors.

## [0.3.1] — 2026-11-04 — Reaction set + picker

### Added
- Expanded the reaction set to 14 for the 18+ unfiltered tone: added "You deserve this" plus a sarcastic batch — "That's fucked up" 🫨, "Skill issue" 🤡, "Couldn't be me" 💅, "Massive L" 📉, "Sucks to suck" 😮‍💨, "No thoughts" 🗿.

### Changed
- Reaction bar now shows four reactions by default (💀 Life sucks, 🫡 Been there, 💯 Relatable, 🫵 You deserve this) with a "•••" more button revealing the rest; picking an overflow reaction promotes it into the main row.
- Moved "You deserved better" into the overflow.

## [0.3.0] — 2026-11-04 — Stage 3: reactions and comments

### Added
- Post reactions — the 7 vision reactions (💀 Life sucks, 🫡 Been there, 💔 This hurts, 👑 You deserved better, 😭 I'm crying, 💯 Relatable, 🫂 Sending support); one primary reaction per user per post, changeable and removable (unique per post+user).
- Endpoints: `PUT /posts/{id}/reaction` (set/change), `DELETE /posts/{id}/reaction` (remove), `GET /posts/{id}/comments` (threaded, paginated), `POST /posts/{id}/comments` (comment or reply, auth, rate-limited 30 / 10 min).
- Comments with one level of threading (top-level comments + flat replies), named or anonymous; reply restricted to top-level parents.
- `PostOut` now carries `reactions` (per-type counts), `reaction_count`, `my_reaction`, and `comment_count`, aggregated per feed page (no N+1). `GET /posts` is now optionally authenticated so each post reflects the viewer's own reaction.
- Front-end: reaction bar on each post (your pick highlighted, spring pop on select, reduced-motion aware, counts shown quietly and never ranked) and inline expandable comment threads with a name-or-anonymous composer and replies.

### Deferred
- Reply notifications, comment reactions, block/mute/report/moderation — later stages.

## [0.2.0] — 2026-11-04 — Stage 2: feed and posts

### Added
- `Post` model and `posts` table (author, body, category, mood, optional image, anonymous flag, created_at) with indexes on author and created_at.
- Endpoints: `POST /posts` (auth, multipart, rate-limited 20 / 10 min), `GET /posts` (keyset pagination, newest-first), `GET /posts/{id}`.
- Shared taxonomy — 10 categories and 8 moods (💀 dead inside, 😭 sobbing, 😂 dying, 🫠 melting, 🙃 unbothered, 🔥 unhinged, 🥹 soft, 😐 numb); single source of truth mirrored on the front-end.
- Post image upload (JPG/PNG/WebP, 2 MB cap), served under `/media/posts/`.
- Anonymous posts: author hidden in every public API response; `author_id` kept internally for future moderation.
- Front-end: home feed at `/` for signed-in users, inline composer with live preview, varied neo-brutalist post cards, loading / empty / error states, and "Load more" pagination.

### Fixed / Changed (dev infrastructure)
- Pinned Tailwind to `4.1.16`. The `^4.1.14` caret had installed `4.3.4`, which depends on the ESM-only `magic-string@1.x` and threw `ERR_REQUIRE_ESM` under Next 15's require-hook, 500-ing every page.
- Routed browser API calls through a same-origin Next proxy (`/api/* → 127.0.0.1:8000`) so the session cookie is first-party. Fixes login not persisting when the app and API were on different hosts (`localhost` vs `127.0.0.1`).

## [0.1.0] — 2026-11-04 — Stage 1: accounts and profile

### Added
- Signup with email / username / password and an enforced 18+ gate; bcrypt password hashing.
- Login, logout, and sessions via a JWT in an httponly cookie (14-day lifetime).
- `GET /auth/me`, `PATCH /profile`, and avatar upload (`POST /profile/avatar`, 2 MB, JPG/PNG/WebP).
- Per-IP rate limiting on signup and login.
- Front-end: signup, login, and profile pages.

## [0.0.0] — 2026-11-04 — Stage 0: shell and design tokens

### Added
- Next.js app shell, FastAPI backend, and PostgreSQL via docker-compose.
- Design tokens (lime / purple / coral / paper / ink), display / body / note fonts, dotted grain overlay, and reduced-motion support.
- Site header and landing page — "Life is weird. You're not the only one."
