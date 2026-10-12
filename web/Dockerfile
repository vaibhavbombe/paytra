# PayTra web: Next.js standalone server for Cloud Run.
# Build context is the web/ folder.

# ── 1. Install dependencies (cached unless the lockfile changes) ──
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── 2. Build ──
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Firebase web config is PUBLIC (shipped to every browser) and Next.js inlines
# NEXT_PUBLIC_* at build time, so it comes in as build args.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID

# Placeholders only so the build can load modules; nothing connects during the
# build. Real values (secrets) are injected by Cloud Run at runtime from
# Secret Manager and are never baked into the image.
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    DIRECT_URL="postgresql://build:build@localhost:5432/build" \
    FIREBASE_PROJECT_ID="build-placeholder"

RUN npx prisma generate && npx next build

# ── Migrations (used by Cloud Build before each deploy; never deployed) ──
# Has the Prisma CLI + migrations; the runtime image deliberately has neither.
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

# ── 3. Runtime: only the standalone output, running as a non-root user ──
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080

RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public

USER app
EXPOSE 8080
CMD ["node", "server.js"]
