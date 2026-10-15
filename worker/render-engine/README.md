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

O serviço (`stellar-mindfulness` → `feisty-bravery`) **não tem repositório
conectado**: ele só recebe código por `railway up`, enviado a partir DESTA
pasta. Por isso:

- O envio precisa ter `Dockerfile` e `railway.json` na **raiz do pacote**.
  No serviço, **Root Directory deve ficar vazio** e o config file é
  `/railway.json`. (Se Root Directory for preenchido com
  `worker/render-engine` e o envio for só esta pasta, o Railway não acha o
  Dockerfile e a criação da imagem falha em segundos, sem log de build.)
- **Não use "Redeploy"** em um deploy antigo no painel: o pacote enviado por
  CLI expira e o redeploy falha na criação da imagem em segundos, sem log.
  Sempre faça um envio novo com `railway up`.
- Enviar a partir da raiz do repositório também falha rápido: lá não existe
  `Dockerfile`.

### Procedimento seguro (deploy pausado → revisar fila → liberar)

O worker começa a pegar jobs assim que sobe. Para não processar de surpresa
os jobs antigos que ficaram em `queued`, suba PAUSADO primeiro.

1. **Antes de enviar (local, nesta pasta):**

   ```bash
   npm ci && npm run typecheck && npm test
   npm run selfcheck        # fontes + rasterização de todas as cenas
   ```

2. **Pausar e conferir variáveis** (Railway → Variables do serviço):
   `WORKER_PAUSED=true`, `RENDER_API_URL=https://app.atendeaisolucoes.online`
   (domínio final, sem redirecionamento), `RENDER_WORKER_SECRET` igual ao do
   app, `WORKER_ID`.

   A pausa só vale se a variável JÁ existir quando o container subir: com
   `WORKER_PAUSED` ausente ou `false` o worker pede job no primeiro segundo.
   Confirme antes de enviar (não imprime o segredo):

   ```bash
   railway variables --kv | grep -E "^(WORKER_PAUSED|RENDER_API_URL|WORKER_ID)="
   # esperado: WORKER_PAUSED=true
   ```

   Valor digitado errado (ex.: `ture`) mantém o worker pausado e registra
   `worker_paused_value_unrecognized`. A variável é relida a cada
   inicialização, então a pausa continua valendo após reinícios e quedas.

3. **Enviar esta pasta:**

   ```bash
   cd worker/render-engine
   railway link                       # projeto stellar-mindfulness, serviço feisty-bravery
   railway status                     # confirma projeto/serviço/ambiente
   railway up . --path-as-root --detach
   railway logs --build               # deve terminar em "=== IMAGE VERIFICATION OK ==="
   ```

4. **Validar o boot (ainda pausado):** em `railway logs` devem aparecer
   `RENDER_BUILD_SIGNATURE` com a assinatura de `src/build-info.ts`,
   `worker_started` com `paused: true` e `worker_paused` a cada minuto.
   Nenhum `render_job_claimed` pode aparecer.

5. **Revisar a fila** (Supabase → SQL Editor, somente leitura):

   ```sql
   -- O que será processado assim que o worker for liberado (ordem real da fila).
   select j.id, j.company_id, j.status, j.attempt_count, j.created_at, j.available_at,
          j.error_code, j.video_format, j.duration_seconds,
          (select count(*) from marketing_contents c
            where c.feed_render_job_id = j.id or c.story_render_job_id = j.id) as conteudos_vinculados
     from video_render_jobs j
    where j.status = 'queued'
    order by j.created_at asc;

   -- Jobs que ficaram "processando" quando o worker caiu (ninguém vai retomá-los).
   select id, company_id, locked_by, locked_at, updated_at, attempt_count
     from video_render_jobs
    where status = 'processing'
    order by locked_at asc;
   ```

   Decida com o responsável quais jobs antigos NÃO devem virar vídeo
   (testes, conteúdos ocultados, campanhas abandonadas). Cancelar é uma
   alteração de produção — rode conscientemente, com a lista de ids revisada:

   ```sql
   -- Cancela só os ids escolhidos e só se ainda estiverem na fila.
   update video_render_jobs
      set status = 'cancelled', failed_at = now(), error_code = 'cancelled_before_worker_restart'
    where status = 'queued' and id in ('<id1>', '<id2>');
   ```

   Jobs presos em `processing` podem ser liberados pelo próprio app
   ("Tentar novamente" no card) ou marcados como falhos da mesma forma.

6. **Liberar:** mude `WORKER_PAUSED` para `false` (o Railway reinicia o
   serviço). Acompanhe `render_job_claimed` → `bridge_complete_confirmed` do
   primeiro job e confira o vídeo no app antes de considerar concluído.

7. **Reverter:** `WORKER_PAUSED=true` interrompe novos jobs imediatamente
   (o job em andamento termina ou é marcado como parado pelo app).

### Validação pós-deploy (logs)

1. `RENDER_BUILD_SIGNATURE` — uma vez no boot, com a assinatura de
   `src/build-info.ts` (o campo `build_signature` dos logs estruturados sai
   mascarado; use esta linha).
2. `render_build_signature` — `scene_engine_enabled=true` e
   `available_scene_ids` com os modelos atuais.
3. `brand_composition_gate` e `scene_render_selected` com
   `render_mode="scene"` a cada job.

### Variáveis obrigatórias (Railway → Variables)

- `RENDER_API_URL` — domínio FINAL do Atende Aí (sem redirecionamento), hoje `https://app.atendeaisolucoes.online`.
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
| `WORKER_PAUSED` | não (`false`) | `true` = sobe sem pegar jobs (validar deploy / revisar fila) |

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

## Diagnóstico: vídeos presos em "Na fila"

A fila só anda enquanto existe um deploy **ativo** deste worker. Se o app mostra "O serviço que gera os vídeos não está respondendo", confira, nesta ordem:

1. `railway deployment list` — precisa haver um deploy `SUCCESS`. Só `REMOVED`/`FAILED` = worker parado (nada consome a fila).
2. Logs do worker: `worker_started` no boot; `bridge_error status 401` = `RENDER_WORKER_SECRET` diferente do app; `tick_exception` repetido = a URL não responde.
3. `RENDER_API_URL` deve ser o domínio **final** do app. O worker recusa redirecionamentos (`redirect: "error"`): um domínio que responde 307 para outro nunca entrega jobs.
4. `restartPolicyMaxRetries` é 3: depois de três quedas seguidas o Railway não religa o serviço sozinho.

Ao religar o worker ele processa **todos** os jobs que ficaram em `queued`, inclusive os antigos. Cancele antes os que não devem mais ser gerados.

## Fontes e licenças

As fontes em `assets/fonts` são redistribuídas sem modificação sob a SIL Open
Font License 1.1. O texto da licença de cada família fica em
`assets/fonts/licenses/OFL-<Família>.txt` (e, no app, em
`public/fonts/video/licenses`). O selfcheck e os testes falham se uma fonte
do registro (`src/scenes.ts` → `FONTS`) estiver sem a licença correspondente.
Ao adicionar uma fonte: inclua o `.ttf` e o `OFL-*.txt` nos dois lugares e
regenere `src/font-metrics.ts`.
