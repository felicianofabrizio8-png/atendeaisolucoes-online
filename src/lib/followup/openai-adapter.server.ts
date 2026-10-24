import { OpenAiResponsesGateway } from "@/lib/ai-platform/gateway.server";
import type { ChatMessage } from "@/lib/ai-platform/types";
import { createHash } from "node:crypto";
import { finishWalletCharge, reserveWalletCharge, type WalletReservation } from "@/lib/financial-wallet/wallet.server";

/** Opt-in por capability; ausência ou qualquer outro valor mantém Lovable. */
export function followupOpenAiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FOLLOWUP_OPENAI_ADAPTER === "enabled";
}

/** Requer opt-in OpenAI e confirmação autorizada da compatibilidade Meta. */
export function followupResumePersonalizationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return followupOpenAiEnabled(env) && env.FOLLOWUP_RESUME_META_VALIDATED === "enabled";
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
  const chargeId = args.tags.charge_id ?? createHash("sha256")
    .update(JSON.stringify({ companyId: args.companyId, system, input, tags: args.tags }))
    .digest("hex").slice(0, 32);
  let reservation: WalletReservation | null = null;
  try {
    reservation = await reserveWalletCharge({
      companyId: args.companyId, wallet: "ia", idempotencyKey: `ai:${chargeId}`,
      purpose: args.tags.feature ?? "followup_ai", referenceId: chargeId, automated: true,
    });
    const result = await gateway.run({
      companyId: args.companyId, capability: "followup", instructions: system, input,
      store: false, maxOutputTokens: Math.max(args.maxTokens, 256), tags: args.tags,
    });
    await finishWalletCharge({ companyId: args.companyId, reservation, action: "commit", idempotencyKey: `ai:${chargeId}` });
    return { text: result.outputText };
  } catch (error) {
    await finishWalletCharge({ companyId: args.companyId, reservation, action: "release", idempotencyKey: `ai:${chargeId}` }).catch(() => undefined);
    throw error;
  }
}
