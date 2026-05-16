// Camada única de serviço WhatsApp. Hoje aponta para Evolution API
// (via Edge Functions Supabase). Trocar de provider futuramente
// significa só alterar as funções abaixo — o app consome essa interface.

import { supabase } from "@/integrations/supabase/client";

export type WhatsAppStatus = {
  ok: boolean;
  connected: boolean;
  state?: string; // "open" | "connecting" | "close" | ...
  instance?: string;
  error?: string;
};

export type WhatsAppQr = {
  ok: boolean;
  connected: boolean;
  qrcode?: string; // base64 data URL ou string crua
  pairingCode?: string;
  error?: string;
};

export type SendMessageInput = {
  number: string; // telefone (apenas dígitos) OU JID
  message: string;
  whatsapp_jid?: string;
  contactName?: string;
};

export type SendMessageResult = {
  ok: boolean;
  error?: string;
  messageId?: string;
};

export const whatsappProvider = {
  provider: "evolution" as const,

  async getStatus(): Promise<WhatsAppStatus> {
    const { data, error } = await supabase.functions.invoke("whatsapp-status", {
      body: { action: "status" },
    });
    if (error) return { ok: false, connected: false, error: error.message };
    return (data as WhatsAppStatus) ?? { ok: false, connected: false };
  },

  async getQrCode(): Promise<WhatsAppQr> {
    const { data, error } = await supabase.functions.invoke("whatsapp-status", {
      body: { action: "qr" },
    });
    if (error) return { ok: false, connected: false, error: error.message };
    return (data as WhatsAppQr) ?? { ok: false, connected: false };
  },

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
      body: {
        number: input.number,
        message: input.message,
        whatsapp_jid: input.whatsapp_jid,
        contactName: input.contactName,
      },
    });
    if (error) return { ok: false, error: error.message };
    if (!data?.ok) return { ok: false, error: data?.error ?? "send failed" };
    return { ok: true, messageId: data?.messageId };
  },

  async syncContacts(): Promise<{ ok: boolean; contacts: unknown[]; error?: string }> {
    const { data, error } = await supabase.functions.invoke("whatsapp-status", {
      body: { action: "contacts" },
    });
    if (error) return { ok: false, contacts: [], error: error.message };
    return {
      ok: Boolean(data?.ok),
      contacts: Array.isArray(data?.contacts) ? data.contacts : [],
      error: data?.error,
    };
  },
};
