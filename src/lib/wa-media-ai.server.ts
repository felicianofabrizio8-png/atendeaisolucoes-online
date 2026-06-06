// ============================================================================
// WhatsApp Media AI — camada adicional, NÃO altera o fluxo de texto
// ============================================================================
// Recebe uma mídia já baixada (bytes em memória) e devolve metadados que serão
// mesclados em `messages.source_metadata`. Cada caminho é isolado em try/catch
// — qualquer falha retorna { ai_media_error } e a mensagem continua sendo
// salva normalmente pelo webhook.
//
// Provedores:
//   - Imagens / PDFs → Lovable AI Gateway (Gemini 2.5 Flash) via vision.
//   - Áudios         → OpenAI Whisper se OPENAI_API_KEY estiver configurada.
//                       Sem chave, devolve um aviso (não é erro) e mantém o
//                       áudio acessível para atendimento humano.
//
// Nenhum token ou URL temporária da Meta é logado.
// ============================================================================

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const VISION_MODEL = "google/gemini-2.5-flash";
const VISION_TIMEOUT_MS = 20_000;
const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-1";
const WHISPER_TIMEOUT_MS = 25_000;

export type EnrichKind = "image" | "audio" | "document";

export interface EnrichResult {
  /** Metadados a mesclar em source_metadata. */
  metadata: Record<string, unknown>;
  /** Texto enriquecido para usar como `messages.text` quando aplicável. */
  text: string | null;
}

interface EnrichArgs {
  kind: EnrichKind;
  mime: string;
  bytes: Uint8Array;
  filename?: string | null;
}

export async function enrichMediaWithAI(args: EnrichArgs): Promise<EnrichResult> {
  try {
    if (args.kind === "image") return await visionImage(args);
    if (args.kind === "audio") return await transcribeAudio(args);
    if (args.kind === "document") return await visionDocument(args);
  } catch (e) {
    return {
      metadata: { ai_media_error: e instanceof Error ? e.message : String(e) },
      text: null,
    };
  }
  return { metadata: {}, text: null };
}

// --------------------------------------------------------------------------
// Image vision (Lovable AI Gateway)
// --------------------------------------------------------------------------
async function visionImage(args: EnrichArgs): Promise<EnrichResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return {
      metadata: { ai_media_error: "LOVABLE_API_KEY ausente — visão indisponível" },
      text: null,
    };
  }
  const dataUrl = bytesToDataUrl(args.bytes, args.mime || "image/jpeg");
  const summary = await callLovableVision(
    apiKey,
    `Você é um assistente que descreve em português brasileiro, em até 3 frases, o que aparece em uma imagem enviada por um cliente via WhatsApp. Seja objetivo: identifique se é foto de produto, ambiente, comprovante, print de orçamento, dúvida etc. Liste valores, números ou textos visíveis quando relevantes.`,
    dataUrl,
  );
  console.log("[wa-media-ai] vision_concluida", {
    kind: "image",
    mime: args.mime,
    summary_len: summary.length,
  });
  return {
    metadata: {
      vision_summary: summary,
      vision_model: VISION_MODEL,
      vision_at: new Date().toISOString(),
    },
    text: `[imagem] ${summary}`.slice(0, 1500),
  };
}

// --------------------------------------------------------------------------
// PDF / document vision (Lovable AI Gateway com fallback para nome do arquivo)
// --------------------------------------------------------------------------
async function visionDocument(args: EnrichArgs): Promise<EnrichResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return {
      metadata: { ai_media_error: "LOVABLE_API_KEY ausente — leitura de documento indisponível" },
      text: null,
    };
  }
  // Apenas tentamos extrair texto/resumo de PDFs ou imagens enviadas como
  // documento. Outros formatos (docx, xlsx) ficam só disponíveis para humano.
  const mime = (args.mime || "").toLowerCase();
  const isPdf = mime === "application/pdf";
  const isImage = mime.startsWith("image/");
  if (!isPdf && !isImage) {
    return {
      metadata: {
        ai_media_error: `Formato ${mime || "desconhecido"} não suportado para extração automática`,
      },
      text: null,
    };
  }
  const dataUrl = bytesToDataUrl(args.bytes, mime || "application/pdf");
  const summary = await callLovableVision(
    apiKey,
    `Você é um assistente que lê documentos enviados por clientes via WhatsApp. Em português brasileiro e em até 5 frases: extraia os pontos principais (nomes, valores, datas, condições, perguntas). Se for um orçamento, comprovante ou contrato, indique. Se não conseguir ler, diga "documento ilegível".`,
    dataUrl,
  );
  console.log("[wa-media-ai] documento_processado", {
    mime,
    filename: args.filename ?? null,
    summary_len: summary.length,
  });
  return {
    metadata: {
      document_summary: summary,
      extracted_text: isPdf ? summary : null,
      vision_model: VISION_MODEL,
      vision_at: new Date().toISOString(),
    },
    text: `[documento${args.filename ? ` ${args.filename}` : ""}] ${summary}`.slice(0, 1500),
  };
}

// --------------------------------------------------------------------------
// Audio transcription (OpenAI Whisper, opcional)
// --------------------------------------------------------------------------
async function transcribeAudio(args: EnrichArgs): Promise<EnrichResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("[wa-media-ai] transcricao_pulada_sem_chave");
    return {
      metadata: {
        ai_media_error:
          "OPENAI_API_KEY não configurada — áudio salvo, atendimento humano pode ouvir.",
      },
      text: null,
    };
  }

  console.log("[wa-media-ai] transcricao_iniciada", {
    mime: args.mime,
    size: args.bytes.byteLength,
  });

  const ext = audioExt(args.mime);
  const form = new FormData();
  const blob = new Blob([args.bytes as unknown as BlobPart], {
    type: args.mime || "audio/ogg",
  });
  form.append("file", blob, `audio.${ext}`);
  form.append("model", WHISPER_MODEL);
  form.append("language", "pt");
  form.append("response_format", "json");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), WHISPER_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(WHISPER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Whisper HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { text?: string };
  const transcription = (json.text ?? "").trim();
  if (!transcription) {
    return {
      metadata: { ai_media_error: "Transcrição vazia retornada pelo Whisper" },
      text: null,
    };
  }
  console.log("[wa-media-ai] transcricao_concluida", {
    chars: transcription.length,
  });
  return {
    metadata: {
      transcription_text: transcription,
      transcription_model: WHISPER_MODEL,
      transcription_at: new Date().toISOString(),
    },
    text: transcription,
  };
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
async function callLovableVision(
  apiKey: string,
  systemPrompt: string,
  dataUrl: string,
): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(LOVABLE_GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Descreva o conteúdo:" },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gateway HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("Resposta vazia do modelo de visão");
  return text;
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  // Buffer está disponível no runtime do Worker via nodejs_compat.
  const b64 = Buffer.from(bytes).toString("base64");
  return `data:${mime};base64,${b64}`;
}

function audioExt(mime: string | undefined): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg")) return "mp3";
  if (m.includes("mp4")) return "m4a";
  if (m.includes("wav")) return "wav";
  if (m.includes("webm")) return "webm";
  if (m.includes("aac")) return "aac";
  return "ogg";
}
