# Atende Aí — Render Engine Worker

Worker Node.js separado que consome a fila `public.video_render_jobs` e produz MP4 real com FFmpeg.
Este worker **não** roda dentro do Atende Aí (Cloudflare Workers) — FFmpeg nativo exige um container Linux.

## Fluxo por job

1. `SELECT` atômico via RPC `claim_render_job` (FOR UPDATE SKIP LOCKED).
2. Baixa imagem (`marketing-media`) e áudio (`audio-library`) via service role.
3. Renderiza MP4 em diretório temporário exclusivo.
4. Valida com FFprobe (dimensões, duração, codecs).
5. Faz upload em `video-library/{company_id}/{video_id}/video.mp4`.
6. Cria row em `public.video_library`.
7. Marca job `completed`, aponta `output_video_id`.
8. Limpa temporários em `finally`.

Em falha: sanitiza erro, limpa temporários, incrementa tentativas (máx 3), agenda retry com backoff. **Nunca** cria vídeo parcial.

## Comando FFmpeg utilizado

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

Story/Reels: `1080x1920`. Feed quadrado: `1080x1080`. Imagem estática (`-loop 1`), sem animação, sem texto, sem logo. `-shortest` corta pelo menor stream (áudio já limitado por `-t`), e `-t` no output garante duração exata.

## Deploy no Railway

1. Faça push do repositório (ou apenas do diretório `worker/render-engine/`) para um projeto Railway.
2. Railway detecta o `Dockerfile` automaticamente.
3. Em **Variables**, defina:
   - `SUPABASE_URL` — URL do projeto Supabase (mesmo do Atende Aí).
   - `SUPABASE_SERVICE_ROLE_KEY` — service role key. **Nunca** exponha no frontend.
   - `WORKER_ID` — identificador legível, ex. `railway-render-1`.
   - Opcionais: `POLL_INTERVAL_SECONDS`, `LOCK_SECONDS`, `FFMPEG_TIMEOUT_SECONDS`, `TMP_DIR`, `LOG_LEVEL`.
4. Recursos recomendados: 1 vCPU, 2 GB RAM. Um único replica é suficiente para o MVP; a fila é segura para múltiplos (SKIP LOCKED garante que dois workers nunca peguem o mesmo job).
5. Sem health check HTTP: é um worker de fundo. Railway trata como long-running process.

## Rodar localmente

```bash
cp .env.example .env  # preencher com valores reais (nunca comitar)
npm install
npm run dev            # tsx src/index.ts, hot reload
# ou:
npm run build && npm start
```

Requer FFmpeg instalado no host (`sudo apt install ffmpeg` no Debian/Ubuntu, `brew install ffmpeg` no macOS).

## Variáveis de ambiente (nenhuma tem valor default para segredos)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `SUPABASE_URL` | sim | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | Service role key (secret) |
| `WORKER_ID` | recomendado | Identificador exibido em `locked_by` |
| `POLL_INTERVAL_SECONDS` | não (5) | Intervalo quando fila vazia |
| `LOCK_SECONDS` | não (600) | TTL do lock por job |
| `FFMPEG_TIMEOUT_SECONDS` | não (300) | Timeout máximo do processo FFmpeg |
| `TMP_DIR` | não (`/tmp/render`) | Diretório temporário exclusivo |
| `LOG_LEVEL` | não (`info`) | debug \| info \| warn \| error |

## Observabilidade

Logs estruturados JSON em stdout. Eventos: `render_job_claimed`, `source_download_completed`, `ffmpeg_started`, `ffmpeg_completed`, `ffprobe_validation_completed`, `video_upload_completed`, `render_completed`, `render_failed`, `render_retry_scheduled`.

Nunca são logados: tokens, signed URLs, argumentos completos do ffmpeg, payloads binários.

## Segurança

- Nenhum caminho de storage vem do frontend. Worker resolve tudo a partir dos IDs.
- Arquivos temporários em diretório exclusivo por job, limpos em `finally`.
- Falha de upload **não** conclui o job e **não** cria row em `video_library`.
- Uma constraint UNIQUE em `render_job_id` impede vídeos duplicados por job (idempotência).

## Limitações do MVP

- Sem thumbnail (nesta fase é opcional; campo existe mas fica `null`).
- Sem animação, texto, logo, CTA, transições.
- Sem seleção por IA.
- Sem integração com publicador.
- Duração máxima 60s; máx 3 jobs ativos por empresa.
