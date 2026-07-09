# wacrm-free — a WhatsApp CRM on a free, self-hosted backend

> An open-source, self-hostable CRM for WhatsApp — shared inbox,
> contacts, sales pipelines, broadcasts, and no-code automations. Runs
> entirely on a **free, self-hosted [Evolution API](https://github.com/EvolutionAPI/evolution-api)**
> (Baileys) backend: **no Meta WhatsApp Business API, no per-message
> fees, no template approvals.** Link a number by scanning a QR code.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)
[![Evolution API](https://img.shields.io/badge/WhatsApp-Evolution%20API-25D366?logo=whatsapp)](https://github.com/EvolutionAPI/evolution-api)

> [!WARNING]
> **Unofficial-client risk.** This connects through the WhatsApp Web
> protocol (Baileys), the same way WhatsApp Web / linked devices work.
> It is **not** sanctioned by WhatsApp/Meta and has **no SLA**. WhatsApp
> may flag or ban numbers that send at scale or trip spam heuristics.
> **Use a dedicated business number you can afford to lose — never your
> personal number — and warm it up gradually.** You accept this risk.

wacrm-free started as a fork of [wacrm](https://github.com/ArnasDon/wacrm)
with the official Meta Cloud API swapped out for a self-hosted Evolution
API backend, then grew multi-number, group chats, and a lot more. It's a
concrete, working product you can stand up in an afternoon and make
yours.

---

## Features

**WhatsApp, self-hosted**
- **Shared inbox** on a self-hosted WhatsApp connection — multiple agents
  on one number, per-conversation assignment, status, and notes. Link by
  scanning a QR code; no Meta Business account.
- **Multiple numbers per account** — link several WhatsApp numbers, each
  its own connection. Inbound is tagged with the line it arrived on and
  replies go back out from that same number; a badge shows which line
  each chat is on.
- **Group chats** — group conversations land in the inbox with each
  message attributed to the member who sent it.
- **Rich messaging** — text, images, video, documents, audio/voice
  notes, locations, contacts, polls; reactions, reply/quote, **edit** and
  **unsend**, typing + read receipts, forward a message to another chat.
- **Pre-send number check** — validates a new number is on WhatsApp
  before the first message; an "on WhatsApp" badge on contacts.
- **Call logging** — incoming calls are logged to the timeline (with an
  optional auto-reject setting).
- **Labels ↔ tags** — pull your WhatsApp Business labels in as CRM tags;
  labelling a chat on the phone syncs into the CRM.
- **Archive, block, WhatsApp Status/Stories, business-profile enrichment,
  and history import** on connect.

**CRM**
- **Contacts** + tags + custom fields, CSV import, deduplication.
- **Sales pipelines** (Kanban) with deals linked to conversations.
- **Broadcasts** with reusable local message templates (no Meta
  approval), delivery + read tracking, per-recipient `{{1}}` variables.
- **No-code automations** — triggers on inbound messages, new contacts,
  keywords, or a schedule; conditional branches, waits, tags, webhooks.
  Visual builder.
- **AI reply assistant** — bring your own OpenAI or Anthropic key (stored
  encrypted). One-click AI-drafted replies, an optional capped auto-reply
  bot with clean human handoff, and a knowledge base that answers from
  your own FAQs/docs (Postgres full-text, or semantic pgvector with an
  embeddings key).
- **Real-time dashboard**, **team accounts** (owner / admin / agent /
  viewer, invite by link), and a **public REST API** (`/api/v1`) with
  scoped, revocable keys — see [docs/public-api.md](./docs/public-api.md).

---

## Quick start (Docker — whole stack)

The fastest path. Brings up the app **and** the WhatsApp gateway
(Evolution API + its Postgres + Redis) together. You need
[Docker](https://docs.docker.com/get-docker/) and a free
[Supabase](https://supabase.com) project.

```bash
git clone https://github.com/<you>/wacrm-free.git
cd wacrm-free

cp .env.local.example .env
#  → fill in:  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#              SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, EVOLUTION_API_KEY
#  (the Evolution URLs are set automatically by docker-compose)

docker compose up -d --build
```

This builds the app and **pulls the WhatsApp gateway as a prebuilt image**
(`ghcr.io/elormcodes1/evolution-api` — our patched Evolution API fork), so
you don't need to clone or build the gateway yourself.

- App → <http://localhost:3000>
- WhatsApp gateway → <http://localhost:8088> (bound to localhost)

Then **[apply the database schema](#database-schema)** and
**[connect a number](#connect-a-whatsapp-number)** below.

> **Want to modify the gateway?** Clone the fork as a sibling and build it
> locally instead of pulling:
> ```bash
> git clone https://github.com/ElormCodes1/evolution-api.git ../evolution-api
> docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
> ```

> `ENCRYPTION_KEY` must be 64 hex chars (32 bytes). Generate one:
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## Quick start (local dev — `npm run dev`)

Run the Next.js app on the host and only the WhatsApp gateway in Docker —
best for hacking on the app.

```bash
# 1. WhatsApp gateway (Evolution API) in Docker
cd infra/evolution
cp .env.example .env                             # then edit AUTHENTICATION_API_KEY
docker compose up -d                             # API on http://localhost:8088
cd ../..

# 2. App
npm install
cp .env.local.example .env.local
#  → set the Supabase keys, ENCRYPTION_KEY, EVOLUTION_API_KEY, and keep
#    EVOLUTION_WEBHOOK_URL=http://host.docker.internal:3000/api/whatsapp/webhook
npm run dev                                      # app on http://localhost:3000
```

> The `EVOLUTION_WEBHOOK_URL` must be reachable **from inside the
> Evolution container**. In this mode that's `host.docker.internal`, not
> `localhost`. (In the whole-stack Docker setup, compose handles this for
> you.)

---

## Database schema

wacrm-free uses [Supabase](https://supabase.com) (hosted Postgres + Auth
+ Storage). Create a free project, then:

1. Copy your project's **URL**, **anon key**, and **service-role key**
   (Project Settings → API) into your `.env` / `.env.local`.
2. Apply every file in [`supabase/migrations/`](./supabase/migrations/)
   **in filename order** — via the Supabase **SQL Editor** (paste each
   file) or `psql` against the connection string (Project Settings →
   Database → Connection string; use the **Session pooler** string).

That's it — the app creates its own tables, RLS policies, and storage
buckets from those migrations.

---

## Connect a WhatsApp number

1. Open the app and sign up (first user).
2. Go to **Settings → WhatsApp** → **Add number**, name it, and scan the
   QR code with the phone whose WhatsApp you want to link
   (**WhatsApp → Linked Devices → Link a Device**).
3. Repeat **Add number** for as many lines as you want.

Messages now flow into the inbox in real time.

---

## Architecture

```
┌─────────────┐   REST (apikey)    ┌──────────────────┐   Baileys    ┌──────────┐
│  wacrm-free │ ─────────────────▶ │  Evolution API   │ ───────────▶ │ WhatsApp │
│  (Next.js)  │ ◀───────────────── │  (self-hosted)   │ ◀─────────── │  Web     │
└─────┬───────┘   webhook (POST)   └──────────────────┘              └──────────┘
      │
      ▼
┌─────────────┐
│  Supabase   │  Postgres + Auth + Storage + Realtime + RLS
└─────────────┘
```

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Data** — Supabase (Postgres + Auth + Storage + RLS + Realtime).
- **WhatsApp** — self-hosted [Evolution API](https://github.com/EvolutionAPI/evolution-api)
  (Baileys / WhatsApp Web protocol). The single client lives in
  [`src/lib/whatsapp/provider/evolution.ts`](./src/lib/whatsapp/provider/evolution.ts);
  inbound events are parsed in
  [`src/app/api/whatsapp/webhook/route.ts`](./src/app/api/whatsapp/webhook/route.ts).

Security primitives: token encryption (AES-256-GCM), RLS on every table,
CSP + security headers, rate limiting, and typecheck/test/build in CI.

---

## Deployment

wacrm-free runs anywhere Node.js or Docker does.

- **Docker / VPS** — `docker compose up -d --build` on any box; put the
  app behind a reverse proxy with TLS. Host Evolution API somewhere with
  a stable URL and set `EVOLUTION_API_URL` / `EVOLUTION_WEBHOOK_URL`
  accordingly, and set a strong `EVOLUTION_API_KEY` (+ optional
  `EVOLUTION_WEBHOOK_SECRET`).
- **Managed Node.js hosts** (Vercel, Railway, Render, Hostinger, …) — the
  app is a standard Next.js build (`npm run build` / `npm start`); set the
  env vars in the host's dashboard and host Evolution separately.

See [`.env.local.example`](./.env.local.example) for every variable and
[`docs/`](./docs) for feature-specific setup.

> **Maintainers — publishing the gateway image.** The Evolution API fork
> ([ElormCodes1/evolution-api](https://github.com/ElormCodes1/evolution-api))
> ships a GitHub Actions workflow that builds and pushes
> `ghcr.io/elormcodes1/evolution-api:latest` on every push to `main`. After
> the first run, set the GHCR package to **public** (repo → Packages →
> the package → Package settings → Change visibility) so `docker compose`
> can pull it without a login. That's the only manual step.

---

## Contributing

Contributions are welcome — bug fixes, features, docs, tests. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev setup, branch/PR flow,
and code standards, and [`.github/SECURITY.md`](./.github/SECURITY.md)
for reporting security issues privately.

Quick loop:

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run lint        # eslint
```

## License

[MIT](./LICENSE). Fork it, brand it, host it.
