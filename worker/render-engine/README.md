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

1. Aponte o Railway para este diretório (`worker/render-engine/`) — o `Dockerfile` é detectado automaticamente.
2. Em **Variables**, defina as três variáveis obrigatórias:
   - `RENDER_API_URL` — URL pública estável do Atende Aí, ex.: `https://project--{project-id}.lovable.app`.
   - `RENDER_WORKER_SECRET` — o **mesmo** valor salvo em Secrets do Atende Aí (nome idêntico).
   - `WORKER_ID` — identificador legível, ex.: `railway-render-1`.
3. Recursos recomendados: 1 vCPU, 2 GB RAM, 1 réplica. A fila do backend usa `FOR UPDATE SKIP LOCKED`, então múltiplas réplicas são seguras.
4. Sem porta pública, sem health check HTTP: é um long-running background worker. Restart policy: `on-failure`.
5. **Não é necessário** configurar `SUPABASE_URL` nem `SUPABASE_SERVICE_ROLE_KEY`. O worker não fala com o Supabase diretamente.

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
