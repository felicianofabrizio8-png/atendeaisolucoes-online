// Lovable AI Gateway provider — implementação do contrato LLMProvider
// para uso via LLMGateway (que já centraliza cache/retry/fallback/billing).
// Não expõe a chave; lê LOVABLE_API_KEY apenas em execute().
import type { LLMProvider, LLMRequest, LLMResponse } from "./LLMProvider";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface LovableChatChoiceMessage {
  content?: string;
}
interface LovableChatChoice {
  message?: LovableChatChoiceMessage;
}
interface LovableChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}
interface LovableChatResponse {
  choices?: LovableChatChoice[];
  usage?: LovableChatUsage;
  model?: string;
}

export interface LovableChatProviderOptions {
  defaultModel?: string;
  timeoutMs?: number;
}

export class LovableChatProvider implements LLMProvider {
  readonly name = "lovable" as const;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(opts: LovableChatProviderOptions = {}) {
    this.defaultModel = opts.defaultModel ?? "google/gemini-2.5-flash";
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async execute(req: LLMRequest): Promise<LLMResponse> {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("provider_failure: LOVABLE_API_KEY missing");

    const model = req.model ?? this.defaultModel;
    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.responseFormat === "json") body.response_format = { type: "json_object" };

    const start = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("aborted")) throw new Error("timeout: lovable provider aborted");
      throw new Error(`network: ${msg}`);
    }
    clearTimeout(timer);

    if (res.status === 429) throw new Error("rate: lovable gateway rate-limited");
    if (res.status === 402) throw new Error("provider_failure: credits exhausted (402)");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `provider_failure: HTTP ${res.status} ${text.slice(0, 200)}`,
      );
    }

    const json = (await res.json()) as LovableChatResponse;
    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      provider: this.name,
      model: json.model ?? model,
      text,
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - start,
      cached: false,
      attempts: 1,
      fallbackUsed: false,
    };
  }
}
