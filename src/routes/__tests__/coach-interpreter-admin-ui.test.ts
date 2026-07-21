// FASE 3.0 — Testes unitários da UI Administrativa do Coach Interpreter.
// Escopo: apenas helpers/labels da rota isolada; nenhum acesso a rede/banco.
import { describe, it, expect } from "vitest";
import {
  extractDisabledMessage,
  formatDateTime,
  PROPOSAL_STATUS_LABEL,
  KIND_META,
} from "@/lib/coach-interpreter/admin-console";

describe("Coach Interpreter Admin UI — helpers", () => {
  it("detecta COACH_INTERPRETER_DISABLED em Error", () => {
    const err = new Error("COACH_INTERPRETER_DISABLED");
    expect(extractDisabledMessage(err)).toMatch(/desligada/i);
  });

  it("detecta COACH_INTERPRETER_KILLED em objeto plano", () => {
    expect(extractDisabledMessage({ message: "COACH_INTERPRETER_KILLED" })).toMatch(/kill-switch/i);
  });

  it("retorna null para erros não relacionados a feature flag", () => {
    expect(extractDisabledMessage(new Error("Network fail"))).toBeNull();
    expect(extractDisabledMessage(null)).toBeNull();
    expect(extractDisabledMessage(undefined)).toBeNull();
  });

  it("formatDateTime retorna '—' para null", () => {
    expect(formatDateTime(null)).toBe("—");
  });

  it("formatDateTime formata ISO válido em pt-BR", () => {
    const s = formatDateTime("2026-07-21T14:30:00Z");
    // pt-BR usa dd/mm/aa hh:mm
    expect(s).toMatch(/\d{2}\/\d{2}\/\d{2}/);
    expect(s).toMatch(/\d{2}:\d{2}/);
  });

  it("cobre os 8 estados de proposal exigidos pela Fase 3", () => {
    const required = [
      "pending",
      "edited",
      "discarded",
      "confirmed",
      "failed",
      "clarification",
      "classified",
      "duplicate",
    ];
    for (const s of required) {
      expect(PROPOSAL_STATUS_LABEL[s]).toBeTruthy();
    }
  });

  it("cobre os 5 kinds de mensagem exigidos pela Timeline", () => {
    const required = [
      "user_message",
      "assistant_message",
      "clarification_request",
      "confirmation_ack",
      "error",
    ];
    for (const k of required) {
      expect(KIND_META[k]).toBeTruthy();
      expect(KIND_META[k].label).toBeTruthy();
    }
  });
});
