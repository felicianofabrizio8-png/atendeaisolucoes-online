import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { listActiveLearningsForGrounding } from "./coach-learnings/coach-learnings.repository";
import type { SalesAgentGrounding } from "./sales-agent-core";

export async function loadSalesAgentGrounding(companyId: string): Promise<SalesAgentGrounding> {
  const [{ data: products }, { data: knowledge }, { data: commercial }, coachLearnings] =
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
      listActiveLearningsForGrounding(supabaseAdmin, companyId, 5),
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
    approvedCoachLearnings: coachLearnings.map((learning) => ({
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
    })),
  };
}
