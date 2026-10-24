import { OpenAiResponsesGateway } from "@/lib/ai-platform/gateway.server";
import type { ChatMessage } from "@/lib/ai-platform/types";

/** Opt-in por capability; ausência ou qualquer outro valor mantém Lovable. */
export function followupOpenAiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FOLLOWUP_OPENAI_ADAPTER === "enabled";
}

export async function runFollowupOpenAi(args: {
  companyId: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  tags: Record<string, string>;
}): Promise<{ text: string }> {
  const gateway = new OpenAiResponsesGateway();
  const system = args.messages.find((message) => message.role === "system")?.content;
  const input = args.messages
    .filter((message) => message.role !== "system")
    .map((message) => `${message.role === "assistant" ? "Atendente" : "Cliente"}: ${message.content}`)
    .join("\n");
  const result = await gateway.run({
    companyId: args.companyId,
    capability: "followup",
    instructions: system,
    input,
    store: false,
    maxOutputTokens: args.maxTokens,
    tags: args.tags,
  });
  return { text: result.outputText };
}
