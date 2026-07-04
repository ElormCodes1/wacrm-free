# Contributing to wacrm-free

Thanks for your interest — contributions are welcome: bug fixes, new
features, docs, and tests all help. This guide covers how to get set up
and how to land a change.

By contributing you agree that your contribution is licensed under the
project's [MIT License](./LICENSE).

---

## Ways to contribute

- **Report a bug** — open a [GitHub issue](../../issues/new) with steps to
  reproduce, what you expected, what happened, and any logs. Include how
  you're running it (whole-stack Docker / local dev / your own deploy).
- **Request a feature** — open an issue describing the use case. For
  anything non-trivial, it's worth agreeing on the approach in the issue
  before you write code.
- **Send a pull request** — see below. Small, focused PRs review fastest.
- **Report a security issue** — **do not** open a public issue. Follow
  the private process in [`.github/SECURITY.md`](./.github/SECURITY.md).

---

## Development setup

See the [README quick starts](./README.md#quick-start-local-dev--npm-run-dev).
The short version for hacking on the app:

```bash
# Clone your fork
git clone https://github.com/<your-username>/wacrm-free.git
cd wacrm-free

# WhatsApp gateway (Evolution API) in Docker
cd infra/evolution && docker compose up -d
cd ../..

# App
npm install
cp .env.local.example .env.local     # fill in Supabase + secrets
npm run dev
```

You'll need a free [Supabase](https://supabase.com) project and its keys,
plus the database schema applied (see
[README → Database schema](./README.md#database-schema)).

---

## Dev loop

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3000. |
| `npm run build` | Production build (also runs Next's typecheck). |
| `npm run typecheck` | `tsc --noEmit` — fast TypeScript-only pass. |
| `npm test` | Vitest (`vitest run`). |
| `npm run lint` | ESLint. |
| `npm run format` | Prettier write. |
| `npm run format:check` | Prettier check-only (used in CI). |

**Before opening a PR, these must pass:**

```bash
npm run typecheck   # 0 errors
npm test            # all green
npm run lint        # clean
```

---

## Pull request checklist

1. **Branch off the latest `main`** — one logical change per PR.
2. **Keep it focused.** Unrelated refactors in the same PR slow review;
   split them out.
3. **Add/adjust tests** for behaviour changes where practical, and make
   sure `npm test` and `npm run typecheck` are green.
4. **Update docs** (`README.md`, `docs/`, `.env.local.example`) when you
   change setup, env vars, or user-facing behaviour.
5. **Write a clear description** — what changed and *why*, plus a short
   test plan (how you verified it).
6. Commit messages: imperative, terse first line ("Add group send
   routing"); the body explains the *why*, the diff shows the *what*.

Expect a review within a few days. Opening an issue first for anything
beyond a small fix helps align on approach before you invest time.

---

## Database migrations

The schema lives in [`supabase/migrations/`](./supabase/migrations/) as
numbered SQL files applied in order. If your change needs a schema
change:

- Add a **new** file `NNN_short_description.sql` (next number in
  sequence) — never edit an already-released migration.
- Make it **idempotent** where reasonable (`IF NOT EXISTS`,
  `IF EXISTS`) so re-runs are safe.
- Keep RLS in mind — every table is row-level-security protected and
  scoped by `account_id`. New tables need matching policies.
- After adding columns on a live Supabase project, PostgREST caches the
  schema — run `NOTIFY pgrst, 'reload schema';` (or wait) so the API
  sees them.

---

## Architecture notes

- **WhatsApp** goes through the self-hosted Evolution API. The single
  client is [`src/lib/whatsapp/provider/evolution.ts`](./src/lib/whatsapp/provider/evolution.ts);
  inbound events are parsed in
  [`src/app/api/whatsapp/webhook/route.ts`](./src/app/api/whatsapp/webhook/route.ts).
  Prefer extending the provider over scattering `fetch` calls.
- **Multi-number**: an account can link several numbers. Sends resolve
  the target number via `src/lib/whatsapp/resolve-send-target.ts`
  (conversation-tied → the conversation's number; account-level → the
  default). Don't reintroduce a single-`.maybeSingle()`-config
  assumption.
- **Groups** are modelled as contacts with `is_group = true`.
- Server routes that write with the service-role key bypass RLS — scope
  every query by `account_id` yourself.

---

## Code style

- TypeScript, matched to the surrounding file's conventions.
- Prettier + ESLint are the source of truth for formatting/lint — run
  them rather than hand-formatting.
- Match the comment density and naming of nearby code; explain *why*, not
  *what*.

## License

MIT ([`LICENSE`](./LICENSE)). Contributions are accepted under the same
license.
