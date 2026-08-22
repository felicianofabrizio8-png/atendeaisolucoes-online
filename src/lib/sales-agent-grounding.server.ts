import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { listLearningCandidates } from "./coach-learnings/coach-learnings.repository";
import { retrieveLearnings } from "./coach-learnings/retriever";
import type { SalesAgentGrounding } from "./sales-agent-core";

type AgentHistory = Array<{ role: "lead" | "agent" | "system"; text: string }>;

function mapLearning(learning: Awaited<ReturnType<typeof listLearningCandidates>>[number]) {
  return {
    id: learning.id,
    category: learning.category,
    title: learning.title,
    description: learning.description,
    rule: learning.rule_structured,
    productRef: learning.product_ref,
    positiveExample: learning.positive_example,
    negativeExample: learning.negative_example,
    priority: learning.priority,
    confidence: learning.confidence,
  };
}

export async function loadRelevantSalesAgentLearnings(
  companyId: string,
  history: AgentHistory,
): Promise<SalesAgentGrounding["approvedCoachLearnings"]> {
  const candidates = await listLearningCandidates(supabaseAdmin, companyId, 50);
  let lastLeadIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role === "lead") {
      lastLeadIndex = index;
      break;
    }
  }
  const currentMessage = lastLeadIndex >= 0 ? history[lastLeadIndex].text : null;
  const recentMessages = history
    .filter((_, index) => index !== lastLeadIndex)
    .slice(-6);
  const result = retrieveLearnings({
    companyId,
    currentMessage,
    recentMessages,
    candidates,
    maxSelected: 5,
  });
  return result.selected.map(mapLearning);
}

export async function loadSalesAgentGrounding(companyId: string): Promise<SalesAgentGrounding> {
  const [{ data: products }, { data: knowledge }, { data: commercial }] =
    await Promise.all([
      supabaseAdmin
        .from("products")
        .select("id, name, description, price, images, notes")
        .eq("company_id", companyId)
        .eq("active", true)
        .limit(10),
      supabaseAdmin
        .from("ai_knowledge_proposals")
        .select("question, answer, type")
        .eq("company_id", companyId)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("marketing_knowledge_base")
        .select("commercial_terms")
        .eq("company_id", companyId)
        .maybeSingle(),
    ]);

  return {
    catalog: (products ?? []).map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price as number | null,
      images: Array.isArray(product.images)
        ? (product.images as unknown[]).filter(
            (image): image is string => typeof image === "string",
          )
        : [],
      notes: product.notes,
    })),
    faqKnowledge: knowledge ?? [],
    commercialRules: {
      paymentMethods: null,
      commercialTerms: commercial?.commercial_terms ?? null,
    },
    approvedCoachLearnings: [],
  };
}
