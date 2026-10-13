
FROM node:22-alpine AS base

RUN corepack enable

WORKDIR /app

# Install dependencies
FROM base AS deps

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

# Build TypeScript
FROM deps AS build

COPY tsconfig.json ./
COPY src ./src

RUN pnpm build

# Production image
FROM base AS production

ENV NODE_ENV=production

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/dist ./dist

USER node

EXPOSE 5000

CMD ["node", "dist/main.js"]
