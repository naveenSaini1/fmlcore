# FMLCore — Stage 13: Skin Studio

As of 12 November 2026, signed-in skin and color controls live in **Edit
Profile** (`/profile`). The standalone Skin Studio and signed-out appearance
picker remain available. The historical build notes below describe earlier
placements on Home.

**Status:** Implementation in progress. The shared provider, registry,
appearance screen, preference API, and migration are in the working tree;
database migration and end-to-end visual verification remain required before a
release.
**Product rule:** One platform, five personalities. Skins alter presentation
only; features, data, APIs, authentication, authorization, and business logic
are shared.

## Goal

Let every person choose how FMLCore feels without maintaining separate copies of
the product. A skin changes the app shell, navigation, layout, typography,
spacing, tokens, component treatment, and restrained motion across every
screen. It never changes access, content visibility, matching, chat, or safety
behavior.

## The five skins

The available skins are Common Ground, Calm Chaos, Social Classic, After Hours,
and Frappe. Common Ground is an optional, original design; Calm Chaos remains
the default.
Editorial and Digital Nostalgia have been removed; old selections fall back to
Calm Chaos. Frappe uses Inter, neutral surfaces, compact aligned cards, subtle borders, a
desktop sidebar, and matching form/button treatments. Below desktop width the
navigation returns to a wrapping top bar. The saved identifier is `frappe`;
the existing string preference supports it without another database migration.

| Key | Name | Direction |
|---|---|---|
| `common-ground` | Common Ground | Manrope headings, Inter body, sage and warm neutrals, quiet horizontal navigation, readable story cards, and a community rail. |
| `calm` | Calm Chaos | Default. Original Syne/Outfit/Caveat typography, dotted paper, bold borders, hard shadows, squared controls, and lightly tilted cards. |
| `social` | Social Classic | Familiar social structure, fixed left navigation, conventional cards, clear discovery. |
| `after-hours` | After Hours | Dark-first, high-contrast, sophisticated compact surfaces with controlled lime and purple accents. |
| `frappe` | Frappe | Inter typography, neutral compact surfaces, desktop sidebar, and aligned workspace cards. |

### Common Ground design and verification

`front-end/app/common-ground.css` owns this skin's tokens and presentation.
The goal is a comfortable, professional reading experience, with clearly
labelled navigation, restrained borders and motion, recognizable author and
anonymous states, and muted metadata. It also styles the composer, filters,
profile, notifications, Same Sky cards, chat bubbles, and Confession Sky
controls. Profile colors remain visible as an accent, with readable text on a
neutral identity card. The existing account preference API persists the
`common-ground` identifier without a new database migration.

Readable line length and separate page/panel/input surfaces informed the
design: [GOV.UK layout guidance](https://design-system.service.gov.uk/styles/layout/)
and [Radix surface roles](https://www.radix-ui.com/themes/docs/theme/color).
This is an original FMLCore design, not a copy of either design system.

Browser verification uses representative local API fixtures for Explore,
home, profile, notifications, Same Sky, chat, Confession Sky, and appearance at
1440, 768, and 390 CSS pixels. It checks skin selection, font selection, runtime
errors, and horizontal overflow. These visual checks do not replace live
provider/matching, message delivery, or cross-device account tests.

## Required experience

- Provide compact circular selectors on home and `/settings/appearance`.
  Each circle has an accessible full name, a short visible label, and a selected
  checkmark. Home uses a profile-led layout with stories and appearance controls;
  Edit profile opens the existing `/profile` page.
- Selecting a circle immediately applies and saves the skin without a page
  reload. Disable selection while saving and roll back on failure. This replaces
  the original large preview-card and separate Preview/Apply/Cancel design.
- Place a second row of compact color-theme circles beneath skins, replacing
  the navbar theme picker. Keep the existing five theme IDs and System option.
  Skin controls layout and fonts; theme controls backgrounds, text, surfaces,
  accents, borders, and controls across every skin. Both selections save
  independently, immediately, and roll back if persistence fails.
- Signed-out visitors access both selectors through the navbar's Skins & colors
  dialog (palette icon on mobile). It reuses Skin Studio, supports Escape and
  outside-click dismissal, and persists guest preferences locally. Signed-in
  customization remains on home, and account preferences take over on login.
- Apply every skin consistently to navigation, home/feed, post cards, buttons,
  typography, backgrounds, sidebars, notifications, profiles, Confession Sky,
  Same Sky, chat, Explore, leaderboard, and settings.
- Preserve unsent form content, page state, fetched data, and WebSocket
  connections while switching.
- Signed-in people receive cross-device persistence in PostgreSQL. Guests use
  the default or a local temporary choice. Invalid stored values fall back to
  `calm`.

## Architecture constraints

The shared shell and card markup now expose stable presentation classes.
`front-end/app/skins.css` owns the complete skin variants: Calm's original bold,
squared reading surfaces, Social Classic's desktop sidebar and conventional cards,
and After Hours' dock and focused dark reading column. Frappe keeps its compact workspace layout. Mobile variants
return to a single reading column and wrapping navigation. These changes keep
the same feature components mounted when switching skins.

Shared post cards use a compact reading rhythm: author and time on one line,
body aligned beneath the author, category/mood together, and short gaps before
reactions. On phones the action row uses the full card width to avoid excess
wrapping. Each skin retains its own typography, borders, and shadows.

- Use the existing Next.js App Router, React, JavaScript, Tailwind, Motion, and
  CSS variables. Do not introduce TypeScript.
- Create a centralized registry separated into skin metadata; colour,
  typography, spacing, border/radius, and shadow tokens; layout configuration;
  and component variants. Do not create one giant style object.
- Use a `SkinProvider`/context and a layout registry. Layouts position shared
  page content; they must not duplicate feed, chat, matching, or other business
  logic.
- Prefer semantic CSS variables and static class mappings. Do not rely on
  dynamically generated Tailwind class names.
- Adapt the current `ThemeProvider` and theme preference safely. Existing
  theme data must remain valid during migration and must never be silently
  overwritten.
- `app/theme-colors.css` loads after skin styles and owns palette tokens.
  Skin rules use semantic palette roles rather than fixed surface/text colors.
  This prevents a skin from masking the saved theme selection.

## Delivery phases

1. Audit the current global layout, navigation, CSS tokens, shared components,
   theme preference, and responsive behavior.
2. Add the skin registry, token layers, provider/context, local cache, and
   migration-compatible backend preference.
3. Add shared app-shell layout variants around shared page content.
4. Make shared components skin-aware; remove presentation assumptions that
   bypass semantic tokens.
5. Build the compact Skin Studio circle selector and selected-state feedback.
6. Persist and load the signed-in preference without flash-of-default.
7. Test all screens and all skins across desktop, tablet, and mobile.

## Acceptance checks

Verification builds can run with `NEXT_BUILD_DIR=.next-verify npm run build`
from `front-end/`. This keeps the live development server's `.next` manifests
separate and prevents build verification from corrupting its module cache.

Selection applies immediately on home and the appearance page. Failed preference
saves restore the previous skin, and local caching is
best-effort when browser storage is unavailable.

1. Switching changes the complete visual system without reload, state loss, or
   duplicate WebSocket connections.
2. A selected skin survives logout/login and appears on another device.
3. All routes and interactions, including Confession Sky, Same Sky, chat,
   notifications, and forms, remain functional in every skin.
4. No horizontal overflow, broken layout, inaccessible control, contrast
   failure, or reduced-motion regression is introduced.
5. Invalid preferences use Calm Chaos safely.
6. Automated coverage exercises registry validation/persistence and manual or
   browser coverage verifies the five-skin route matrix.

## Decisions confirmed by this specification

- `calm` / Calm Chaos is the default for new users.
- Skin selection is personal, not a global admin setting.
- Existing functionality is shared, not rewritten per skin.
- Stage 13 does not add product features or alter permissions.

## Approved color-theme treatment

The owner approved independent color themes alongside skins. Existing theme
preferences remain valid. Color circles live beneath the skin circles on home
and the appearance page, and there is no theme picker in the navbar.
