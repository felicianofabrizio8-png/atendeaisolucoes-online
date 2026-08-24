import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { postGraph } from "@/lib/outbound/MetaOutbound.server";
import { isRealDelivery } from "@/lib/outbound/MetaOutboundContract";
import {
  detectFiberCatalogSize,
  normalizeRequestedProductIds,
  resolveFiberCatalogImages,
  resolveProductImages,
  type ProductImageCandidate,
  type ProductImageSelectionContext,
  type ResolvedProductImage,
} from "./sales-agent-product-images";

const PRODUCT_IMAGES_BUCKET = "product-images";

export async function loadValidatedProductImages(
  companyId: string,
  requestedIds: unknown,
  selectionContext: ProductImageSelectionContext = {},
): Promise<ResolvedProductImage[]> {
  const fiberSize = detectFiberCatalogSize(selectionContext);
  const ids = normalizeRequestedProductIds(requestedIds);
  if (!fiberSize && ids.length === 0) return [];
  const useFiberFallback = ids.length === 0 && fiberSize !== null;
  let query = supabaseAdmin
    .from("products")
    .select("id, name, images, category, description, notes")
    .eq("company_id", companyId)
    .eq("active", true);
  if (!useFiberFallback) query = query.in("id", ids);
  const { data, error } = await query;
  if (error) throw new Error("product_images_load_failed");
  const products = (data ?? []) as ProductImageCandidate[];
  return useFiberFallback
    ? resolveFiberCatalogImages(fiberSize, products, companyId)
    : resolveProductImages(ids, products, companyId);
}

export async function sendWhatsappProductImages(params: {
  companyId: string;
  conversationId: string;
  leadId: string;
  productIds: unknown;
  selectionContext?: ProductImageSelectionContext;
}): Promise<{ sent: number; failed: number }> {
  const images = await loadValidatedProductImages(
    params.companyId,
    params.productIds,
    params.selectionContext,
  );
  if (images.length === 0) return { sent: 0, failed: 0 };

  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("phone, external_id, integration_id, company_id")
    .eq("id", params.leadId)
    .eq("company_id", params.companyId)
    .maybeSingle();
  const recipient = String(lead?.external_id ?? lead?.phone ?? "").replace(/\D/g, "");
  if (!lead || recipient.length < 8 || recipient.length > 15) {
    return { sent: 0, failed: images.length };
  }

  const integrationQuery = supabaseAdmin
    .from("integrations")
    .select("id, access_token, external_account_id")
    .eq("company_id", params.companyId)
    .eq("channel", "whatsapp")
    .eq("active", true);
  const { data: integration } = lead.integration_id
    ? await integrationQuery.eq("id", lead.integration_id).maybeSingle()
    : await integrationQuery.limit(1).maybeSingle();
  if (!integration?.access_token || !integration.external_account_id) {
    return { sent: 0, failed: images.length };
  }

  let sent = 0;
  let failed = 0;
  for (const image of images) {
    try {
      const { data: signed, error: signError } = await supabaseAdmin.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .createSignedUrl(image.path, 60 * 60);
      if (signError || !signed?.signedUrl) {
        failed += 1;
        continue;
      }
      const payload = {
        messaging_product: "whatsapp",
        to: recipient,
        type: "image" as const,
        image: { link: signed.signedUrl },
      };
      const outbound = await postGraph<{ messages?: Array<{ id: string }> }>({
        companyId: params.companyId,
        action: "whatsapp.send.media",
        url: `https://graph.facebook.com/v20.0/${integration.external_account_id}/messages`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${integration.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        logicalPayload: payload,
        agentId: "ai-agent",
        extractExternalId: (json) =>
          (json as { messages?: Array<{ id: string }> })?.messages?.[0]?.id ?? null,
      });
      if (!isRealDelivery(outbound)) {
        failed += 1;
        continue;
      }
      const sentAt = new Date().toISOString();
      await supabaseAdmin.from("messages").insert({
        company_id: params.companyId,
        conversation_id: params.conversationId,
        role: "agent",
        text: `[imagem: ${image.productName}]`,
        at: sentAt,
        external_id: outbound.externalId,
        integration_id: integration.id,
        source: "ai_agent",
        source_subtype: "image",
        source_metadata: {
          media_url: image.path,
          type: "image",
          media_path: image.path,
          media_kind: "image",
          media_bucket: PRODUCT_IMAGES_BUCKET,
          product_id: image.productId,
          sent_by_sales_agent: true,
        },
      });
      await supabaseAdmin
        .from("conversations")
        .update({ last_message_at: sentAt, awaiting_reply: false })
        .eq("id", params.conversationId)
        .eq("company_id", params.companyId);
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  return { sent, failed };
}
