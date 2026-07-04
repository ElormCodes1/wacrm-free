# syntax=docker/dockerfile:1

# ============================================================
# wacrm-free — production image for the Next.js app.
#
# Multi-stage: install deps → build (standalone) → tiny runtime.
# The final image runs `.next/standalone/server.js` and does NOT
# ship node_modules or source.
#
# NOTE on NEXT_PUBLIC_* build args: Next.js inlines any variable
# prefixed NEXT_PUBLIC_ at BUILD time. The Supabase URL + anon key
# must therefore be present during `npm run build`, so they are
# passed as build args (docker-compose wires these from your .env).
# ============================================================

FROM node:20-alpine AS deps
WORKDIR /app
# libc6-compat: some native deps expect glibc symbols on Alpine.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Run as a non-root user.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Standalone output: server + minimal node_modules, static assets, public/.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
