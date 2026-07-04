# Evolution API — local backend for wacrm-free

This is the free, self-hosted WhatsApp gateway (Baileys) that wacrm-free
talks to instead of the Meta Cloud API.

## Run it

```bash
cd infra/evolution
docker compose up -d
```

- **API:** http://localhost:8088
- **Built-in manager UI:** http://localhost:8088/manager/
  (log in with the `AUTHENTICATION_API_KEY` from `.env`)

Services: `evolution-api` (port 8088 → container 8080), `evolution-redis`,
`evolution-postgres`. All bound to `127.0.0.1`.

> The API is on **8088** because host port 8080 is commonly taken by a
> local Apache/other service. If you change it, update `SERVER_URL` in
> `.env` and `EVOLUTION_API_URL` in the app's `.env.local` to match.

## Wire it to the app

In the app's `.env.local`:

```
EVOLUTION_API_URL=http://localhost:8088
EVOLUTION_API_KEY=<AUTHENTICATION_API_KEY from this .env>
EVOLUTION_WEBHOOK_URL=http://host.docker.internal:3000/api/whatsapp/webhook
# EVOLUTION_WEBHOOK_SECRET=<optional shared secret>
```

**Why `host.docker.internal`?** Evolution runs inside Docker and must
POST inbound events back to the Next dev server on the host. From inside
the container, `localhost` is the container itself — `host.docker.internal`
resolves to the host machine (Docker Desktop). On plain Linux, use the
host's LAN IP or add `--add-host=host.docker.internal:host-gateway`.

## How the app uses it

- **Connect:** the app creates one Evolution *instance* per account
  (`wacrm-<accountId>`) and registers this webhook. Scanning the QR in
  Settings links the number.
- **Send:** `POST /message/sendText|sendMedia|sendReaction/{instance}`.
- **Receive:** Evolution POSTs `messages.upsert` / `messages.update`
  (acks) / `connection.update` to `EVOLUTION_WEBHOOK_URL`.

## Security notes

- The manager UI and API are protected only by `AUTHENTICATION_API_KEY`.
  Keep the ports bound to localhost (as configured) or put the server
  behind auth + TLS before exposing it.
- Set a strong, unique `AUTHENTICATION_API_KEY` and (recommended)
  `EVOLUTION_WEBHOOK_SECRET` for any non-local deployment.

## Reset

```bash
docker compose down -v   # stops + wipes volumes (instances, DB, redis)
```

This unlinks all sessions — you'll re-scan the QR to reconnect.
