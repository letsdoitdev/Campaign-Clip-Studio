# Build Plan: Campaign Clip Studio

An AI tool for political consultants. A consultant creates a campaign per client, uploads
videos they already have (debates, town halls, interviews, opponent footage), types the idea
for a post, and the tool finds the best matching moment inside that footage, writes a native
caption, and lets them preview and export a finished clip.

The AI only ever uses footage the consultant uploaded into that campaign. It does not scrape
the web.

---

## 0. How to use this document with Claude Code

Do not paste this whole file and expect one finished app. Instead:

1. Put this file in your repo as `BUILD_PLAN.md`.
2. Start Claude Code in the repo and tell it to read `BUILD_PLAN.md`.
3. Build one phase at a time, in order (Section 8). After each phase, run the app and confirm
   it works before moving on. This is how you actually get a working site instead of a pile of
   half-wired files.
4. The single most important thing to prove early is Phase 4 (idea to correct clip). If that
   works, you have a product. Everything else is plumbing you already know how to build.

A ready-to-paste kickoff prompt is at the very bottom (Section 11).

---

## 1. The core user flow

1. Consultant signs up and logs in.
2. Creates a campaign and fills in the candidate's details (name, party, office, a few notes
   about their message and the race).
3. Uploads one or more videos into that campaign. Each video is transcribed automatically.
4. Clicks "New post" and types an idea, e.g. "opponent dodging on whether he'd raise the gas
   tax."
5. The tool searches only that campaign's transcripts, returns the 1 to 3 best matching
   moments, each with: the timestamp, the exact quote, why it fits, a suggested platform, and a
   ready caption.
6. Consultant previews a moment (video jumps to that timestamp), edits the caption if they want,
   and either copies the caption or exports the cut clip.

---

## 2. Tech stack

Chosen to be lean and to reuse what you already have.

- **Next.js (App Router) + TypeScript** — full-stack React, deploys to Vercel.
- **Tailwind CSS** — styling.
- **Supabase** — auth, Postgres database, and file storage for the videos. One service covers
  three needs.
- **Anthropic API (Claude)** — the matching and caption generation. Use Claude for the
  reasoning step.
- **AssemblyAI** — transcription with word-level timestamps and speaker labels. This is the one
  new account you need. (Deepgram is a fine alternative; Whisper works but speaker labels are
  weaker, which hurts on debates with two people talking.)
- **ffmpeg** — clip cutting, vertical crop, burned-in captions. Server-side, with caveats noted
  in Section 9.

Keep provider sprawl low. This list is the whole thing.

---

## 3. Data model (Supabase / Postgres)

Enable Row Level Security on every table so each user only sees their own data.

```sql
-- profiles: extends Supabase auth.users
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz default now()
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  candidate_name text,
  party text,
  office_sought text,
  notes text,                 -- message, key issues, race context
  created_at timestamptz default now()
);

create table videos (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  title text,
  storage_path text not null, -- path in Supabase storage bucket
  duration_seconds numeric,
  status text not null default 'uploaded', -- uploaded | transcribing | ready | failed
  created_at timestamptz default now()
);

create table transcript_segments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id) on delete cascade,
  start_seconds numeric not null,
  end_seconds numeric not null,
  speaker text,               -- e.g. "A" / "B" from diarization
  text text not null,
  created_at timestamptz default now()
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  brief text not null,        -- the consultant's idea
  created_at timestamptz default now()
);

create table post_clips (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  video_id uuid not null references videos(id) on delete cascade,
  start_seconds numeric not null,
  end_seconds numeric not null,
  quote text,
  reason text,                -- why this moment fits the brief
  platform text,              -- suggested platform
  caption text,
  export_path text,           -- set once exported
  created_at timestamptz default now()
);
```

RLS policy pattern for each table: a row is visible/editable only if it traces back to
`owner_id = auth.uid()` (directly for campaigns, via the campaign for the rest).

Storage: one private bucket, e.g. `campaign-videos`, with policies scoped to the owner.

---

## 4. Architecture: how a request flows

**Upload + transcribe**
Upload file to Supabase storage -> insert `videos` row (status `uploaded`) -> server route
submits the file to AssemblyAI and sets status `transcribing` -> on completion, store the
returned segments into `transcript_segments` and set status `ready`.

**Idea to clip (the magic)**
Consultant submits a brief for a campaign -> server route loads every `transcript_segments` row
for that campaign's ready videos -> builds a single Claude call with the brief plus those
segments -> Claude returns JSON with the best matching moments and captions -> store as
`post_clips` -> render to the user.

For the MVP, do not build a vector database. A handful of videos per campaign fits in Claude's
context window, so just hand all the segments to Claude and let it pick. Add embeddings later
only when a campaign has hours of footage (Section 10).

**Export**
User picks a clip -> server route runs ffmpeg on the source video with the start/end, optional
9:16 crop and burned captions -> store the output and give a download link.

---

## 5. Pages and screens

1. **Auth** — Supabase email + password (or magic link). Login and signup.
2. **Dashboard** — list of the user's campaigns, "New campaign" button.
3. **Campaign page** — candidate details (editable), video library with upload and per-video
   status, list of past posts.
4. **New post** — a text box for the idea, a submit button, then a results area showing the
   returned clips as cards (quote, reason, platform, caption, "Preview", "Export").
5. **Clip preview** — an HTML5 `<video>` element that seeks to `start_seconds`, an editable
   caption field, "Copy caption" and "Export clip" buttons.

Design direction: clean, fast, professional, slightly editorial. Think a sharp internal tool,
not a flashy landing page. Generous spacing, one accent color, clear status states for
transcription (uploading / transcribing / ready / failed). No clutter.

---

## 6. API routes

- `POST /api/campaigns` — create a campaign.
- `POST /api/videos` — record an uploaded video and kick off transcription.
- `POST /api/transcribe/submit` — send a video to AssemblyAI, set status `transcribing`.
- `GET  /api/transcribe/status?videoId=` — poll AssemblyAI; on done, save segments, set
  `ready`. (Or use an AssemblyAI webhook if you prefer; polling is fine for the MVP.)
- `POST /api/posts` — body `{ campaignId, brief }`. Runs the matching call, stores and returns
  clips. This is the heart.
- `POST /api/export` — body `{ clipId }`. Runs ffmpeg, returns a download URL.

Use the Supabase service-role key only in server routes, never in the browser.

---

## 7. The AI layer (this is the product)

### 7a. Transcription
Submit each video to AssemblyAI with speaker labels on. Store each utterance as one
`transcript_segments` row with `start_seconds`, `end_seconds`, `speaker`, `text`.

### 7b. The matching + caption call
One Claude call does both finding the moment and writing the caption. Force JSON output.

System prompt (sketch):

> You help a political consultant turn a post idea into a ready-to-post social clip, using ONLY
> the transcript segments provided. You are given a candidate profile, the consultant's idea,
> and a list of transcript segments (each with an id, video id, speaker, start and end seconds,
> and text). Find the 1 to 3 segments that best deliver the idea as a short social clip. Prefer
> moments that stand on their own without context, land a clear point, and are short (ideally
> under 45 seconds). Never stitch words together or invent a quote; only use a real contiguous
> moment. For each pick, write a caption that sounds like a sharp, internet-native person, not a
> press release: short, punchy, no hashtags-soup, no jargon. Suggest the best platform. Respond
> with ONLY valid JSON, no preamble, in this shape:
> `{ "clips": [ { "video_id": "...", "start_seconds": 0, "end_seconds": 0, "quote": "...",
> "reason": "...", "platform": "...", "caption": "..." } ] }`

User message: the candidate profile (name, party, office, notes), the brief, and the segments
serialized compactly (one line per segment: id, video_id, speaker, start, end, text).

Parse the JSON defensively: strip any code fences, `JSON.parse`, and if it fails, retry once
asking Claude to return JSON only. Map each returned clip to a `post_clips` row.

Recommended model: a fast Claude model for the MVP so it feels snappy; move to a stronger model
if matching quality on real footage isn't good enough. Test this before optimizing anything
else.

---

## 8. Build phases (do these in order)

- **Phase 0 — Scaffold.** Next.js + TypeScript + Tailwind. Supabase client set up. Env vars
  wired. A bare logged-out home page that builds and runs.
- **Phase 1 — Database + auth.** Run the SQL from Section 3, add RLS policies, the storage
  bucket, and Supabase email auth. Login, signup, logout working.
- **Phase 2 — Campaigns.** Create and list campaigns. Campaign page with editable candidate
  details. Dashboard.
- **Phase 3 — Video upload + transcription.** Upload to storage, create `videos` row, submit to
  AssemblyAI, poll status, store segments, show per-video status in the UI.
- **Phase 4 — The magic.** New-post flow: brief box -> `/api/posts` -> Claude matching -> render
  clip cards with quote, reason, platform, caption. THIS IS THE ONE THAT MATTERS. Test it on
  real footage before going further.
- **Phase 5 — Preview + caption edit.** Video element that seeks to the moment, editable
  caption, copy button.
- **Phase 6 — Export (stretch).** ffmpeg cut, optional 9:16 crop, burned captions, download
  link. See Section 9 for the hosting caveat.
- **Phase 7 — Scale (later).** Embeddings + pgvector for campaigns with hours of footage, so you
  search instead of sending every segment to Claude.

Stop and ship a usable version after Phase 5. Phases 6 and 7 are upgrades.

---

## 9. Known technical risks (read before building)

- **ffmpeg on Vercel is constrained.** Serverless functions have execution-time and binary-size
  limits that make heavy video processing flaky. For the MVP, preview clips by seeking the
  original video to the timestamp (no processing needed). For real exports, plan to run ffmpeg
  on a small dedicated worker (Railway, Fly.io, or a Render service) that the app calls, rather
  than inside a Vercel function. Do not let export block you from shipping Phases 0 to 5.
- **Transcription cost and time.** Long videos cost more and take longer to transcribe. Show a
  clear "transcribing" state and consider capping upload length in the MVP.
- **Claude token cost grows with footage.** Sending every segment per brief is fine for a few
  videos, expensive for many. That is exactly what Phase 7 fixes.
- **Matching quality is the whole ballgame.** If Phase 4 returns wrong or weak moments, nothing
  else matters. Build a tiny test: one real transcript, three briefs, eyeball whether it finds
  the right three moments. Tune the prompt there first.
- **Copyright sits with the consultant.** They chose to download and post the footage. Put a
  line in your terms of service making that their responsibility, not yours.

---

## 10. Later: semantic search (Phase 7 detail)

When a campaign has too much footage to send Claude in full: on transcription, embed each
segment (Voyage AI or another embedding API) and store the vector in a `pgvector` column on
`transcript_segments`. At query time, embed the brief, pull the top ~40 segments by cosine
similarity, and send only those to Claude for final selection. Same prompt, smaller input.

---

## 11. Kickoff prompt for Claude Code

Paste this once you have an empty repo open in Claude Code:

> Read `BUILD_PLAN.md` in this repo. We are building the app it describes. Start with Phase 0
> only: scaffold a Next.js App Router project with TypeScript and Tailwind, set up the Supabase
> client, create a `.env.local.example` listing every environment variable the plan needs, and
> give me a home page that builds and runs. Do not start later phases yet. When Phase 0 builds
> cleanly, stop and tell me how to run it, and we'll do Phase 1 next.

Environment variables you'll need:
`ANTHROPIC_API_KEY`, `ASSEMBLYAI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Then go phase by phase. After each phase, run it, click through it, and only then move on.
