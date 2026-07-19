# Multi-stage: build TS, run com Node + FFmpeg
# CACHE_BUST — muda a cada rebuild para invalidar TODA a cadeia de layers.
# Passe no Railway (build args) ou deixe o valor abaixo forçar cache miss.
ARG CACHE_BUST=render-phase-5b1-build-002-20260719

FROM node:20-slim AS builder
ARG CACHE_BUST
WORKDIR /app
RUN echo "cache-bust=$CACHE_BUST" > /tmp/.cache-bust
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:20-slim AS runtime
ARG CACHE_BUST
RUN echo "runtime-cache-bust=$CACHE_BUST" > /tmp/.cache-bust
# FFmpeg + ca-certificates + tini (init leve)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=builder /app/dist ./dist
# Fase 5.B1 — Fontes OFL empacotadas (Inter + Playfair Display) para o Brand Composer.
# Nunca baixadas em runtime; caminho estável usado por brand-composer.ts.
COPY assets ./assets

# ---------------------------------------------------------------------------
# VERIFICAÇÃO DE IMAGEM (falha o build se algo estiver faltando).
# Prova, no próprio log de build do Railway, que a imagem final contém:
#   - dist/render.js com as assinaturas da Fase 5.B1
#   - assets/fonts/Inter-Regular.ttf e PlayfairDisplay-Bold.ttf
# ---------------------------------------------------------------------------
RUN set -eux; \
    echo "=== IMAGE VERIFICATION (cache-bust=$CACHE_BUST) ==="; \
    ls -la /app/dist/render.js; \
    ls -la /app/assets/fonts/Inter-Regular.ttf /app/assets/fonts/PlayfairDisplay-Bold.ttf; \
    for s in RENDER_BUILD_SIGNATURE brand_composition_gate brand_composition_started brand_layers_count; do \
      count=$(grep -c "$s" /app/dist/render.js || true); \
      echo "signature[$s]=$count"; \
      test "$count" -ge 1 || { echo "MISSING SIGNATURE: $s"; exit 1; }; \
    done; \
    echo "=== IMAGE VERIFICATION OK ==="

# Não roda como root
RUN useradd -m -u 10001 worker && mkdir -p /tmp/render && chown -R worker:worker /tmp/render
USER worker

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]

