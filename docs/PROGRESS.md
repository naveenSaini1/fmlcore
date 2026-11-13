# FMLCore — build progress & handoff

**Version:** 0.9.1 · **Current stage:** 9-1 complete (instant match, event-driven worker, admin worker control) · **Next:** Stage 9-2 (matched-user chat)

This file is the pick-up point for anyone (human or AI) continuing the build. Read
[fmlcore-vision.md](fmlcore-vision.md) for product intent and [../CHANGELOG.md](../CHANGELOG.md)
for the per-version log.

## Local story engagement icons — 13 November 2026

Posts and confessions show comment and share icons with counts. Comments
close on an outside click or Escape. Successful sharing shows a checkmark.
Migration 0918 stores share counts, starting at zero for existing stories.
Migration 0919 counts each signed-in account once per story and resets old
click totals, which cannot be attributed to accounts. Guests can share links.

## Local story links, sharing, and edits — 13 November 2026

Guest navigation shows Join. Notifications open the specific story and bring
the referenced comment or reply into view, including older threads. Public
posts and confessions can be shared with a story link. The Confession Sky
empty message was removed. Authors can edit text from My posts or My
confessions. An edit refreshes existing Same Sky analysis for that story.

## Admin user stories — 12 November 2026

The admin user detail view shows all posts and confessions in separate
paginated lists with privacy labels. Story and image routes require admin
access. Public profile visibility rules are unchanged.

## Native notification prompt and mobile navigation — 12 November 2026

Restored the previous mobile layout. Leaderboard is in the mobile bottom bar,
and Same Sky is in the signed-in mobile header. Phone navigation skips the
full-screen loader and page exit animation. Browser notification
permission is requested from the first eligible trusted click after sign-in.
There is no app prompt or notification settings card. Local Web Push keys
are stored in the ignored backend environment file for verification.

## Live leaderboard, profile appearance, and browser push — 12 November 2026

The weekly leaderboard panel and full page refresh when committed reactions
change. Guests and signed-in users get the same change signal over SSE, with
server-side visibility checks on each ranking request. Private stories are
excluded. Skins and color themes moved from signed-in Home into Edit Profile.
The guest appearance picker and standalone Skin Studio remain available.

Browser notifications are opt-in per browser from Notifications or Edit
Profile. The service worker can show generic activity alerts with the tab
closed. Migration 0917 adds the committed delivery queue. Web Push keys persist
in production secret state. The FML smiley is the favicon, and public routes
have search metadata, a sitemap, and a branded share image.

Production build assets, the frozen 0901 baseline, and the deployer are now
tracked. Deploy the intended Git commit directly, without reusing the old source
archive. See [SERVER_RUNBOOK.md](SERVER_RUNBOOK.md) for release and verification
steps.

## Deployment and admin repair — 11 November 2026

Public app and admin are deployed at https://fmlcore.com and
https://admin.fmlcore.com with trusted HTTPS. The 10 GB boot disk plus a separate
20 GB application disk, private deployment bundle, source overrides and update
procedures are recorded in [SERVER_RUNBOOK.md](SERVER_RUNBOOK.md). Use it before redeploying.

Admin now supports Google login for existing accounts, with the same backend
email allowlist. The operator saved the admin OAuth origin. An authenticated
admin overview initially failed because `pgrep` was absent in the API container.
Worker status now supports separate-container deployments through a named
PostgreSQL listener (`SAME_SKY_WORKER_MANAGED=true`); process controls are blocked
in that mode. Both admin API wrappers handle non-JSON failures. Regression tests
and a production admin build passed; authenticated overview/status/users now
return `200` JSON and anonymous access remains `401`.

Update this handoff, the changelog, and affected feature/deployment docs whenever
behavior or server setup changes; record what was actually verified and pending.

## Snapshot update — 11 November 2026

Public author links now open `/users/{username}` with separate public Posts and
Confessions tabs. API filtering excludes anonymous and private content, including
for the owner, and honors blocking and muting. Public profile responses omit email.

Same Sky cards and chat use match-scoped aliases and opaque IDs. Chat participants
store `profile_revealed` (self-controlled consent) and `nickname` (a label for the
other person visible only to the owner). Sharing is one-sided per conversation;
withdrawing hides profile fields again. REST and socket messages, history,
summaries, typing, read receipts, presence, and Same Sky notifications avoid public
identity leaks. Identity-change events invalidate cached views before refresh;
reconnect reloads selected chat details/history. Migration `20261111_0916` is
applied locally and defaults all existing participants to hidden profiles.

Privacy integration tests use rolled-back PostgreSQL transactions. Public profile
links and content tabs were checked in the local browser. Consent controls and
message/typing payloads have API integration coverage. The remaining broader chat
safety/production work below still applies; this update does not complete Stage 9-2.

## Current handoff — 9 November 2026

### Snapshot update — 10 November 2026

Authentication now supports Google Identity Services and signup-only email OTP.
New email/password accounts confirm email ownership before account creation.
Password login stays normal, and existing accounts/data are left unchanged.
`EMAIL_OTP_EVERY_LOGIN=false` is the default.
New passwords are held only as hashes in temporary challenges until email
verification. Google onboarding requires a valid unique username and 18+
confirmation; existing-email Google linking requires an emailed code. SMTP
transport/templates and verification logic are reusable services. Migration
`20261110_0913` is applied locally. SMTP and GOOGLE_CLIENT_ID are not configured;
live delivery and Google sign-in remain unverified/disabled until setup. See
[AUTHENTICATION.md](AUTHENTICATION.md) for settings, tests, and account rules.

Auth tests run on migrated local PostgreSQL and an isolated current-model schema.
A clean replay of all historical migrations is blocked by the pre-existing 0901
bootstrap importing current models, leaving `same_sky_entries` missing at 0902.
The existing-database 0912→0913 authentication migration succeeds.

The repository now contains Stage 13 Skin Studio and the existing, in-progress
Stage 9-2 chat/WebSocket implementation. Skin Studio includes Calm Chaos,
Social Classic, After Hours, Frappe, and Common Ground, plus Leaderboard in the
main navigation. After the branch/merge checkpoint, signed-in `/` now combines
a profile-photo header, owned stories, and small skin circles on one page.
Edit profile opens `/profile`; the inline Profile & account section was removed.
Selecting a skin applies and saves it immediately, with rollback on save failure.
Story drafts stay mounted during skin changes.
Calm Chaos restores the original pre-Skin-Studio fonts, dotted paper, bold borders,
hard shadows, and tilted story cards. Other skins and current navigation remain.
Signed-in color-theme circles live beneath the skin circles on home, with no
signed-in navbar picker.
Signed-out visitors have a Skins & colors button in the navbar (palette icon on
phones), opening the shared circle selectors in an accessible dialog. Guest
choices persist on the browser and never write account preferences; signing in
restores account settings, and signing out restores the guest choices.
`theme-colors.css` owns shared palette roles so themes update surfaces, text,
accents, and borders across every skin without changing layout or fonts.
The 5-skin × 6-theme browser matrix passed at desktop and phone widths, including
System light/dark changes, reload persistence, failed-save rollback, and drafts.
Mobile now uses a fixed five-icon bottom bar (Home, Explore, Confession, Same Sky,
Chat for signed-in people). The compact top header retains Leaderboard and
Notifications; guests get login/join actions and Leaderboard/About destinations
in the bottom bar. Safe-area padding reserves space below page content. Desktop
navigation keeps its existing layout; unread counts are shared between shells.

Frontend production builds and Python compilation pass. Skin presentation was
checked with local API fixtures across desktop, tablet, and phone sizes;
account skin persistence was checked with a rolled-back local DB transaction.
These checks do not certify live chat or Same Sky provider delivery.

Remaining chat work from the repository review: validate connected-match and
block state on every read/action, authorize typing events against sender
membership, rate-limit WebSocket sends, add leave/block/report controls and
retention/delivery rules, and configure the production WebSocket proxy. Keep
these follow-ups visible when planning a public release. This checkpoint does
not mark Stage 9-2 or Stage 13 fully released, so release version files remain
unchanged.

### What is running

The local development stack runs from `/home/naveen/Desktop/fmlcore`:

- Next.js dev server: `http://localhost:3000`
- Admin console: `http://localhost:3001` (owner-only, authenticated)
- FastAPI: `http://127.0.0.1:8000`
- PostgreSQL: Docker container `fmlcore-db` on port 5433
- Same Sky worker: **not auto-started** — start it from the admin console (`http://localhost:3001`)
  or run `cd backend && .venv/bin/python -m app.same_sky_worker`

Check those processes before restarting anything. Local configuration is in the ignored
`backend/.env`; never copy its values into source files, commits, prompts, or handoff notes.

### How Same Sky works (v0.9.1)

#### Step 1 — Post analysis (`analyze_post` job, background worker)

When a user includes a post or confession in Same Sky, one `analyze_post` job is inserted
into `same_sky_jobs` in the same DB transaction. The background worker picks it up:

1. Sends post text to the configured AI provider → extracts themes, emotion, safe summary,
   copy signal, and risk flags.
2. Generates a 768-dimension pgvector embedding via Gemini.
3. Runs a near-duplicate check (cosine distance ≥ 0.94 triggers an AI copy comparison).
4. Saves themes + embedding to `same_sky_analysis` / `same_sky_embeddings`.
5. Sets `processing_status = "ready"` — post now counts toward eligibility.

The worker is **event-driven via PostgreSQL LISTEN/NOTIFY** (`LISTEN same_sky_jobs`).
It wakes only when a new job is inserted — zero idle CPU, zero idle DB queries.
Start/stop it from the admin console (`http://localhost:3001`) or run:

```
cd backend && .venv/bin/python -m app.same_sky_worker
```

#### Step 2 — Match search (inline in HTTP request, no queue)

When a user clicks "Start Matching", `POST /same-sky/attempts` calls `_find_match()`
directly and returns a terminal result immediately — no polling, no job queue:

1. Builds an exclusion list: already-matched users, blocked/blocking users, self.
2. For each of the user's ready posts, runs a pgvector cosine-distance search → top 180
   nearest posts from other eligible users.
3. Scores each candidate: combined similarity + shared-theme bonus + category-preference
   bonus. Candidates below the threshold are discarded.
4. Creates a `SameSkyMatch` row for the best candidate, or records `no_match`.
5. Returns `{ status, match_id, next_attempt_at }` immediately in the HTTP response.

> **Why no job queue for matching?** It is a pure local pgvector operation — under 50 ms.
> Only slow external AI calls go through the job queue.

#### `same_sky_jobs` table — `analyze_post` only going forward

| `job_type` | Still created? | Handled by |
|---|---|---|
| `analyze_post` | ✅ Yes — every included post/confession | Background worker |
| `find_match` | ❌ Removed in v0.9.1 | Inline in HTTP request |

Historical `find_match` rows remain in the table. The worker handler for `find_match`
has been removed from the codebase.

#### Admin worker control (`http://localhost:3001`)

The admin console has a **Background Worker** card:
- Live status badge: `● RUNNING (PID xxxxx)` or `○ STOPPED`
- **Turn ON / Turn OFF** — spawns or kills the real OS worker process
- **Process Backlog (N)** — runs all queued `analyze_post` jobs synchronously in one shot

API endpoints: `GET /admin/worker/status`, `POST /admin/worker/start|stop|process-batch`

Main implementation files: `front-end/app/same-sky/page.js`, `front-end/lib/api.js`,
`backend/app/same_sky_api.py`, `same_sky_ai.py`, `same_sky_matching.py`,
`same_sky_common.py`, `same_sky_worker.py`, `worker_control.py`.
Schema and config: `backend/app/models.py`, `backend/app/config.py`, `backend/migrations/`.

### Database and retry configuration

The current local migration head is `20261110_0913`. Revision `20261107_0903` removes the one-attempt-per-day
constraint so a configurable cooldown can support repeat attempts. Local retry is one
minute for testing (`SAME_SKY_RETRY_MINUTES=1`); production defaults to 1440 minutes.
Eligibility currently requires 3 posts and 3 confessions and can be changed through
`SAME_SKY_REQUIRED_POSTS` and `SAME_SKY_REQUIRED_CONFESSIONS`. An admin UI is future work.

Stage 9-2 chat implementation is in progress; see the snapshot update above for
the remaining safety and production checks.

### Admin console implementation

An owner-only admin console is implemented in `backend-front-end/` (Next.js on
port 3001). It authenticates with the existing FMLCore login and a backend
`ADMIN_EMAILS` allowlist. Its first scope is platform activity totals, per-user
login/content/Same Sky metadata, and editable Same Sky eligibility thresholds
plus no-match cooldown. It intentionally does not display private story text.
See [ADMIN_CONSOLE.md](ADMIN_CONSOLE.md) for setup and data definitions.

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
- [x] **9-1 — Same Sky matching implementation.** Reuses normal FMLCore posts and Confession Sky balloons; each new story is automatically queued for the admin-selected analysis provider and a Gemini pgvector embedding; eligibility counts completed analyses; Start Matching searches saved data locally; mutual accept/decline; configurable no-match retry timer. No duplicate writing flow or chat. Live end-to-end provider verification is still pending; see the handoff above.
- [ ] **9-2 — Matched-user chat.** Private conversations for mutually accepted Same Sky connections, with safety controls and no access to original private collection entries. *(implementation present; safety and production verification pending)*
- [ ] **10 — Real-time interactions.** WebSocket updates for core comments, reactions, and in-app notifications. *(planned; not started)*
- [ ] **11 — Email notifications.** Send real emails for reactions and comments on a user's posts. *(notification triggers remain planned; reusable SMTP transport/templates now exist for authentication)*
- **Voice rooms.** Folded into Stage 12; no separate standalone build.
- [ ] **12 — Voice rooms + full voice meeting rooms.** Includes the social audio rooms and full meeting-room experience. *(future; deferred for now)*
- [ ] **13 — Skin Studio.** Five user-selectable presentation skins—Calm Chaos, Social Classic, After Hours, Frappe, and Common Ground. Skins change layout, navigation treatment, typography, tokens, component presentation, and interaction styling while sharing the same features, APIs, permissions, and data. The default is Calm Chaos. Compact circle selection, local caching, authenticated persistence, accessibility, responsive behavior, and no-refresh switching are required. See [SKIN_STUDIO.md](SKIN_STUDIO.md). *(implementation in progress; full acceptance verification pending)*

## Back-end (FastAPI — `backend/app`)

- **models.py:** `User` (profile color/sticker/theme), `Post`, `Reaction` (unique per post+user), `Comment` (self-ref `parent_id`, one level deep), `Notification`, `UserBlock`, `UserMute`, `Report`, and Same Sky profiles, analyses linked directly to posts, pgvector embeddings, matches, attempts, and durable jobs.
- **taxonomy.py:** `CATEGORIES` (10), `MOOD_KEYS` (8), `REACTION_KEYS` (14). Mirrored in `front-end/lib/taxonomy.js`.
- **main.py endpoints:**
  - Auth: `POST /auth/signup`, `/auth/login`, `/auth/logout`; `GET /auth/me`; `auth_api.py` adds email verification/resend, Google start/sign-in/onboarding, options, and username availability. See [AUTHENTICATION.md](AUTHENTICATION.md).
  - Profile: `PATCH /profile`, `PATCH /profile/theme`, `POST /profile/avatar`
  - Posts: `POST /posts` (multipart), `GET /posts` (keyset paginated, optional auth → fills `my_reaction`), `GET /posts/{id}`
  - Explore: `GET /explore/taxonomy`, `GET /explore/daily-prompt`, `GET /explore/trending`, `GET /explore/random`; `GET /posts` also accepts category and mood filters.
  - Notifications: `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/{id}/read`, `POST /notifications/read-all`.
  - Safety: `GET /safety/blocks`, `GET /safety/mutes`, `POST` / `DELETE /safety/blocks/{user_id}`, `POST` / `DELETE /safety/mutes/{user_id}`, `POST /safety/reports`.
  - Same Sky: `GET /same-sky`; profile/preferences `PATCH /same-sky/profile`; opt existing posts and confessions into or out of matching; retry failed analysis; start and poll matching attempts; accept or decline a suggestion. Exact and near-duplicate checks run in the backend. No chat routes exist in 9-1.
  - Leaderboard: `GET /leaderboard` returns posts ranked by reactions from the last seven days, with offset pagination. Anonymous entries remain eligible and do not reveal the author.
  - Reactions: `PUT /posts/{id}/reaction` (set/change), `DELETE /posts/{id}/reaction`
  - Comments: `GET /posts/{id}/comments` (threaded, paginated), `POST /posts/{id}/comments` (comment or reply)
  - Media: `GET /media/...`
- **Auth:** JWT in httponly cookie `fml_session`. Per-IP limits complement a profile lock and configurable no-match cooldown. Alembic bootstraps and versions the schema; PostgreSQL uses pgvector for 768-dimensional embeddings. A separate database-backed worker analyzes each new post/confession and searches stored results for candidates.

## Front-end (`front-end`)

- **app/page.js:** logged-in → `Feed`; logged-out → landing.
- **Pages:** `app/login`, `app/signup`, `app/profile`, `app/explore`, `app/notifications`, `app/leaderboard`, and authenticated `app/same-sky`.
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

Stages 0–8 are complete. Stage 9-1 implementation is present; finish its live matching verification before treating it as fully delivered. Stage 9-2 (matched-user chat) is next after the owner explicitly approves its scope. Voice rooms remain folded into deferred Stage 12.

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

## Stage 9-1 implementation — Same Sky matching

The Stage 9-1 implementation is in v0.9.0. It uses a person's existing FMLCore feed
posts and Confession Sky balloons. Each new post and confession is queued for analysis
when saved. “Start matching” searches only the stored results.
Backend readiness
checks currently require 3 posts and 3 confessions analyzed,
Gemini structured analysis, backend exact and near-duplicate checks, pgvector semantic
search, candidate scoring with hard privacy/safety filters, two-sided match
acceptance, and a configurable retry timer after no match. People can block and report
suggestions. Original posts and AI summaries never appear in match previews. A connected match has
status only; there is no chat route or message storage in this stage.

### Planned Stage 9-2 — Matched-user chat

Build private chat only for a Same Sky pair with `connected` status. Recheck both
users' connection and block/report state on every read and send. Provide leave,
block, and report controls; never include or reveal the original collection
entries. Define message retention, pagination, delivery/retry behavior, and
whether chat uses the Stage 10 real-time transport before implementation.

## Future feature specifications

These requirements record the remaining roadmap. Follow the stage approval rule above before starting each stage.

### Stage 10 — Real-time interaction system

Implement authenticated WebSocket connections for new comments, replies, reaction-count updates, and notifications. Define event support for room participant updates and voice-room activity when Stage 12 adds rooms.

Requirements: authorize every event, handle reconnection, prevent duplicate events, persist notifications reliably, manage connections efficiently, and provide a graceful fallback so the app remains usable while disconnected.

### Stage 11 — Email notification system

Send transactional and activity email for reactions, comments, replies, mentions, and important account/security events.

Requirements: branded HTML templates; user notification preferences; email verification; unsubscribe for non-essential messages; batching; rate limits; retries for failed delivery; and safeguards against repeated or excessive activity emails.

### Voice rooms — Folded into Stage 12

Voice rooms have no separate delivery. Their social voice-room scope is included in the deferred Stage 12 plan below.

### Stage 12 — Voice rooms + full voice meeting rooms

Build a dedicated social audio experience where people can browse public rooms, create or join rooms, listen, request permission to speak, mute/unmute, raise a hand, view participants, and leave. The later full meeting-room experience is part of this same stage; its additional requirements will be scoped when the stage is scheduled.

Room setup includes a name, description, topic/category, public/private visibility, participant limit, and host/moderator roles. Initial categories: 2 AM Thoughts, Relationship Chaos, College Confessions, Work Is Killing Me, Just Vibing, and Unfiltered Conversations.

Technical and safety requirements: WebRTC audio with an SFU such as LiveKit or mediasoup (choose during Stage 12 planning); authenticated room access; microphone permissions; participant management; network-disconnect handling; host moderation; reporting and blocking; room closure and participant removal. Design for privacy and safety. Do not record audio by default.

This entire stage is deferred for now; propose and approve its detailed product and technical scope when Stage 12 is scheduled.

### Planned Stage 13 — Skin Studio

Skin Studio gives each person a complete visual experience without branching the
product into separate applications. The five skins are **Calm Chaos** (the default),
**Social Classic**, **After Hours**, **Frappe**, and **Common Ground**.
Each skin changes presentation—not product behavior—including the app shell,
navigation, page layout, typography, spacing, surfaces, component variants, and
motion treatment. Existing API contracts, authentication, content visibility,
permissions, Same Sky, chat, notifications, and all underlying business logic
remain shared.

The implementation must introduce a centralized skin registry and CSS-variable
token system; shared, skin-aware layouts and component variants; and the
`/settings/appearance` Skin Studio page with compact circular selectors that
apply immediately. A selected skin must update without a page reload, preserve
unsent client state and WebSocket connections, persist for signed-in users in
PostgreSQL, cache locally to avoid flash-of-default, and safely fall back to
Calm Chaos when a stored value is invalid. Every skin must meet the existing
responsive, keyboard, focus, contrast, semantic HTML, and reduced-motion bar.

The existing five-colour theme picker now lives in Skin Studio beneath the skin
circles, with System mode retained. Saved theme values remain unchanged and
control colors independently of skin layout and typography. The implementation sequence and detailed
acceptance checks are in [SKIN_STUDIO.md](SKIN_STUDIO.md).

### Delivery phases

1. **Phase 1 — Complete:** Dynamic themes, navigation indicators, button interactions, and integration with the core social features already built.
2. **Phase 2 — Planned:** WebSocket updates and real-time notifications, then email notifications.
3. **Phase 3 — Planned, deferred:** Stage 12 social voice rooms, full meeting rooms, WebRTC/SFU integration, room management, and moderation.
4. **Phase 4 — Planned:** Advanced community experiences; scope to be proposed later.
