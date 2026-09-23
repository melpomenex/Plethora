FROM node:22-alpine AS builder

WORKDIR /app

COPY server/package*.json ./
RUN npm ci

COPY server/. .
RUN rm src/algorithms/fsrs7
COPY src/algorithms/fsrs7 ./src/algorithms/fsrs7
RUN npm run build

# Production image
FROM node:22-alpine

LABEL org.opencontainers.image.title="plethora-cloud"
LABEL org.opencontainers.image.description="Plethora Cloud API server"
LABEL org.opencontainers.image.source="https://github.com/melpomenex/Plethora"

WORKDIR /app

ENV NODE_ENV=production

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
