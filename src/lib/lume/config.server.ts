/**
 * Configuração da IA Lume (assistente da equipe).
 *
 * Chave própria — LUME_AI_ENDPOINT, LUME_AI_MODEL, LUME_AI_API_KEY — separada da
 * Vendedora, para custo e limites não se misturarem. Sem ela, usa a configuração da
 * Vendedora (SALES_AGENT_LLM_*). O provedor precisa ser compatível com a API de chat
 * da OpenAI e aceitar `tools` (chamada de função).
 *
 * Áudio: LUME_AI_TRANSCRIBE_URL / _MODEL / _API_KEY; sem chave própria, usa
 * OPENAI_API_KEY com o Whisper, como as mensagens de áudio do WhatsApp.
 */

export interface LumeLlmConfig {
  endpoint: string;
  model: string;
  apiKey: string;
  origin: "lume" | "vendedora";
}

export interface LumeTranscribeConfig {
  url: string;
  model: string;
  apiKey: string;
}

type Env = Record<string, string | undefined>;

function httpsUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function resolveLumeLlmConfig(env: Env = process.env): LumeLlmConfig | null {
  const own = {
    endpoint: httpsUrl(env.LUME_AI_ENDPOINT),
    model: env.LUME_AI_MODEL?.trim(),
    apiKey: env.LUME_AI_API_KEY?.trim(),
  };
  if (own.endpoint && own.model && own.apiKey)
    return { endpoint: own.endpoint, model: own.model, apiKey: own.apiKey, origin: "lume" };
  const shared = {
    endpoint: httpsUrl(env.SALES_AGENT_LLM_ENDPOINT),
    model: env.SALES_AGENT_LLM_MODEL?.trim(),
    apiKey: env.SALES_AGENT_LLM_API_KEY?.trim(),
  };
  if (shared.endpoint && shared.model && shared.apiKey)
    return {
      endpoint: shared.endpoint,
      model: shared.model,
      apiKey: shared.apiKey,
      origin: "vendedora",
    };
  return null;
}

export function resolveLumeTranscribeConfig(env: Env = process.env): LumeTranscribeConfig | null {
  const apiKey = env.LUME_AI_TRANSCRIBE_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    url: httpsUrl(env.LUME_AI_TRANSCRIBE_URL) ?? "https://api.openai.com/v1/audio/transcriptions",
    model: env.LUME_AI_TRANSCRIBE_MODEL?.trim() || "whisper-1",
    apiKey,
  };
}

/** O que a tela precisa saber, sem expor chave nem endereço. */
export function lumeReadiness(env: Env = process.env) {
  const llm = resolveLumeLlmConfig(env);
  return {
    chat: !!llm,
    origin: llm?.origin ?? null,
    voice: !!resolveLumeTranscribeConfig(env),
  };
}
