export function isSalesAgentOpenAiResponsesEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.SALES_AGENT_OPENAI_RESPONSES === "enabled";
}
