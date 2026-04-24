FROM node:24-bookworm-slim AS builder

WORKDIR /app
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY lib ./lib
COPY artifacts/api-server ./artifacts/api-server
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile --filter "@workspace/api-server..."
RUN pnpm --filter @workspace/api-server run build

FROM node:24-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV WA_AUTH_DIR=/data/wa_auth

# Persistent dir for WhatsApp session (mount a Railway Volume here)
RUN mkdir -p /data/wa_auth

COPY --from=builder /app/artifacts/api-server/dist ./dist

EXPOSE 8080
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
