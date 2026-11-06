# FMLCore — build progress & handoff

**Version:** 0.8.0 · **Last stage done:** 8 (The Confession Sky) · **Next:** Stage 9 (real-time interactions)

This file is the pick-up point for anyone (human or AI) continuing the build. Read
[fmlcore-vision.md](fmlcore-vision.md) for product intent and [../CHANGELOG.md](../CHANGELOG.md)
for the per-version log.

## The one rule

Build **one stage at a time**. Do **not** write product code for a new stage until the
owner names the stage and gives an explicit "go". The flow each time:

1. Propose the stage's scope + the real decisions in structured text.
2. Wait for the explicit yes.
3. Build it, then drive it end-to-end (API + UI) and report.
4. Bump the version files (`VERSION`, `CHANGELOG.md`, backend `FastAPI(version=...)`,
   `front-end/package.json`) and update this file + the vision Status.

## Stages

- [x] **0 — Shell & design tokens.** Next.js shell, FastAPI, Postgres; tokens, fonts, grain, landing.
- [x] **1 — Accounts & profile.** Signup (18+ gate), login/logout, sessions, profile edit, avatar upload.
- [x] **2 — Feed & posts.** Post model, create/list/single, keyset pagination, images, anonymity, composer + feed UI.
- [x] **3 — Reactions & comments.** Post reactions (one per user, changeable), one-level threaded comments, both named-or-anonymous.
- [x] **4 — Explore.** Category and mood filters, recent browsing, trending, random story, and daily prompt.
- [x] **5 — Notifications + safety.** Notifications, block, mute, report, moderation-ready reports, and rate-limit coverage.
- [x] **6 — Profile personality & motion.** Profile colors and stickers, reduced-motion-aware animation, and weekly Top Painer post leaderboard (anonymous posts remain anonymous).
- [x] **7 — Dynamic themes + navigation polish.** Five site-wide palettes plus a system preference, saved per account, animated active routes, and accessible button feedback.
- [x] **8 — The Confession Sky.** Up to 30 public confession balloons, click-to-pop selection, persisted view counts, private visibility, creation, reactions, and comments. No random-discovery, load-more, or safety-options controls appear in this view.
- [ ] **9 — Real-time interactions.** WebSocket updates for reactions, comments, and instant in-app notifications. *(planned; not started)*
- [ ] **10 — Email notifications.** Send real emails for reactions and comments on a user's posts. *(planned; not started)*
- **11 — Voice rooms.** Folded into Stage 12; no separate Stage 11 build.
- [ ] **12 — Voice rooms + full voice meeting rooms.** Includes the social audio rooms and full meeting-room experience. *(future; deferred for now)*

## Back-end (FastAPI — `backend/app`)

- **models.py:** `User` (profile color/sticker/theme), `Post`, `Reaction` (unique per post+user), `Comment` (self-ref `parent_id`, one level deep), `Notification`, `UserBlock`, `UserMute`, `Report`.
- **taxonomy.py:** `CATEGORIES` (10), `MOOD_KEYS` (8), `REACTION_KEYS` (14). Mirrored in `front-end/lib/taxonomy.js`.
- **main.py endpoints:**
  - Auth: `POST /auth/signup`, `/auth/login`, `/auth/logout`; `GET /auth/me`
  - Profile: `PATCH /profile`, `PATCH /profile/theme`, `POST /profile/avatar`
  - Posts: `POST /posts` (multipart), `GET /posts` (keyset paginated, optional auth → fills `my_reaction`), `GET /posts/{id}`
  - Explore: `GET /explore/taxonomy`, `GET /explore/daily-prompt`, `GET /explore/trending`, `GET /explore/random`; `GET /posts` also accepts category and mood filters.
  - Notifications: `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/{id}/read`, `POST /notifications/read-all`.
  - Safety: `GET /safety/blocks`, `GET /safety/mutes`, `POST` / `DELETE /safety/blocks/{user_id}`, `POST` / `DELETE /safety/mutes/{user_id}`, `POST /safety/reports`.
  - Leaderboard: `GET /leaderboard` returns posts ranked by reactions from the last seven days, with offset pagination. Anonymous entries remain eligible and do not reveal the author.
  - Reactions: `PUT /posts/{id}/reaction` (set/change), `DELETE /posts/{id}/reaction`
  - Comments: `GET /posts/{id}/comments` (threaded, paginated), `POST /posts/{id}/comments` (comment or reply)
  - Media: `GET /media/...`
- **Auth:** JWT in httponly cookie `fml_session`. Per-IP rate limiting in `limiter.py`. Tables auto-created at startup; profile appearance columns are added for existing databases.

## Front-end (`front-end`)

- **app/page.js:** logged-in → `Feed`; logged-out → landing.
- **Pages:** `app/login`, `app/signup`, `app/profile`, `app/explore`, `app/notifications`, `app/leaderboard`.
- **Components:** `SiteHeader`, `Field`, `Composer` (live preview), `PostCard`, `Feed`,
  `ReactionBar` (4 primary + "•••" overflow; picking an overflow reaction promotes it into the row),
  `Comments` (inline expandable, one level of replies), `Explore` (filters, trending, random, daily prompt),
  `SafetyActions`, `SafetySettings`, `LeaderboardPanel`.
- **lib:** `api.js` (fetch wrapper, base `/api`), `taxonomy.js` (mirrors backend), `format.js` (`timeAgo`).
- **Design tokens and themes:** `app/globals.css`, `lib/themes.js`, `ThemeProvider`; guest preference is stored locally and signed-in preference on the user account.

## Data model notes

- Anonymous posts/comments hide the author in every public response; `author_id` is kept
  internally for future moderation.
- `PostOut` carries `reactions` (per-type counts), `reaction_count`, `my_reaction`, and
  `comment_count`, aggregated per feed page (no N+1).
- Reactions appear in fixed taxonomy order on posts. The weekly Top Painer leaderboard ranks posts by reactions, and anonymous posts display without revealing their author.

## Where to continue

Stages 0–8 are complete. Stage 9 (real-time interactions) is next. Stage 11's voice-room scope is folded into deferred Stage 12. Propose the scope and decisions first and wait for the owner's explicit go before writing product code.

## Completed Stage 7 specification

Stage 7 is delivered in v0.7.0. The specification below records the completed scope.

### Dynamic themes, navigation, and button interactions

#### A. Dynamic theme system

- Add a memorable, animated theme selector in the application's top-right corner.
- Open an expressive palette of circular swatches with playful selection animations and live preview.
- Initial themes: Acid Lime, Electric Purple, Chaos Coral, Midnight, and Classic Paper.
- Theme changes apply consistently to backgrounds, text, borders, buttons, cards, and navigation, with smooth transitions.
- Persist the selected theme per user. Support system preferences and accessible color contrast.
- Implement with CSS variables and a centralized design-token system.

#### B. Active navigation indicator

- Clearly indicate the current screen with an animated active state, distinct background or accent, and smooth icon/label transitions.
- Work consistently on desktop and mobile, reflect nested routes, use accessible navigation semantics, and adapt to the selected theme.

#### C. Playful button interactions

- Use Motion for purposeful hover elevation, press and subtle scale animations, shadow transitions, and animated reaction buttons.
- Provide loading and disabled states, keyboard focus indicators, and touch-friendly targets.
- Avoid excessive motion and honor reduced-motion preferences.

## Future feature specifications

These requirements record the remaining roadmap. Follow the stage approval rule above before starting each stage.

### Stage 9 — Real-time interaction system

Implement authenticated WebSocket connections for new comments, replies, reaction-count updates, and notifications. Define event support for room participant updates and voice-room activity when Stage 11 adds rooms.

Requirements: authorize every event, handle reconnection, prevent duplicate events, persist notifications reliably, manage connections efficiently, and provide a graceful fallback so the app remains usable while disconnected.

### Stage 10 — Email notification system

Send transactional and activity email for reactions, comments, replies, mentions, and important account/security events.

Requirements: branded HTML templates; user notification preferences; email verification; unsubscribe for non-essential messages; batching; rate limits; retries for failed delivery; and safeguards against repeated or excessive activity emails.

### Stage 11 — Folded into Stage 12

Stage 11 no longer has a separate delivery. Its social voice-room scope is included in the deferred Stage 12 plan below.

### Stage 12 — Voice rooms + full voice meeting rooms

Build a dedicated social audio experience where people can browse public rooms, create or join rooms, listen, request permission to speak, mute/unmute, raise a hand, view participants, and leave. The later full meeting-room experience is part of this same stage; its additional requirements will be scoped when the stage is scheduled.

Room setup includes a name, description, topic/category, public/private visibility, participant limit, and host/moderator roles. Initial categories: 2 AM Thoughts, Relationship Chaos, College Confessions, Work Is Killing Me, Just Vibing, and Unfiltered Conversations.

Technical and safety requirements: WebRTC audio with an SFU such as LiveKit or mediasoup (choose during Stage 12 planning); authenticated room access; microphone permissions; participant management; network-disconnect handling; host moderation; reporting and blocking; room closure and participant removal. Design for privacy and safety. Do not record audio by default.

This entire stage is deferred for now; propose and approve its detailed product and technical scope when Stage 12 is scheduled.

### Delivery phases

1. **Phase 1 — Complete:** Dynamic themes, navigation indicators, button interactions, and integration with the core social features already built.
2. **Phase 2 — Planned:** WebSocket updates and real-time notifications, then email notifications.
3. **Phase 3 — Planned, deferred:** Stage 12 social voice rooms, full meeting rooms, WebRTC/SFU integration, room management, and moderation.
4. **Phase 4 — Planned:** Advanced community experiences; scope to be proposed later.
