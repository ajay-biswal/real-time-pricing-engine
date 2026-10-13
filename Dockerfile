FROM node:22-alpine AS base

RUN corepack enable

WORKDIR /app

# Install dependencies with the Prisma schema present for the postinstall hook.
FROM base AS deps

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

RUN pnpm install --frozen-lockfile

# Build TypeScript.
FROM deps AS build

COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma

RUN pnpm build

# Runtime image. Keep Prisma CLI available so a fresh database can be initialized.
FROM base AS production

ENV NODE_ENV=production

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

COPY --from=build /app/dist ./dist

USER node

EXPOSE 5000

CMD ["sh", "-c", "pnpm exec prisma db push && node dist/main.js"]
