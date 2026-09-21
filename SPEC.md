# ZettleVault — Production Spec

Status: v2 · 2026-09-21 · decisions agreed in design interview (§2)
Working name: ZettleVault (rename freely; nothing depends on it)
Prototype reference: https://the-vault-2-0.base44.app/ — see Appendix A

## 1. What it is

A **semi-digital Zettelkasten**. Handwritten 3×5 cards in a physical box are the source of
truth; the app is the box's *index*: photograph a card, a vision model reads it into the
user's own metadata fields, the user confirms, and the card becomes searchable, linked to
other cards, and reachable by keyword and scripture passage.

- Each user has one private vault with **their own** ID format, card types, metadata fields
  and reference notation. No two people's paper systems match; the app adapts to the paper.
- Core is domain-neutral. **Bible study** is a per-user module (on for both initial users).
- Fleeting notes (scratch notebooks) are never digitized; cards only carry a text pointer to them.
- Invite-only. Expected users: 2. First user: the developer (hex IDs). Second: the prototype's
  author, who is happy with his prototype and has to be *won over* — see M4.

## 2. Decision log

| # | Decision |
|---|---|
| D1 | Invite-only; Google sign-in + email allowlist; invites via CLI |
| D2 | Vision LLM (Claude **Haiku 4.5**) for scanning. No OCR pipeline — saves ~$4/yr, adds a vendor. Model + image size chosen by measurement (§8.4) |
| D3 | AI's **only** job is reading cards. No AI-written definitions, glosses or citations anywhere |
| D4 | Fleeting reference = opaque text, stored verbatim, never parsed or linked |
| D5 | Card IDs sequential, stored as `int`; per-vault display **base (10/16)** and pad width |
| D6 | Card→card cross-references in v1. Notation is per-vault; default: bare ID in the body = card link, `#`-prefixed = fleeting pointer. Links keyed by target *number* so forward refs to unscanned cards are legal |
| D7 | Metadata is user-defined: **field defs** from a closed set of kinds, with **aliases**, optional **per-type scoping**, and an **unmapped-lines** flow that standardizes a messy back-catalogue during review |
| D8 | Own the stack, no lock-in: TypeScript end-to-end, plain **Postgres**, Docker Compose on an **Oracle Cloud Always Free** ARM VM. Tested restore script is the exit strategy |
| D9 | Devotions kept (Bible module). Reminders / tasks / push **cut** |
| D10 | Additions in v1: review inbox, scripture index, browsable fields, Markdown export, random card, re-scan a side. v1.x: printable keyword register |
| D11 | Keyword page = own notes → excerpts from own cards (★ = "defines it") → Strong's entries picked from a local public-domain table → Webster 1828 excerpt + dictionary links |
| D12 | Base44 importer deferred to the last milestone; v1 is dogfooded on the developer's own cards first |

## 3. Vault settings (per user)

| Setting | Example (dev) | Example (friend, "Classic") |
|---|---|---|
| `id_base`, `id_width` | 16, 4 → `0A4F` | 10, 4 → `0042` |
| `layout_hint` (free text → scanner) | "ID top-right, title top-centre, date top-left, `Label: value` lines bottom-left" | "Front: metadata. Back: content." |
| `ref_hint` (free text → scanner) | "Bare 4-hex IDs in the body are card refs. `#XXXX` is a fleeting page — never a card." | same default |
| `bible_mode` | on | on |
| `translation` (BLB links) | `lsb` | `lsb` |
| Card types | Lecture, Sermon, Book, … | Sermon, … |
| Field defs | §6 starter template | Classic template |

New users pick a starter template, then edit freely.

## 4. Scope

**In v1**
- Google sign-in, allowlist. One user = one vault, fully isolated.
- Scan (front+back) → **draft saved immediately** → AI fill → **review inbox** → confirm. "Scan next" for back-to-back capture. Manual entry. Re-scan one side. Edit, delete.
- User-defined types, fields, aliases, per-type fields, unmapped-line handling (§7 R6).
- Full-text search over everything; browse-by-value for any field flagged browsable (People, Class, Source…).
- Cross-references with backlinks; dangling refs shown as "not in vault yet".
- Keywords: tap-to-mark in transcriptions, index, keyword page per D11.
- Bible module: scripture detection + index (book → chapter → cards/devotions), BLB deep links (new tab), Strong's picker, Devotions.
- Random card / "on this day" on Home.
- Export: `vault.json` + photos + one Markdown file per card (`[[links]]`, front-matter). Importable by restore script; openable in Obsidian.
- Installable responsive web app (manifest; no service worker in v1).

**v1.x** printable keyword register · passkeys as second sign-in · reminders (only if missed)

**Out** offline capture · sharing/multi-user vaults · digital-only hub notes (a hub is a physical card with many links) · typed links · graph view · embeddings/"related cards" · chat-with-vault · spaced repetition · per-type layout hints · AI-generated reference content of any kind

## 5. Architecture

```
phone/laptop ── HTTPS ──> caddy ──> app (Node, one process) ──> postgres
                                      ├─ serves built SPA + /api (REST/JSON)
                                      ├─ photos on a disk volume, served after ownership check
                                      └─ Claude API (scan only)
nightly: pg_dump + photos ──rclone──> S3-compatible bucket (B2 or R2 free tier)
```

- **Repo**: one TypeScript workspace — `server/`, `web/`, `shared/` (zod schemas + the field-kind registry, imported by both sides so form, validation and AI schema cannot drift).
- **Server**: Node 22, Hono, `postgres` driver, **plain SQL migrations** (tiny ordered runner + `schema_migrations` table; no ORM — the schema and RLS policies are the design, keep them legible). `sharp` for re-encode/thumbnail/**EXIF strip** (GPS). `openid-client` for Google OIDC. `bible-passage-reference-parser` for scripture refs (deterministic; not AI).
- **Web**: React, Vite, Tailwind, TanStack Query. Prototype's visual language kept (cream `#f5f1e8`, forest `#244638`, serif headings). Camera: `getUserMedia` with a 3×5 guide; fallback `<input type="file" accept="image/*" capture="environment">`.
- **No** queue, worker, cron-in-app, search service, or state library. Scan processing is an in-process promise; a startup sweep retries drafts stuck in `processing` > 2 min.
  `// ponytail: in-process jobs — fine for 2 users; move to a jobs table + worker if scans ever pile up.`
- **Hosting**: Oracle Always Free ARM VM (Ubuntu), Docker Compose: `postgres:17`, one-shot `migrate` (the only container with owner credentials; also runs the invite CLI), `app`, `caddy`. Deploy = `scripts/deploy.sh` on the VM (`git pull && docker compose up -d --build`): builds natively on ARM, so no registry, no cross-compilation, no deploy secrets in GitHub. Server runs its `.ts` directly on Node 24 (type stripping) — no server build step. Open 80/443 in **both** the Oracle security list and the host firewall (classic gotcha).
- **Costs**: VM $0 · backups $0 · AI ≲ $1/mo · domain ≈ $10/yr (needed for TLS + Google OAuth; a free DuckDNS name also works).

## 6. Data model (Postgres)

Every user-owned table: `id uuid pk default gen_random_uuid()`, `user_id uuid not null`, `created_at`, `updated_at`, and an RLS policy `user_id = current_setting('app.user_id')::uuid` for all commands. The app connects as a **non-owner role** (RLS is bypassed for owners/superusers); migrations run as owner.

```sql
-- identity
users           (email citext unique, name,
                 id_base smallint check (id_base in (10,16)) default 10, id_width smallint default 4,
                 layout_hint text, ref_hint text, bible_mode bool default false, translation text default 'lsb')
allowed_emails  (email citext primary key)
sessions        (token_hash bytea primary key, user_id, expires_at)

-- vault configuration
card_types      (name text, position int, unique (user_id, name))
field_defs      (key text, label text,
                 kind text check (kind in ('text','long_text','date','tags','choice','scripture')),
                 aliases text[] default '{}',          -- labels as actually written on cards
                 type_ids uuid[] default '{}',         -- empty = applies to all card types
                 options text[] default '{}',          -- for 'choice'
                 browsable bool default false, position int, archived bool default false,
                 unique (user_id, key))

-- cards
cards           (number int,                           -- null only while a draft has no confirmed ID
                 status text check (status in ('processing','needs_review','saved')),
                 type_id uuid references card_types, title text, date date,
                 meta  jsonb default '{}',             -- { field key: string | string[] }
                 extra jsonb default '[]',             -- [{label, value}] unmapped lines kept as-is
                 transcription text,
                 front_image text, back_image text, entry_method text check (entry_method in ('scan','manual')),
                 scan_error text, search tsvector)
                 -- unique (user_id, number) where number is not null
                 -- GIN(search), GIN(meta jsonb_path_ops); search maintained by trigger:
                 --   title, transcription, all meta values, extra values
card_links      (from_card_id uuid references cards on delete cascade, to_number int,
                 unique (from_card_id, to_number))     -- resolves by join on (user_id, number)

-- keywords
keywords        (word citext, short_note text, notes text, unique (user_id, word))
keyword_marks   (keyword_id references keywords on delete cascade,
                 card_id references cards on delete cascade,
                 devotion_id references devotions on delete cascade,
                 start_offset int, end_offset int, label text, is_definition bool default false,
                 check (num_nonnulls(card_id, devotion_id) = 1))
keyword_strongs (keyword_id references keywords on delete cascade, strongs_id text references strongs_entries,
                 primary key (keyword_id, strongs_id))

-- bible module
devotions       (date date not null, scripture text, content text, subjects text[] default '{}')
scripture_refs  (card_id / devotion_id (one non-null, cascade), raw text,
                 book smallint, chapter_start smallint, verse_start smallint,
                 chapter_end smallint, verse_end smallint)      -- parsed parts null if unparseable
                 -- index (user_id, book, chapter_start)

-- global read-only reference data (no user_id, no RLS; loaded by one-off scripts)
strongs_entries (id text primary key,  -- 'G1577' / 'H430'
                 lang text, lemma text, translit text, definition text, kjv_def text)  -- GIN on kjv_def FTS
webster_1828    (word citext, definition text)
```

Starter template (developer's vault; "Classic" mirrors the prototype's fields):

| Field | Kind | Aliases | Types |
|---|---|---|---|
| Person | text, browsable | Prof, Speaker, Author, Teacher | all |
| Source | text, browsable | Book, Series, Textbook | all |
| Passage | scripture | Text, Scripture | all |
| Tags | tags | Subjects, Topics | all |
| Fleeting | text | — | all |
| Class | text, browsable | Course | Lecture |
| Pages | text | pp. | Book |

Core (not field defs): number, title, date, type, transcription, photos.

## 7. Rules

- **R1 Numbering.** On confirm: use the ID read from the card if present, else suggest `max(number)+1`; user can override. Insert under a per-user advisory lock; unique index rejects duplicates with a clear message. Gaps allowed, numbers never auto-reused. Input/display go through one `formatId/parseId(base,width)` pair in `shared/`.
- **R2 One keyword index.** Confirming a card upserts a `keywords` row for every value of every `tags`-kind field; marking a word upserts keyword + mark. "Linked cards" = cards with a mark ∪ cards whose tags contain the word — one server-side query.
- **R3 Mark anchoring.** On transcription/content edit, delete marks where `substring(text, start, end) ≠ label`; tell the user how many were dropped. (Never wrong; upgrade to diff re-anchoring only if it annoys.)
- **R4 Marking UX.** Tap a word = toggle mark; tapping next to a mark extends it to a phrase. Long-press a mark → ★ `is_definition`. Keyboard-operable.
- **R5 Cross-refs.** Scanner proposes refs per `ref_hint`; candidates must parse in the vault's base at exactly `id_width` digits; review form shows them as removable chips; add/remove any time on the card page. Rendered inline where the ref text appears verbatim in the transcription. Card page shows **Links to** / **Referenced by**; unresolved targets show "`0042` — not in vault yet". The fleeting field is never scanned for refs.
- **R6 Unmapped lines.** A scanned `Label: value` with no matching label/alias appears in review with: **map to field** (label saved as alias) · **new field** (created from the label) · **keep** (→ `extra`, still searchable). Settings lists fields with usage counts to guide merging.
- **R7 Type scoping.** Review/edit forms show fields whose `type_ids` is empty or contains the card's type. Changing type never deletes values; hidden values persist in `meta`.
- **R8 Scripture.** On save, run the reference parser over `scripture`-kind values **and** the transcription; rewrite that card's `scripture_refs`. Unparseable values are kept raw ("Romans (overview)" → book-level ref; anything else → raw only).
- **R9 Untrusted AI.** Scanner output is schema-validated server-side; `""`/`"null"`/`"none"`/`"n/a"` → null; rendered as text, never HTML. Nothing becomes `saved` without user confirmation.
- **R10 Deletes.** Card delete removes its photos, marks, links-from, scripture refs (links *to* it become dangling — correct). Keyword delete removes marks, not cards. All destructive actions confirm.

## 8. AI — scanning only

### 8.1 Pipeline
1. Client downsizes each photo (start: 1568 px long edge, JPEG ~85) and uploads front (+ back).
2. Server stores photos, inserts card `status='processing'`, responds immediately (→ "Scan next").
3. One Claude call, both images, structured JSON output built from the vault's config:
   `{ id, title, date, type, fields{key→value}, unmapped[{label,value}], transcription, card_refs[] }`
   Prompt carries: `layout_hint`, `ref_hint`, id base/width, type names, field defs (label, kind, aliases, type scope, options). Transcription preserves line breaks exactly.
4. Validate (R9) → `needs_review`. Failure → `needs_review` with `scan_error`; photos are already safe.
5. User confirms in the inbox → R1, R2, R5, R8 run → `saved`.

### 8.2 Model & config
`SCAN_MODEL=claude-haiku-4-5` (env). Official `@anthropic-ai/sdk`. Key only on the server.

### 8.3 Cost (list prices: Haiku 4.5 $1 / $5 per MTok in/out; image tokens are an estimate — confirm with token counting on a real photo)
~6.5k in + ~0.6k out per card ≈ **$0.01/card**. 10 cards/week ≈ $0.40/mo. Digitizing a 500-card box ≈ $5 once.
Guards: 100 scans/user/day; 5 MB upload cap; **$5/mo spend limit set in the Anthropic console**.

### 8.4 Measurement before tuning
`npm run eval-scan`: re-runs the scanner over already-confirmed cards (photo + human-corrected data = ground truth) for a matrix of model × image size; reports per-field accuracy and transcription character error rate. Run after the first ~20 confirmed cards; pick the cheapest cell that holds quality. Escalate to Sonnet 5 only on evidence.

## 9. Screens

| Route | Purpose |
|---|---|
| `/` | Scan · Inbox (count) · search · random card / on this day · recent |
| `/scan` | Camera w/ guide: front → back → "Scan next" or "Review now"; "Enter manually" |
| `/inbox` | Drafts: processing / needs review / failed |
| `/cards`, `/cards/:number` | List + filters; detail: fields, transcription w/ marks + inline refs, Links to / Referenced by, photos (zoom), re-scan side, edit, delete |
| `/browse/:field`, `/browse/:field/:value` | Browse-by-value for browsable fields |
| `/keywords`, `/keywords/:word` | Index (word + short note or first pinned Strong's gloss); page per D11 |
| `/scripture`, `/scripture/:book/:chapter` | Bible module: passage index |
| `/devotions` | Bible module: dated journal with marking |
| `/settings` | ID format, hints, types, fields (aliases, scope, browsable, usage counts), Bible mode, export, sign out everywhere |

## 10. Bible module

One directory per side (`server/bible`, `web/bible`), one flag (`users.bible_mode`). Contributes: the `scripture` field kind; R8 + scripture index; BLB deep links (passage, Strong's lexicon, word search — always new tab, never iframe); Strong's picker (search `strongs_entries.kjv_def` for the keyword → user pins entries); Devotions; Webster 1828 excerpt stays core (it's just a dictionary).

Reference data:
- Strong's: `github.com/openscriptures/strongs` (repo confirmed; public domain) → `npm run load-strongs`.
- Webster 1828: candidate `github.com/man4christ/1828-dictionary` (JSON; **quality unverified**). If unusable: link-outs only (webstersdictionary1828.com, merriam-webster.com). Never block a milestone on this.

A future domain = a sibling module contributing its own field kind(s) and pages. No plugin system until there is a second module.

## 11. Security & privacy

- OIDC code flow + PKCE; email must be verified and in `allowed_emails`; otherwise "invite only" and no row created.
- Sessions: random 256-bit token, stored hashed; cookie `HttpOnly; Secure; SameSite=Lax`; 30-day sliding expiry; "sign out everywhere" deletes rows. CSRF: SameSite + JSON-only API + Origin check on mutations.
- Every request: `BEGIN; SET LOCAL app.user_id = …;` → RLS is the backstop for any missed `WHERE`.
- Photos: random filenames under `/data/photos/<user_id>/`, never served statically; EXIF stripped on ingest.
- Upload validation: magic-byte sniff, size cap, re-encode through `sharp`.
- Secrets via env file on the VM (not in the image, not in git). Dependabot on.
- Photos of private notes are sent to Anthropic for transcription — state this on first scan.

## 12. Operations

- **Backup** (host cron, 03:00): `pg_dump -Fc` (verified readable) + `rclone copy` of photos → bucket (copy, not sync: an accidental local delete must not propagate); keep 30 dailies; heartbeat ping to healthchecks.io (alerts when a backup *doesn't* happen).
- **Restore**: `scripts/restore.sh <date>` on a fresh VM = compose up + pg_restore + photo sync. **Rehearsed once before first real use**; this is also the answer to Oracle reclaiming an idle instance. External uptime ping doubles as keep-alive.
- **Observability**: structured JSON logs (docker), `/healthz`, Sentry free tier (web + server), per-scan token usage logged.
- **Targets**: list/search < 300 ms p95 at 10k cards; scan draft created < 2 s; AI fill tolerates ~15 s.
- **Accessibility**: labelled inputs, focus-trapped dialogs, AA contrast, keyboard marking.

## 13. Tests (the ones that protect the data)

1. RLS isolation — user A cannot read/write B's rows through any endpoint, including by guessing card numbers.
2. Numbering — concurrent confirms never duplicate; hex/decimal `formatId/parseId` round-trip.
3. R3 mark invalidation; R4 phrase extension.
4. R5 ref candidate filter (width/base), dangling → live resolution, fleeting never linked.
5. R6 map/new/keep flows; alias then auto-maps next scan.
6. R8 parser: ranges, book-only, garbage.
7. R9 sanitizer on hostile/malformed model output.
8. Export → restore round-trip equals original.
Node's built-in test runner against a real Postgres container; no mocks of the database. A catalog test fails if any table with a `user_id` column lacks RLS.

## 14. Milestones

- **M0 Skeleton, production-shaped from day one** — repo, migrations + RLS, Google auth + allowlist CLI, Compose, deploy to Oracle, backup **and rehearsed restore**.
- **M1 Cards** — settings (ID format, hints, types, fields), scan → inbox → review (R1, R6, R7, R9), manual entry, list/detail/edit/delete, re-scan, search, browse, random card, export. Then `eval-scan` on the first ~20 cards.
- **M2 Links & keywords** — R5 cross-refs + backlinks, marking (R3, R4), keyword index/page with excerpts + ★, Strong's table + picker, Webster.
- **M3 Bible** — scripture index (R8), BLB links, Devotions.
- **M4 Win him over** — "Classic" template; Base44 importer (Appendix A.3); demo on his own 200 cards: follow a cross-ref, open Romans 8, batch-scan 10 cards, edit a transcription without breaking highlights, export to Markdown.

## 15. Open items

- Developer's real field list will emerge from R6 during the first ~50 scans; revisit the starter template then.
- Webster 1828 dataset quality (§10).
- Confirm current Oracle Always Free terms (idle reclamation policy, ARM capacity in chosen region) at sign-up.
- Image-token estimate → measure (§8.3).
- Does Haiku 4.5 hold up on *this* handwriting? → §8.4 answers it.

---

## Appendix A — Prototype reference

### A.1 What it has
Routes `/`, `/scan`, `/cards`, `/cards/:id`, `/keywords`, `/keywords/:word`, `/devotions`, `/settings`.
Entities: **Flashcard** (`flashcard_number` zero-padded string, `flashcard_type`, `title`, `person`, `source`, `date`, `subjects[]`, `scripture` (single), `fleeting`, `additional_info`, `transcription`, `image_url`, `back_image_url`, `entry_method`, `link_status`, `keyword_marks[]{start,end,label}`) · **FlashcardType** · **Keyword** (`word`, `short_definition`, `definition`, `flashcard_ids[]`, `research{…}`) · **Devotion** (`date`, `scripture`, `content`, `subjects[]`, `keyword_marks[]`) · **Notification**.
Four browser-side LLM calls: front scan, back scan, bulk keyword glosses (on every `/keywords` visit), keyword research with web context.

### A.2 Why it isn't production-ready
| Problem | Fixed by |
|---|---|
| Every list capped at 500 rows, searched client-side | server-side FTS + pagination |
| Card number = max(last 500)+1 in the browser, no uniqueness | R1 |
| Marks are raw offsets; edits shift them | R3 |
| Keyword↔card links stored three ways, reconciled in the client | R2 |
| LLM calls + prompts in the client; glossing re-runs per page load | §8; D3 removes the rest |
| Reminders only fire in an open tab | D9 (cut) |
| BLB in an iframe | new-tab deep links |
| AI-"sourced" definitions with AI-supplied URLs | D3, D11 |
| Photos at public URLs | §11 |
| No export/backup | §4 export, §12 |
| Only one scripture ref stored | R8 |
| Fixed metadata, decimal-only IDs, no card links | D5–D7 |

### A.3 Importer (M4, one-off script — not a feature)
`npm run import-base44 -- --user <email> ./export/ [--dry-run]`
Input: per-entity export from the Base44 dashboard (unverified), or a console snippet run while signed in that dumps all entities to JSON (the app's own data calls make this reliable). Maps columns → Classic template; **preserves card numbers exactly**; downloads photos from their URLs; single `scripture` → list, then R8 over transcriptions; keeps a mark only if text-at-offset equals its label, reports the rest; carries over his own keyword notes (AI `research` blobs are dropped per D3, except user-edited definition text → `notes`). Idempotent upsert by card number, so it can run early for testing and again at cutover. Nothing is deleted on Base44.
