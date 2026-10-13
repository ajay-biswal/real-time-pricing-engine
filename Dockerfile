FROM node:22-alpine AS base

RUN corepack enable
WORKDIR /app

# Install dependencies and generate Prisma Client.
# This URL is a build-only placeholder; runtime configuration comes from Compose.
FROM base AS deps

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm install --frozen-lockfile

# Build the application
FROM deps AS build

COPY tsconfig.json ./
COPY src ./src

RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm build

# Runtime image
FROM base AS production

ENV NODE_ENV=production
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm install --frozen-lockfile

COPY --from=build /app/dist ./dist

USER node
EXPOSE 5000

CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
