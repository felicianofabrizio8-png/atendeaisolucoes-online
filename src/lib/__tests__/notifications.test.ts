import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setNotificationPrefs } from "../notification-prefs";
import {
  isHumanHandoffTransition,
  notifyHumanHandoff,
  notifyNewLeadMessage,
} from "../notifications";

interface NotificationInstance {
  title: string;
  options: NotificationOptions;
  onclick: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
}

const instances: NotificationInstance[] = [];
const notificationsSource = readFileSync(
  fileURLToPath(new URL("../notifications.ts", import.meta.url)),
  "utf8",
);
const leadRepoSource = readFileSync(
  fileURLToPath(new URL("../../data/leadRepo.ts", import.meta.url)),
  "utf8",
);
const bridgeSource = readFileSync(
  fileURLToPath(new URL("../../components/NotificationBridge.tsx", import.meta.url)),
  "utf8",
);

class NotificationMock {
  static permission: NotificationPermission = "granted";
  onclick: (() => void) | null = null;
  close = vi.fn();

  constructor(
    public title: string,
    public options: NotificationOptions = {},
  ) {
    instances.push(this);
  }
}

describe("notifications", () => {
  beforeEach(() => {
    instances.length = 0;
    setNotificationPrefs({ soundEnabled: false, browserEnabled: true });
    vi.stubGlobal("Notification", NotificationMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mantém a notificação existente para nova mensagem do cliente", () => {
    const onOpen = vi.fn();
    notifyNewLeadMessage({
      messageId: "message-notification-test",
      conversationId: "conversation-message-test",
      leadName: "Maria",
      body: "Olá",
      suppressBrowser: false,
      onOpen,
    });

    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      title: "Maria",
      options: { body: "Olá", tag: "conv-conversation-message-test" },
    });
    instances[0].onclick?.();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("reconhece somente a entrada no estado canônico de handoff", () => {
    expect(isHumanHandoffTransition(null, "aguardando_humano")).toBe(true);
    expect(isHumanHandoffTransition("pre_atendido_ia", "aguardando_humano")).toBe(true);
    expect(isHumanHandoffTransition("aguardando_humano", "aguardando_humano")).toBe(false);
    expect(isHumanHandoffTransition("aguardando_humano", "assumido_humano")).toBe(false);
  });

  it("liga a transição Realtime ao alerta forte sem alterar o alerta de mensagem", () => {
    expect(leadRepoSource).toContain('payload.eventType === "UPDATE"');
    expect(leadRepoSource).toContain("isHumanHandoffTransition(previous?.aiStatus, next.aiStatus)");
    expect(bridgeSource).toContain("subscribeNewLeadMessage");
    expect(bridgeSource).toContain("subscribeHumanHandoff");
    expect(bridgeSource).toContain("notifyHumanHandoff");
    expect(notificationsSource).toContain("playBeep(input.suppressBrowser ? 0.08 : 0.18)");
    expect(notificationsSource).toContain("if (prefs.soundEnabled) playHandoffAlert()");
  });

  it("deduplica handoff por conversa e abre a conversa ao clicar", () => {
    const onOpen = vi.fn();
    const input = {
      conversationId: "conversation-handoff-test",
      leadName: "João",
      onOpen,
    };

    notifyHumanHandoff(input);
    notifyHumanHandoff(input);

    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      title: "Atendimento humano necessário",
      options: {
        body: "João precisa de um atendente humano.",
        tag: "handoff-conversation-handoff-test",
        requireInteraction: true,
      },
    });
    instances[0].onclick?.();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(instances[0].close).toHaveBeenCalledOnce();
  });
});
