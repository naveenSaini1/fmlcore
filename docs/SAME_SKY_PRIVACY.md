# Same Sky privacy and operations (Stage 9-1)

Same Sky uses a person's FMLCore posts and Confession Sky balloons to prepare
broad experience signals for peer matching. Each new post or confession is saved
normally and then queued for private AI analysis. The analysis and embedding are
stored against that post. “Start matching” later compares those saved results and
does not call either AI provider. Same Sky is not therapy, diagnosis, verification,
or a promise that a suitable match exists.

## What people control

- Each new post/confession is sent to the AI analysis provider selected in the
  admin console. Gemini is selected by default. Gemini also creates the
  matching embedding. The
  composers disclose this before publishing. Private confession visibility
  controls who can see the confession in FMLCore, not whether it is analyzed.
- Each new story is analyzed once. Older stories are not automatically
  backfilled. Starting a search is a separate choice and requires meeting the
  configured readiness thresholds.
- Posts remain managed through the existing post and confession flows.
  Removing a post from Same Sky deletes its analysis and embedding, withdraws
  pending suggestions, and clears derived theme labels from existing
  connections. Deleting the original post also deletes its Same Sky record.
- A person can decline a suggestion; that pair is not suggested again. People
  can block or report each other. Both people must accept before a match is
  marked connected.
- Stage 9-1 has no direct messaging. Chat is planned for Stage 9-2.

## What leaves FMLCore

Every new post or confession is sent from the backend to the selected provider
(Gemini or Groq) for structured theme analysis. Gemini creates the matching
embedding regardless of the selected analysis provider. Each analysis and
processing status is stored on a row linked directly to its normal post. The
browser never receives provider API keys. Original post text is never returned
to another user.
Match previews contain a limited public profile, broad shared-theme labels, and
an explanation; they do not contain source text, analysis summaries, safety
signals, or match scores.

**Use a Gemini API project with Cloud Billing enabled. Do not use the unpaid
quota for Same Sky stories.** Google's current Gemini API terms say content sent
through unpaid services may be used to improve Google products and machine
learning technologies. For paid services, Google says prompts and responses are
not used for product improvement. Operators must verify that billing is active
for the configured project and set `GEMINI_PAID_SERVICE_CONFIRMED=true` only
after that check. The setting is an operator assertion; FMLCore cannot verify
Google billing status itself. Recheck Google's terms before changing providers
or account configuration. [Gemini API terms](https://ai.google.dev/gemini-api/terms)

When Groq is selected in the admin console, story text is also sent to the
configured Groq account for analysis. Review its current [data controls](https://console.groq.com/docs/your-data)
before selecting it.

## Stored data and deletion

- Analysis status, structured themes, summaries, and the direct post link are
  stored in `same_sky_analysis`. The original text stays in `posts`.
- A 768-value embedding and its model identifier are stored in
  `same_sky_embeddings`, keyed by the same post ID. Both tables are private
  and used only for Same Sky matching.
- Background jobs contain post or attempt IDs, not submitted story text.
- Deleting the original post cascades to its analysis and embedding.
- A connected relationship may remain after either person withdraws or deletes
  a selected post, but its derived themes are cleared. There is no conversation
  data in Stage 9-1.
- Database backups can retain deleted rows until the operator's backup-retention
  window expires. Define and publish that window before opening Same Sky to the
  public; restore procedures must preserve the same access controls.

## Model and matching safeguards

The analysis model uses a fixed schema and a controlled vocabulary for themes,
contexts, and emotional language. It is instructed not to diagnose people, quote
identifying details, or treat similar experiences as proof of copying. Exact
text fingerprints are HMACs using `SAME_SKY_HASH_SECRET`, not raw text hashes.
A matching HMAC across different users flags an exact duplicate. A close
semantic neighbor triggers a pairwise comparison using the selected provider;
semantic similarity alone does not flag an entry. A model's opinion about one
story by itself never blocks it.
The browser has no duplicate-attestation action. These checks run in the
backend, and flags never ban an account. Text alone cannot establish whether a
personal story is factually true, so Same Sky does not label stories as false.

Eligibility is computed on the backend and requires the configured number of
successfully analyzed regular posts and confessions.
Readiness is not an authenticity judgment. Matching uses pgvector similarity plus shared
broad themes, consistency across multiple entries, and optional category
preferences. Current eligibility, matching-enabled state, and block relationships
are hard filters. Declined pairs are excluded from later searches.

When a person starts a search, the background service compares existing database
entries and creates the result. That action makes no analysis-provider call.

A matching attempt is serialized by locking the user's Same Sky profile and
rejecting another active attempt. After a completed search finds no match, the
backend stores the next retry timestamp in UTC using
`SAME_SKY_RETRY_MINUTES`. The local development setting is one minute for
testing; production defaults to one day. Future admin controls can update this
setting without changing the matching flow.

## Configuration

Set these on the backend only:

- `GEMINI_API_KEY`: a server-side key for the billing-enabled project.
- `GEMINI_PAID_SERVICE_CONFIRMED=true`: operator attestation described above.
- `GEMINI_MODEL`: structured analysis model; default `gemini-3.8-flash`.
- `GEMINI_EMBEDDING_MODEL`: embedding model; default `gemini-embedding-001`.
- `GROQ_API_KEY` and `GROQ_MODEL`: optional credentials for selecting Groq as
  the analysis provider. Gemini remains required for embeddings.
- `SAME_SKY_EMBEDDING_DIMENSIONS=768`: must match the database vector column.
- `SAME_SKY_REQUIRED_POSTS=3` and `SAME_SKY_REQUIRED_CONFESSIONS=3`: backend eligibility thresholds. Change these settings and restart the API and worker to adjust the requirement; an admin page can manage them later.
- `SAME_SKY_HASH_SECRET`: separate long random secret in production.
- `SAME_SKY_RETRY_MINUTES`: cooldown after a no-match result; default 1440
  minutes in production. Local development uses 1 minute.

The API container applies Alembic migrations before serving. The deployment
needs PostgreSQL 16 with pgvector installed and the separate
`same-sky-worker` service. The worker retries failed jobs with backoff and stops
after six attempts; a user can request analysis again or edit the entry.

## Safety boundary

AI-generated labels are estimates and are never shown as diagnoses or proof.
Stories with model-flagged immediate threats, coercion/exploitation, or targeted
harassment are kept out of matching pending the user's review. The product must
not promise crisis response or replace qualified support. People can report or
block a match at any time.
