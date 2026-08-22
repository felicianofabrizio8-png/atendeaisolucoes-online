export interface SalesAgentLlmConfig {
  endpoint: string;
  model: string;
  apiKey: string;
}

export type SalesAgentLlmConfigResult =
  | { ok: true; config: SalesAgentLlmConfig }
  | { ok: false; reason: string };

export function resolveSalesAgentLlmConfig(
  env: Record<string, string | undefined> = process.env,
): SalesAgentLlmConfigResult {
  const endpoint = env.SALES_AGENT_LLM_ENDPOINT?.trim();
  const model = env.SALES_AGENT_LLM_MODEL?.trim();
  const apiKey = env.SALES_AGENT_LLM_API_KEY?.trim();
  const missing = [
    !endpoint ? "SALES_AGENT_LLM_ENDPOINT" : null,
    !model ? "SALES_AGENT_LLM_MODEL" : null,
    !apiKey ? "SALES_AGENT_LLM_API_KEY" : null,
  ].filter((name): name is string => Boolean(name));

  if (!endpoint || !model || !apiKey) {
    return { ok: false, reason: `sales_agent_config_missing:${missing.join(",")}` };
  }

  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") {
      return { ok: false, reason: "sales_agent_config_invalid_endpoint" };
    }
  } catch {
    return { ok: false, reason: "sales_agent_config_invalid_endpoint" };
  }

  return { ok: true, config: { endpoint, model, apiKey } };
}
