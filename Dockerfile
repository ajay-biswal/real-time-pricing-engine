FROM node:22-alpine AS base

RUN corepack enable

WORKDIR /app

# Prisma config reads DATABASE_URL during client generation. This placeholder
# is only for image-build time; Compose supplies the runtime database URL.
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pricing_engine"

FROM base AS deps

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN pnpm build

FROM base AS production

ENV NODE_ENV=production

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN pnpm install --frozen-lockfile

COPY --from=build /app/dist ./dist

USER node

EXPOSE 5000

CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
