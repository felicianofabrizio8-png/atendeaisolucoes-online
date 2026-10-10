# Multi-stage: build TS, run com Node + FFmpeg
# CACHE_BUST — muda a cada rebuild para invalidar TODA a cadeia de layers.
# Passe no Railway (build args) ou deixe o valor abaixo forçar cache miss.
ARG CACHE_BUST=render-pro-templates-build-007-20261010

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
# Fontes OFL empacotadas para o compositor de cenas. Nunca baixadas em
# runtime; a lista vem do registro de cenas (src/scenes.ts → FONTS).
COPY assets ./assets

# ---------------------------------------------------------------------------
# VERIFICAÇÃO DE IMAGEM (falha o build se algo estiver faltando).
# Prova, no próprio log de build do Railway, que a imagem final:
#   - contém o dist esperado e as assinaturas de código do motor de cenas;
#   - carrega a assinatura de build declarada em src/build-info.ts (lida do
#     próprio dist — não há mais string de versão duplicada aqui);
#   - passa no selfcheck: binário do rasterizador, TODAS as fontes do registro
#     e cada cena rasterizando em PNG.
# ---------------------------------------------------------------------------
RUN set -eux; \
    echo "=== IMAGE VERIFICATION (cache-bust=$CACHE_BUST) ==="; \
    ls -la /app/dist/build-info.js /app/dist/render.js /app/dist/scenes.js /app/dist/scene-composer.js /app/dist/brand-composer.js /app/dist/font-metrics.js /app/dist/selfcheck.js; \
    SIG=$(node -e "import('/app/dist/build-info.js').then((m) => process.stdout.write(m.BUILD_SIGNATURE))"); \
    test -n "$SIG" || { echo "MISSING BUILD SIGNATURE"; exit 1; }; \
    echo "build_signature=$SIG"; \
    for s in "$SIG" render_build_signature scene_engine_enabled brand_watermark_decision scene_logo_confirmed available_scene_ids brand_composition_gate composeBrandLayers buildSceneOverlaySvg scene_render_selected claim_snapshot_inspect getSceneById scene_applies_logo; do \
      count=$(grep -rc "$s" /app/dist/ | awk -F: '{s+=$2} END {print s+0}'); \
      echo "signature[$s]=$count"; \
      test "$count" -ge 1 || { echo "MISSING SIGNATURE: $s"; exit 1; }; \
    done; \
    ffmpeg_count=$(grep -c "buildBrandOverlayChain" /app/dist/ffmpeg.js || true); \
    echo "signature[buildBrandOverlayChain]=$ffmpeg_count"; \
    test "$ffmpeg_count" -ge 1 || { echo "MISSING SIGNATURE: buildBrandOverlayChain (ffmpeg.js)"; exit 1; }; \
    node /app/dist/selfcheck.js; \
    ffmpeg -hide_banner -h filter=xfade >/dev/null; \
    echo "=== IMAGE VERIFICATION OK ==="


# Não roda como root
RUN useradd -m -u 10001 worker && mkdir -p /tmp/render && chown -R worker:worker /tmp/render
USER worker

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]

