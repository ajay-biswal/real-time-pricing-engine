FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY backend/prisma ./backend/prisma
COPY backend/prisma.config.ts ./backend/prisma.config.ts
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm install --frozen-lockfile --filter real-time-pricing-engine-backend...

FROM deps AS build
COPY backend/tsconfig.json ./backend/tsconfig.json
COPY backend/src ./backend/src
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm --filter real-time-pricing-engine-backend build

FROM base AS production
ENV NODE_ENV=production
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY backend/prisma ./backend/prisma
COPY backend/prisma.config.ts ./backend/prisma.config.ts
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm install --frozen-lockfile --filter real-time-pricing-engine-backend...
COPY --from=build /app/backend/dist ./backend/dist
WORKDIR /app/backend
USER node
EXPOSE 5000
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
