# Atende Aí — Render Engine Worker

Worker Node.js separado que consome jobs de renderização pela **API pública protegida do Atende Aí** (`/api/public/render/*`) e produz MP4 real com FFmpeg. Este worker **não acessa o banco nem o Storage diretamente** e **não conhece a service role**.

## Arquitetura

```
Railway (worker)
   │  POST /api/public/render/claim      (x-render-worker-secret)
   ▼
Atende Aí (Lovable Cloud)
   │  RPC claim_render_job → Signed URLs (imagem, áudio, upload MP4)
   ▼
Worker: FFmpeg → FFprobe → PUT MP4 → POST /complete
```

## Fluxo por job

1. `POST /api/public/render/claim` → recebe job + Signed URLs.
2. Baixa imagem e áudio pelas Signed URLs.
3. Renderiza MP4 com FFmpeg (H.264/AAC/yuv420p, dimensões e duração fixas).
4. Valida com FFprobe.
5. Faz `PUT` do MP4 pela Signed Upload URL (`video-library/{company_id}/{video_id}/video.mp4`).
6. `POST /api/public/render/complete` — o Atende Aí cria a row em `video_library` e conclui o job.
7. Em falha: `POST /api/public/render/fail` — o Atende Aí decide retry com backoff (máx 3 tentativas) ou falha permanente.

Em qualquer erro: limpa temporários. Nenhum vídeo parcial é criado.

## Comando FFmpeg (inalterado)

```
ffmpeg -y \
  -loop 1 -framerate 30 -i <image> \
  -ss <startSec> -t <durationSec> -i <audio> \
  -vf "scale=<W>:<H>:force_original_aspect_ratio=increase,crop=<W>:<H>,format=yuv420p" \
  -c:v libx264 -profile:v high -preset medium -crf 20 -r 30 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -ar 48000 -ac 2 \
  -shortest -movflags +faststart \
  -t <durationSec> \
  <output>
```

## Deploy no Railway

> ⚠️ **Root Directory obrigatório.** Este worker vive num subdiretório do
> monorepo. O serviço Railway PRECISA estar configurado com:
>
> - **Root Directory:** `worker/render-engine`
> - **Dockerfile Path:** `Dockerfile` (relativo ao root directory acima)
> - **Config File:** `railway.json` (relativo ao root directory) — já
>   comitado em `worker/render-engine/railway.json`.
>
> Sem esse ajuste, o `railway up` envia o repositório inteiro e o build
> ignora este `Dockerfile`, deixando uma imagem legada em produção.

### Comando de deploy (a partir da raiz do repositório)

```bash
cd worker/render-engine
railway status              # confirma serviço vinculado (ex.: feisty-bravery-v2)
railway up --detach         # sobe SOMENTE este diretório
```

### Validação pós-deploy (logs obrigatórios)

Nos logs do serviço Railway procure, na ordem:

1. `render_build_signature` — deve aparecer UMA vez no boot, com
   `build_signature="brand-phase-5b1-v1"` e `brand_composition_enabled=true`.
2. `brand-phase-5b1-v1` — string presente no log acima e em cada
   `brand_composition_gate`.
3. `brand_composition_gate` — dispara a cada job, com `approved` e
   `reason` (ex.: `approved="true"` / `reason="approved"`).

Se qualquer um desses três eventos não aparecer, o container em execução
NÃO é a Fase 5.B1 — revisar Root Directory / cache de build.

### Variáveis obrigatórias (Railway → Variables)

- `RENDER_API_URL` — URL pública estável do Atende Aí, ex.: `https://project--{project-id}.lovable.app`.
- `RENDER_WORKER_SECRET` — o **mesmo** valor salvo em Secrets do Atende Aí.
- `WORKER_ID` — identificador legível, ex.: `feisty-bravery-v2`.

Recursos recomendados: 1 vCPU, 2 GB RAM, 1 réplica. Sem porta pública,
sem health check HTTP.


## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `RENDER_API_URL` | **sim** | URL pública do Atende Aí (deployed) |
| `RENDER_WORKER_SECRET` | **sim** | Secret compartilhado (>= 32 chars) |
| `WORKER_ID` | recomendado | Identificador exibido em `locked_by` |
| `POLL_INTERVAL_SECONDS` | não (5) | Intervalo quando fila vazia |
| `FFMPEG_TIMEOUT_SECONDS` | não (300) | Timeout máximo do FFmpeg |
| `HTTP_TIMEOUT_SECONDS` | não (30) | Timeout das chamadas HTTP |
| `TMP_DIR` | não (`/tmp/render`) | Diretório temporário exclusivo |
| `LOG_LEVEL` | não (`info`) | debug \| info \| warn \| error |

## Rodar localmente

```bash
cp .env.example .env  # preencher com valores reais (nunca comitar)
npm install
npm run dev            # tsx src/index.ts
# ou build:
npm run build && npm start
```

Requer FFmpeg no host (`sudo apt install ffmpeg` / `brew install ffmpeg`).

## Observabilidade

Logs JSON estruturados em stdout/stderr. Eventos: `worker_started`, `bridge_claim_requested`, `bridge_claim_received`, `signed_source_download_started`, `signed_source_download_completed`, `ffprobe_validation_completed`, `signed_video_upload_started`, `signed_video_upload_completed`, `bridge_complete_confirmed`, `bridge_fail_confirmed`, `render_failed`.

**Nunca logados:** `RENDER_WORKER_SECRET`, Signed URLs, headers completos, argumentos do ffmpeg, payloads binários, service role, tokens.

## Segurança

- Railway não recebe service role, URL do Supabase nem chaves anônimas.
- Todos os paths são derivados no servidor a partir de IDs de tenant validados.
- Signed URLs têm TTL curto (10 min). Se expirarem durante o job, o worker chama `/fail` e a fila reagenda; o próximo claim gera novas URLs.
- `complete` valida contrato (dimensões, duração, codecs), checa presença real do arquivo no Storage e insere `video_library` idempotentemente (UNIQUE `render_job_id`).
- Autenticação: header `x-render-worker-secret` com comparação timing-safe no servidor.

## Limitações do MVP

- Sem thumbnail nesta fase (`thumbnail_path` fica `null`).
- Sem animação, texto, logo, CTA, transições.
- Sem seleção por IA nem integração com o publicador.
- Duração ≤ 60s; máx 3 jobs ativos por empresa.
