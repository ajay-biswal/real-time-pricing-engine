FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app/backend

FROM base AS deps
COPY backend/package.json backend/pnpm-lock.yaml ./
COPY backend/prisma ./prisma
COPY backend/prisma.config.ts ./
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm install --frozen-lockfile

FROM deps AS build
COPY backend/tsconfig.json ./tsconfig.json
COPY backend/src ./src
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm build

FROM base AS production
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package.json backend/pnpm-lock.yaml ./
COPY backend/prisma ./prisma
COPY backend/prisma.config.ts ./
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm install --frozen-lockfile
COPY --from=build /app/backend/dist ./dist
USER node
EXPOSE 5000
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
