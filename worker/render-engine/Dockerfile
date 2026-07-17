# Multi-stage: build TS, run com Node + FFmpeg
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:20-slim AS runtime
# FFmpeg + ca-certificates + tini (init leve)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=builder /app/dist ./dist

# Não roda como root
RUN useradd -m -u 10001 worker && mkdir -p /tmp/render && chown -R worker:worker /tmp/render
USER worker

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
