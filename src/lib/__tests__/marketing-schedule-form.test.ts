// Testa as regras puras do modal de agendamento (fuso local, validações,
// mensagens de erro). NÃO cobre a UI — a UI apenas orquestra este módulo.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseLocalDateTime,
  validateScheduleForm,
} from "../marketing/schedule-form";

afterEach(() => {
  vi.useRealTimers();
});

describe("parseLocalDateTime", () => {
  it("rejeita string vazia", () => {
    const r = parseLocalDateTime("");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("empty");
  });

  it("rejeita null/undefined", () => {
    expect(parseLocalDateTime(null).ok).toBe(false);
    expect(parseLocalDateTime(undefined).ok).toBe(false);
  });

  it("rejeita formato inválido", () => {
    const r = parseLocalDateTime("15/01/2025 14:30");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_format");
  });

  it("rejeita datas impossíveis (31 de fevereiro)", () => {
    const r = parseLocalDateTime("2025-02-31T10:00");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_date");
  });

  it("rejeita horas fora do intervalo", () => {
    expect(parseLocalDateTime("2025-01-15T25:00").ok).toBe(false);
    expect(parseLocalDateTime("2025-01-15T10:75").ok).toBe(false);
  });

  it("aceita data válida sem segundos", () => {
    const r = parseLocalDateTime("2025-01-15T14:30");
    expect(r.ok).toBe(true);
    expect(r.date).toBeInstanceOf(Date);
    // Interpretado no fuso local — não como UTC:
    expect(r.date!.getFullYear()).toBe(2025);
    expect(r.date!.getMonth()).toBe(0);
    expect(r.date!.getDate()).toBe(15);
    expect(r.date!.getHours()).toBe(14);
    expect(r.date!.getMinutes()).toBe(30);
  });

  it("aceita data com segundos", () => {
    const r = parseLocalDateTime("2025-01-15T14:30:45");
    expect(r.ok).toBe(true);
    expect(r.date!.getSeconds()).toBe(45);
  });

  it("horário local é convertido para ISO UTC respeitando offset do host", () => {
    const r = parseLocalDateTime("2025-01-15T14:30");
    expect(r.ok).toBe(true);
    // O ISO gerado corresponde ao MESMO instante do Date local — o offset
    // aplicado é o do runtime que executa o teste. O invariante é que
    // decodificar de volta produz a mesma data/hora local.
    const back = new Date(r.iso!);
    expect(back.getFullYear()).toBe(2025);
    expect(back.getMonth()).toBe(0);
    expect(back.getDate()).toBe(15);
    expect(back.getHours()).toBe(14);
    expect(back.getMinutes()).toBe(30);
  });

  it("NÃO trata o valor como UTC puro (14:30 local != 14:30Z quando há offset)", () => {
    const r = parseLocalDateTime("2025-01-15T14:30");
    expect(r.ok).toBe(true);
    const offsetMin = new Date(2025, 0, 15, 14, 30).getTimezoneOffset();
    if (offsetMin !== 0) {
      // Em qualquer runtime com offset != 0 o ISO NÃO pode ser 14:30Z.
      expect(r.iso).not.toBe("2025-01-15T14:30:00.000Z");
    }
  });
});

describe("validateScheduleForm", () => {
  const base = {
    scheduleFor: "content-1",
    scheduleAt: "2025-01-15T14:30",
    channel: "instagram" as const,
    mediaCount: 1,
  };

  it("aprova caso feliz", () => {
    const r = validateScheduleForm(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scheduleFor).toBe("content-1");
      expect(r.channel).toBe("instagram");
      expect(typeof r.iso).toBe("string");
    }
  });

  it("reprova sem conteúdo selecionado", () => {
    const r = validateScheduleForm({ ...base, scheduleFor: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.field === "scheduleFor")).toBe(true);
    }
  });

  it("reprova com data vazia e retorna mensagem clara", () => {
    const r = validateScheduleForm({ ...base, scheduleAt: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const dateErr = r.errors.find((e) => e.field === "scheduleAt");
      expect(dateErr).toBeDefined();
      expect(dateErr!.message).toBe("Selecione uma data e hora válidas para agendar.");
      // A UI usa esta discriminante para destacar o campo.
      if (dateErr && dateErr.field === "scheduleAt") {
        expect(dateErr.reason).toBe("empty");
      }
    }
  });

  it("reprova com data inválida", () => {
    const r = validateScheduleForm({ ...base, scheduleAt: "abacaxi" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const dateErr = r.errors.find((e) => e.field === "scheduleAt");
      expect(dateErr).toBeDefined();
    }
  });

  it("reprova Instagram sem mídia (mantém guard)", () => {
    const r = validateScheduleForm({ ...base, mediaCount: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.field === "media")).toBe(true);
    }
  });

  it("aprova Facebook/WhatsApp mesmo sem mídia", () => {
    for (const channel of ["facebook", "whatsapp"] as const) {
      const r = validateScheduleForm({ ...base, channel, mediaCount: 0 });
      expect(r.ok).toBe(true);
    }
  });
});
