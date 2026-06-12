# Campaign Clip Studio

An AI tool for political consultants: upload campaign footage, type a post idea, and get
the best matching moment with a ready caption. See `BUILD_PLAN.md` for the full plan.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in your keys
npm run dev
```

Open http://localhost:3000.

## Environment variables

See `.env.local.example`. You'll need Supabase project keys, an Anthropic API key, and an
AssemblyAI API key. None are required just to build and view the Phase 0 home page.

## Status

Phase 0 (scaffold) complete. Next up: Phase 1 — database schema, RLS, storage bucket, and
Supabase auth.
