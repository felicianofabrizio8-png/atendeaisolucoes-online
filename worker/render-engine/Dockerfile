# Multi-stage: build TS, run com Node + FFmpeg
# CACHE_BUST — muda a cada rebuild para invalidar TODA a cadeia de layers.
# Passe no Railway (build args) ou deixe o valor abaixo forçar cache miss.
ARG CACHE_BUST=render-scene-svg-escape-build-003-20260721

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
    ls -la /app/dist/render.js /app/dist/scenes.js /app/dist/scene-composer.js /app/dist/brand-composer.js; \
    ls -la /app/assets/fonts/Inter-Regular.ttf /app/assets/fonts/PlayfairDisplay-Bold.ttf; \
    for s in render_build_signature render-scene-logo-parity-build-002 scene_engine_enabled available_scene_ids brand_composition_gate composeBrandLayers buildSceneOverlaySvg scene_render_selected claim_snapshot_inspect getSceneById scene_applies_logo; do \
      count=$(grep -rc "$s" /app/dist/ | awk -F: '{s+=$2} END {print s+0}'); \
      echo "signature[$s]=$count"; \
      test "$count" -ge 1 || { echo "MISSING SIGNATURE: $s"; exit 1; }; \
    done; \
    ffmpeg_count=$(grep -c "buildBrandOverlayChain" /app/dist/ffmpeg.js || true); \
    echo "signature[buildBrandOverlayChain]=$ffmpeg_count"; \
    test "$ffmpeg_count" -ge 1 || { echo "MISSING SIGNATURE: buildBrandOverlayChain (ffmpeg.js)"; exit 1; }; \
    echo "=== IMAGE VERIFICATION OK ==="


# Não roda como root
RUN useradd -m -u 10001 worker && mkdir -p /tmp/render && chown -R worker:worker /tmp/render
USER worker

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]

