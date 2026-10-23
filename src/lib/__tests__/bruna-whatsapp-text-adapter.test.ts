/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendBrunaWhatsappText } from "../bruna-whatsapp-text-adapter.server";
import type { BrunaLease } from "../bruna/bruna-lease.server";
import type { WhatsappSendAuthorization } from "../whatsapp-send-authorization.server";

const rows = {
  company: { id: "tenant-a" },
  conversation: {
    id: "conversation-a",
    company_id: "tenant-a",
    lead_id: "lead-a",
    channel: "whatsapp",
    sales_agent_auto_reply: false,
    ai_status: null as string | null,
    human_takeover_at: null as string | null,
  },
  lead: {
    id: "lead-a",
    company_id: "tenant-a",
    channel: "whatsapp",
    integration_id: "integration-a",
    phone: "5511999998888",
    external_id: null,
  },
  integration: {
    id: "integration-a",
    company_id: "tenant-a",
    channel: "whatsapp",
    active: true,
    access_token: "integration-token" as string | null,
    external_account_id: "phone-number-a" as string | null,
  },
  settings: {
    company_id: "tenant-a",
    sales_agent_v2_enabled: true,
    sales_agent_v2_mode: "automatic" as string,
    sales_agent_master_enabled: true,
  },
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    from: (table: string) => {
      const state =
        table === "companies"
          ? rows.company
          : table === "conversations"
            ? rows.conversation
            : table === "leads"
              ? rows.lead
              : table === "integrations"
                ? rows.integration
                : rows.settings;
      const filters: Record<string, unknown> = {};
      const chain: any = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        maybeSingle: async () => ({
          data:
            (table === "conversations" || table === "leads" || table === "integrations") &&
            filters.company_id !== undefined &&
            filters.company_id !== (state as { company_id?: string }).company_id
              ? null
              : state,
          error: null,
        }),
      };
      return chain;
    },
  },
}));

const authorization = {
  companyId: "tenant-a",
  conversationId: "conversation-a",
  leadId: "lead-a",
  integrationId: "integration-a",
  source: "automatic" as const,
};

const context = {
  accessToken: "test-token",
  phoneNumberId: "phone-number-a",
  recipient: "5511999998888",
};
const graph = vi.fn();

const simulatedOutbound = (simulationId = "sim-1") => ({
  success: true as const,
  simulated: true as const,
  environment: "staging" as const,
  externalRequestSent: false as const,
  simulationId,
  would: { url: "https://graph.facebook.com/v20.0/phone-number-a/messages", method: "POST" },
});

const deliveredOutbound = (externalId: string | null) => ({
  success: true as const,
  simulated: false as const,
  environment: "production" as const,
  externalRequestSent: true as const,
  externalId,
  status: 200,
  raw: { messages: externalId ? [{ id: externalId }] : [] },
});

const failedOutbound = (error = "graph_rejected") => ({
  success: false as const,
  simulated: false as const,
  environment: "production" as const,
  externalRequestSent: true as const,
  error,
  status: 400,
  retryable: false,
  providerError: { message: error },
  rawBody: JSON.stringify({ error: { message: error } }),
  parsedBody: { error: { message: error } },
});

const lease: BrunaLease = {
  companyId: "tenant-a",
  leaseKey: "bruna-whatsapp-text:tenant-a:conversation-a",
  ownerId: "owner-a",
  fenceToken: 1,
  expiresAt: "2030-01-01T00:01:00.000Z",
};
const lock = vi.fn().mockResolvedValue({ ok: true, lease });
const renew = vi.fn().mockResolvedValue({ ok: true, lease });
const validate = vi.fn().mockResolvedValue({
  ok: true,
  valid: true,
  expiresAt: lease.expiresAt,
  fenceToken: lease.fenceToken,
});
const unlock = vi.fn().mockResolvedValue(true);
const dedupe = vi.fn().mockResolvedValue(true);
const persist = vi.fn().mockResolvedValue(undefined);
const attemptCreate = vi.fn().mockResolvedValue({ id: "attempt-a" });
const attemptClaim = vi.fn().mockResolvedValue(undefined);
const attemptAccept = vi.fn().mockResolvedValue(undefined);
const attemptComplete = vi.fn().mockResolvedValue(undefined);
const attemptFail = vi.fn().mockResolvedValue(undefined);
const attemptUncertain = vi.fn().mockResolvedValue(undefined);
const attempt = {
  create: attemptCreate,
  claim: attemptClaim,
  accept: attemptAccept,
  complete: attemptComplete,
  fail: attemptFail,
  uncertain: attemptUncertain,
};
const brunaLeaseDeps = {
  acquireLease: lock,
  renewLease: renew,
  validateLease: validate,
  releaseLease: unlock,
  tryDedupe: dedupe,
  attempt,
};

beforeEach(() => {
  graph.mockReset();
  lock.mockReset().mockResolvedValue({ ok: true, lease });
  renew.mockReset().mockResolvedValue({ ok: true, lease });
  validate.mockReset().mockResolvedValue({
    ok: true,
    valid: true,
    expiresAt: lease.expiresAt,
    fenceToken: lease.fenceToken,
  });
  unlock.mockReset().mockResolvedValue(true);
  dedupe.mockReset().mockResolvedValue(true);
  persist.mockReset().mockResolvedValue(undefined);
  attemptCreate.mockReset().mockResolvedValue({ id: "attempt-a" });
  attemptClaim.mockReset().mockResolvedValue(undefined);
  attemptAccept.mockReset().mockResolvedValue(undefined);
  attemptComplete.mockReset().mockResolvedValue(undefined);
  attemptFail.mockReset().mockResolvedValue(undefined);
  attemptUncertain.mockReset().mockResolvedValue(undefined);
  rows.conversation.sales_agent_auto_reply = false;
  rows.conversation.ai_status = null;
  rows.conversation.human_takeover_at = null;
  rows.settings.sales_agent_v2_mode = "automatic";
});

const send = (
  overrides: Partial<{
    companyId: string;
    conversationId: string;
    actionId: string;
    text: string;
    graphTimeoutMs: number;
  }> = {},
) =>
  sendBrunaWhatsappText(
    {
      companyId: "tenant-a",
      conversationId: "conversation-a",
      leadId: "lead-a",
      actionId: "action-a",
      source: "automatic",
      text: "Olá",
      ...overrides,
    },
    {
      loadContext: async () => context,
      sendGraph: graph,
      graphTimeoutMs: overrides.graphTimeoutMs,
      acquireLease: lock,
      renewLease: renew,
      validateLease: validate,
      releaseLease: unlock,
      leaseRenewIntervalMs: 1_000,
      tryDedupe: dedupe,
      persist,
      attempt,
    },
  );

describe("Bruna WhatsApp text adapter", () => {
  it.each([
    ["automatic", false, true],
    ["assisted", false, false],
    ["assisted", true, true],
    ["silent", true, false],
  ])("enforces mode %s (conversation=%s)", async (mode, conversationEnabled, allowed) => {
    rows.settings.sales_agent_v2_mode = mode;
    rows.conversation.sales_agent_auto_reply = conversationEnabled;
    graph.mockResolvedValue(simulatedOutbound());
    const result = await send();
    expect(result.ok).toBe(allowed);
    expect(graph).toHaveBeenCalledTimes(allowed ? 1 : 0);
    if (allowed) expect(result).toMatchObject({ ok: true, simulated: true, externalId: null });
  });

  it("blocks takeover before the simulated Graph API", async () => {
    rows.conversation.ai_status = "assumido_humano";
    const result = await send();
    expect(result).toMatchObject({
      ok: false,
      stage: "authorization",
      code: "whatsapp_send_not_authorized",
    });
    expect(graph).not.toHaveBeenCalled();
  });

  it("blocks a cross-tenant conversation and never calls Graph", async () => {
    rows.conversation.company_id = "tenant-b";
    const result = await send();
    expect(result).toMatchObject({
      ok: false,
      stage: "authorization",
      code: "whatsapp_send_not_authorized",
    });
    expect(graph).not.toHaveBeenCalled();
    rows.conversation.company_id = "tenant-a";
  });

  it("does not fall back when authorization fails", async () => {
    const authorize = vi.fn().mockRejectedValue(new Error("authorization_store_unavailable"));
    const result = await sendBrunaWhatsappText(
      {
        companyId: "tenant-a",
        conversationId: "conversation-a",
        leadId: "lead-a",
        actionId: "action-a",
        source: "automatic",
        text: "Olá",
      },
      { authorize, loadContext: async () => context, sendGraph: graph },
    );
    expect(result).toMatchObject({ ok: false, stage: "authorization" });
    expect(graph).not.toHaveBeenCalled();
  });

  it("rejects every non-automatic source before authorization", async () => {
    const authorize = vi.fn();
    const result = await sendBrunaWhatsappText(
      {
        companyId: "tenant-a",
        conversationId: "conversation-a",
        leadId: "lead-a",
        actionId: "action-a",
        source: "human" as never,
        text: "Olá",
      },
      { authorize, sendGraph: graph },
    );
    expect(result).toMatchObject({
      ok: false,
      stage: "authorization",
      code: "whatsapp_send_source_not_allowed",
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
  });

  it("revalidates takeover immediately before Graph", async () => {
    const authorize = vi
      .fn()
      .mockResolvedValueOnce(authorization)
      .mockRejectedValueOnce(new Error("whatsapp_send_not_permitted"));
    const result = await sendBrunaWhatsappText(
      {
        companyId: "tenant-a",
        conversationId: "conversation-a",
        leadId: "lead-a",
        actionId: "action-a",
        source: "automatic",
        text: "Olá",
      },
      {
        authorize,
        loadContext: async () => context,
        sendGraph: graph,
        ...brunaLeaseDeps,
      },
    );
    expect(result).toMatchObject({
      ok: false,
      stage: "authorization",
      code: "whatsapp_send_not_authorized",
    });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(graph).not.toHaveBeenCalled();
  });

  it("validates the current Bruna lease and fence token before Graph", async () => {
    graph.mockResolvedValue(simulatedOutbound("sim-lease-valid"));

    await expect(send()).resolves.toMatchObject({ ok: true, simulated: true });
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({ fenceToken: 1 }));
    expect(graph).toHaveBeenCalledTimes(1);
  });

  it("does not send when the current Bruna lease is invalid", async () => {
    validate.mockResolvedValue({ ok: false, reason: "invalid" });

    await expect(send()).resolves.toMatchObject({
      ok: false,
      stage: "dedupe",
      code: "whatsapp_lease_invalid",
    });
    expect(graph).not.toHaveBeenCalled();
  });

  it("does not send when the current Bruna lease has expired", async () => {
    validate.mockResolvedValue({ ok: true, valid: false });

    await expect(send()).resolves.toMatchObject({
      ok: false,
      stage: "dedupe",
      code: "whatsapp_lease_expired",
    });
    expect(graph).not.toHaveBeenCalled();
  });

  it("fails closed when lease validation errors", async () => {
    validate.mockRejectedValue(new Error("lease_validation_store_down"));

    await expect(send()).resolves.toMatchObject({
      ok: false,
      stage: "dedupe",
      code: "whatsapp_lease_validation_failed",
      error: "lease_validation_store_down",
    });
    expect(graph).not.toHaveBeenCalled();
  });

  it("does not send when the lease is lost during preparation", async () => {
    vi.useFakeTimers();
    try {
      const authorize = vi
        .fn()
        .mockResolvedValueOnce(authorization)
        .mockImplementationOnce(
          () => new Promise((resolve) => setTimeout(() => resolve(authorization), 1_500)),
        );
      renew.mockResolvedValueOnce({ ok: false, reason: "busy" });

      const pending = sendBrunaWhatsappText(
        {
          companyId: "tenant-a",
          conversationId: "conversation-a",
          leadId: "lead-a",
          actionId: "action-a",
          source: "automatic",
          text: "OlÃ¡",
        },
        {
          authorize,
          loadContext: async () => context,
          sendGraph: graph,
          ...brunaLeaseDeps,
          leaseRenewIntervalMs: 1_000,
        },
      );

      // Let acquire, dedupe, the second authorization, and the renewal timer
      // be installed before advancing the preparation delay. Without this
      // flush, the timer is created only after the clock has already moved and
      // the test does not prove that the lease was lost before Graph.
      for (let attempt = 0; attempt < 32 && authorize.mock.calls.length < 2; attempt += 1) {
        await Promise.resolve();
      }
      expect(lock).toHaveBeenCalledWith(expect.objectContaining({ companyId: "tenant-a" }));
      expect(authorize).toHaveBeenCalledTimes(2);
      expect(graph).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(renew).toHaveBeenCalledWith({ lease, ttlSeconds: 30 });
      await vi.advanceTimersByTimeAsync(1_500);
      await expect(pending).resolves.toMatchObject({
        ok: false,
        stage: "dedupe",
        code: "whatsapp_lease_lost",
      });
      expect(graph).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports context and Graph exceptions explicitly", async () => {
    const contextError = await sendBrunaWhatsappText(
      {
        companyId: "tenant-a",
        conversationId: "conversation-a",
        leadId: "lead-a",
        actionId: "action-a",
        source: "automatic",
        text: "Olá",
      },
      {
        loadContext: async () => Promise.reject(new Error("context_down")),
        sendGraph: graph,
        ...brunaLeaseDeps,
      },
    );
    expect(contextError).toMatchObject({
      ok: false,
      stage: "context",
      code: "whatsapp_context_load_failed",
      error: "context_down",
    });

    const graphError = await sendBrunaWhatsappText(
      {
        companyId: "tenant-a",
        conversationId: "conversation-a",
        leadId: "lead-a",
        actionId: "action-a",
        source: "automatic",
        text: "Olá",
      },
      {
        loadContext: async () => context,
        sendGraph: async () => Promise.reject(new Error("graph_down")),
        ...brunaLeaseDeps,
      },
    );
    expect(graphError).toMatchObject({
      ok: false,
      stage: "graph",
      code: "graph_api_exception",
      error: "graph_down",
    });
  });

  it("fails closed when the Graph boundary returns undefined", async () => {
    graph.mockResolvedValue(undefined);

    await expect(send()).resolves.toMatchObject({
      ok: false,
      stage: "graph",
      code: "graph_api_invalid_response",
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("times out Bruna Graph delivery as unknown and keeps the dedupe claim", async () => {
    vi.useFakeTimers();
    try {
      graph.mockImplementation(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      dedupe.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const first = send({ graphTimeoutMs: 1_000 });
      await vi.waitFor(() => expect(graph).toHaveBeenCalledTimes(1));
      const signal = graph.mock.calls[0][0].signal as AbortSignal;
      expect(signal.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(first).resolves.toMatchObject({
        ok: false,
        stage: "graph",
        code: "graph_api_timeout",
      });
      expect(signal.aborted).toBe(true);
      expect(dedupe).toHaveBeenCalledTimes(1);
      expect(unlock).toHaveBeenCalledTimes(1);

      await expect(send({ graphTimeoutMs: 1_000 })).resolves.toMatchObject({
        ok: false,
        stage: "dedupe",
        code: "whatsapp_send_duplicate_prevented",
      });
      expect(graph).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("classifies an AbortError from the Graph boundary as unknown", async () => {
    graph.mockRejectedValue(new DOMException("aborted", "AbortError"));

    await expect(send({ graphTimeoutMs: 1_000 })).resolves.toMatchObject({
      ok: false,
      stage: "graph",
      code: "graph_api_aborted",
    });
    expect(dedupe).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it("uses 15s when the Bruna timeout environment value is empty", async () => {
    vi.useFakeTimers();
    const previous = process.env.BRUNA_WHATSAPP_GRAPH_TIMEOUT_MS;
    process.env.BRUNA_WHATSAPP_GRAPH_TIMEOUT_MS = "";
    try {
      graph.mockImplementation(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      );
      const pending = send();
      // Flush the request pipeline without advancing the fake clock. The
      // Graph call and its timeout must exist before the clock moves.
      for (let attempt = 0; attempt < 32 && graph.mock.calls.length === 0; attempt += 1) {
        await Promise.resolve();
      }
      expect(graph).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(graph.mock.calls[0][0].signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({
        code: "graph_api_timeout",
        error: "graph_request_timeout_after_15000ms",
      });
    } finally {
      process.env.BRUNA_WHATSAPP_GRAPH_TIMEOUT_MS = previous;
      vi.useRealTimers();
    }
  });

  it("renews periodically and releases the latest fenced lease", async () => {
    vi.useFakeTimers();
    try {
      graph.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        return simulatedOutbound("sim-renew");
      });
      const renewedLease = { ...lease, expiresAt: "2030-01-01T00:01:30.000Z" };
      const latestLease = { ...renewedLease, expiresAt: "2030-01-01T00:02:00.000Z" };
      renew
        .mockResolvedValueOnce({ ok: true, lease: renewedLease })
        .mockResolvedValueOnce({ ok: true, lease: latestLease });
      const pending = send();
      // Start Graph before advancing fake time so the renewal interval exists.
      await vi.waitFor(() => expect(graph).toHaveBeenCalledTimes(1));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(renew).toHaveBeenCalledTimes(1);
      expect(renew).toHaveBeenCalledWith({ lease, ttlSeconds: 30 });
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(pending).resolves.toMatchObject({ ok: true });
      expect(renew).toHaveBeenCalledTimes(2);
      expect(renew).toHaveBeenNthCalledWith(2, { lease: renewedLease, ttlSeconds: 30 });
      expect(unlock).toHaveBeenCalledWith(latestLease);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed and aborts Graph when the Bruna lease is lost", async () => {
    vi.useFakeTimers();
    try {
      graph.mockImplementation(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      );
      renew.mockResolvedValue({ ok: false, reason: "busy" });
      const pending = send();
      await vi.waitFor(() => expect(graph).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toMatchObject({
        ok: false,
        stage: "dedupe",
        code: "whatsapp_lease_lost",
      });
      expect(graph.mock.calls[0][0].signal.aborted).toBe(true);
      expect(unlock).toHaveBeenCalledWith(lease);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a renewal exception as lease loss without an unhandled rejection", async () => {
    vi.useFakeTimers();
    try {
      graph.mockImplementation(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      );
      renew.mockRejectedValueOnce(new Error("lease_store_down"));

      const pending = send();
      await vi.waitFor(() => expect(graph).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toMatchObject({
        ok: false,
        stage: "dedupe",
        code: "whatsapp_lease_lost",
      });
      expect(graph.mock.calls[0][0].signal.aborted).toBe(true);
      expect(unlock).toHaveBeenCalledWith(lease);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not abort a Graph response that settles at the timeout boundary", async () => {
    vi.useFakeTimers();
    try {
      graph.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(simulatedOutbound("sim-boundary")), 1_000),
          ),
      );
      const pending = send({ graphTimeoutMs: 1_000 });
      await vi.waitFor(() => expect(graph).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toMatchObject({
        ok: true,
        simulated: true,
        simulationId: "sim-boundary",
      });
      expect(graph.mock.calls[0][0].signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fall back to a generic lock when Bruna lease acquisition fails", async () => {
    lock.mockResolvedValue({ ok: false, reason: "unavailable" });
    await expect(send()).resolves.toMatchObject({
      ok: false,
      stage: "dedupe",
      code: "whatsapp_lease_unavailable",
    });
    expect(graph).not.toHaveBeenCalled();
    expect(renew).not.toHaveBeenCalled();
    expect(unlock).not.toHaveBeenCalled();
  });

  it("uses integration credentials and same-phone env token fallback", async () => {
    graph.mockResolvedValue(simulatedOutbound("sim-credentials"));
    const integrationResult = await sendBrunaWhatsappText(
      {
        companyId: "tenant-a",
        conversationId: "conversation-a",
        leadId: "lead-a",
        actionId: "action-a",
        source: "automatic",
        text: "Olá",
      },
      { sendGraph: graph, ...brunaLeaseDeps },
    );
    expect(integrationResult).toMatchObject({ ok: true, simulated: true });
    expect(graph.mock.calls[0][0].headers.Authorization).toBe("Bearer integration-token");

    rows.integration.access_token = null;
    const previousToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const previousPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.WHATSAPP_ACCESS_TOKEN = "same-phone-env-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-a";
    try {
      graph.mockClear();
      const fallbackResult = await sendBrunaWhatsappText(
        {
          companyId: "tenant-a",
          conversationId: "conversation-a",
          leadId: "lead-a",
          actionId: "action-a",
          source: "automatic",
          text: "Olá",
        },
        { sendGraph: graph, ...brunaLeaseDeps },
      );
      expect(fallbackResult).toMatchObject({ ok: true, simulated: true });
      expect(graph.mock.calls[0][0].headers.Authorization).toBe("Bearer same-phone-env-token");
    } finally {
      process.env.WHATSAPP_ACCESS_TOKEN = previousToken;
      process.env.WHATSAPP_PHONE_NUMBER_ID = previousPhone;
      rows.integration.access_token = "integration-token";
    }
  });

  it("does not use an env token for another phone number", async () => {
    rows.integration.access_token = null;
    rows.integration.external_account_id = "different-phone-number";
    const previousToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const previousPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.WHATSAPP_ACCESS_TOKEN = "wrong-phone-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-a";
    try {
      const result = await sendBrunaWhatsappText(
        {
          companyId: "tenant-a",
          conversationId: "conversation-a",
          leadId: "lead-a",
          actionId: "action-a",
          source: "automatic",
          text: "Olá",
        },
        { sendGraph: graph },
      );
      expect(result).toMatchObject({
        ok: false,
        stage: "context",
        code: "whatsapp_context_load_failed",
        error: "whatsapp_credentials_no_access_token",
      });
      expect(graph).not.toHaveBeenCalled();
    } finally {
      process.env.WHATSAPP_ACCESS_TOKEN = previousToken;
      process.env.WHATSAPP_PHONE_NUMBER_ID = previousPhone;
      rows.integration.access_token = "integration-token";
      rows.integration.external_account_id = "phone-number-a";
    }
  });

  it("persists only after a confirmed real send", async () => {
    graph.mockResolvedValue(deliveredOutbound("wamid-1"));
    const result = await send();
    expect(result).toEqual({ ok: true, simulated: false, externalId: "wamid-1" });
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "wamid-1", integrationId: "integration-a" }),
    );
    expect(attemptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "tenant-a",
        integrationId: "integration-a",
        idempotencyKey: "tenant-a\u0000conversation-a\u0000action-a",
      }),
    );
    expect(attemptClaim).toHaveBeenCalledWith("tenant-a", "attempt-a");
    expect(attemptAccept).toHaveBeenCalledWith("tenant-a", "attempt-a", "wamid-1");
    expect(attemptComplete).toHaveBeenCalledWith("tenant-a", "attempt-a", "wamid-1");
  });

  it("creates and claims the attempt before Graph, then only finalizes it", async () => {
    graph.mockImplementation(async () => {
      expect(attemptCreate).toHaveBeenCalledTimes(1);
      expect(attemptClaim).toHaveBeenCalledWith("tenant-a", "attempt-a");
      expect(attemptAccept).not.toHaveBeenCalled();
      return deliveredOutbound("wamid-order");
    });

    await expect(send()).resolves.toMatchObject({ ok: true, externalId: "wamid-order" });
    expect(attemptCreate).toHaveBeenCalledTimes(1);
    expect(attemptClaim).toHaveBeenCalledTimes(1);
    expect(attemptAccept).toHaveBeenCalledTimes(1);
    expect(attemptComplete).toHaveBeenCalledTimes(1);
  });

  it("does not call Graph when create persistence fails", async () => {
    attemptCreate.mockRejectedValue(new Error("attempt_insert_failed"));

    await expect(send()).resolves.toMatchObject({
      ok: false,
      stage: "persistence",
      code: "whatsapp_attempt_persistence_failed",
    });
    expect(attemptClaim).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
  });

  it("does not resend when claim finds an existing or uncertain attempt", async () => {
    attemptClaim.mockRejectedValue(new Error("attempt is not queued"));

    await expect(send()).resolves.toMatchObject({
      ok: false,
      stage: "persistence",
      code: "whatsapp_attempt_persistence_failed",
    });
    expect(attemptCreate).toHaveBeenCalledTimes(1);
    expect(attemptClaim).toHaveBeenCalledWith("tenant-a", "attempt-a");
    expect(graph).not.toHaveBeenCalled();
  });

  it("records an uncertain attempt after a Graph timeout without retrying", async () => {
    vi.useFakeTimers();
    try {
      graph.mockImplementation(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      );
      const pending = send({ graphTimeoutMs: 1_000 });
      await vi.waitFor(() => expect(graph).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toMatchObject({
        ok: false,
        stage: "graph",
        code: "graph_api_timeout",
      });
      expect(attemptCreate).toHaveBeenCalledTimes(1);
      expect(attemptClaim).toHaveBeenCalledWith("tenant-a", "attempt-a");
      expect(attemptUncertain).toHaveBeenCalledWith(
        "tenant-a",
        "attempt-a",
        "graph_request_timeout_after_1000ms",
      );
      expect(graph).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a provider rejection as failed, not uncertain", async () => {
    graph.mockResolvedValue(failedOutbound("invalid recipient"));

    await expect(send()).resolves.toMatchObject({
      ok: false,
      stage: "graph",
      code: "graph_api_failed",
    });
    expect(attemptFail).toHaveBeenCalledWith(
      "tenant-a",
      "attempt-a",
      "graph_http_400",
      "invalid recipient",
    );
    expect(attemptUncertain).not.toHaveBeenCalled();
  });

  it("never persists a simulation", async () => {
    graph.mockResolvedValue(simulatedOutbound());
    const result = await send();
    expect(result).toMatchObject({ ok: true, simulated: true });
    expect(persist).not.toHaveBeenCalled();
  });

  it("reports persistence failure without retrying the external send", async () => {
    graph.mockResolvedValue(deliveredOutbound("wamid-2"));
    persist.mockRejectedValue(new Error("messages_insert_failed"));
    const result = await send();
    expect(result).toMatchObject({
      ok: false,
      stage: "persistence",
      code: "whatsapp_persistence_failed_after_send",
    });
    expect(graph).toHaveBeenCalledTimes(1);
    expect(dedupe).toHaveBeenCalledTimes(1);
  });

  it("requires a caller-provided actionId", async () => {
    const result = await sendBrunaWhatsappText(
      {
        companyId: "tenant-a",
        conversationId: "conversation-a",
        leadId: "lead-a",
        actionId: "   ",
        source: "automatic",
        text: "same text",
      },
      { sendGraph: graph },
    );
    expect(result).toMatchObject({
      ok: false,
      stage: "dedupe",
      code: "whatsapp_send_action_id_required",
    });
    expect(graph).not.toHaveBeenCalled();
  });

  it("blocks a retry with the same actionId", async () => {
    graph.mockResolvedValue(deliveredOutbound("wamid-action-a"));
    dedupe.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(send()).resolves.toMatchObject({ ok: true });
    await expect(send()).resolves.toMatchObject({
      ok: false,
      stage: "dedupe",
      code: "whatsapp_send_duplicate_prevented",
    });
    expect(graph).toHaveBeenCalledTimes(1);
    expect(dedupe).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ resourceKey: "tenant-a\u0000conversation-a\u0000action-a" }),
    );
  });

  it("allows identical text for different actionIds", async () => {
    graph
      .mockResolvedValueOnce(deliveredOutbound("wamid-a"))
      .mockResolvedValueOnce(deliveredOutbound("wamid-b"));
    dedupe.mockResolvedValue(true);

    await expect(send({ actionId: "action-a" })).resolves.toMatchObject({ ok: true });
    await expect(send({ actionId: "action-b" })).resolves.toMatchObject({ ok: true });
    expect(graph).toHaveBeenCalledTimes(2);
    expect(dedupe.mock.calls.map(([call]) => call.resourceKey)).toEqual([
      "tenant-a\u0000conversation-a\u0000action-a",
      "tenant-a\u0000conversation-a\u0000action-b",
    ]);
  });

  it("isolates the dedupe key between companies", async () => {
    graph
      .mockResolvedValueOnce(deliveredOutbound("wamid-a"))
      .mockResolvedValueOnce(deliveredOutbound("wamid-b"));
    const claimed = new Set<string>();
    dedupe.mockImplementation(async ({ companyId, resourceKey }) => {
      const key = `${companyId}\u0000${resourceKey}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    });
    const leaseB: BrunaLease = {
      ...lease,
      companyId: "tenant-b",
      leaseKey: "bruna-whatsapp-text:tenant-b:conversation-a",
      ownerId: "owner-b",
    };
    lock.mockImplementation(async ({ companyId, leaseKey, ownerId }) => ({
      ok: true,
      lease: {
        ...(companyId === "tenant-b" ? leaseB : lease),
        companyId,
        leaseKey,
        ownerId,
      },
    }));
    validate.mockImplementation(async (currentLease: BrunaLease) => ({
      ok: true,
      valid: true,
      expiresAt: currentLease.expiresAt,
      fenceToken: currentLease.fenceToken,
    }));
    const authorize = vi.fn(
      async (request: {
        companyId: string;
        conversationId: string;
        leadId: string;
        source: "human" | "automatic" | "followup" | "campaign" | "handoff_notice";
      }) =>
        ({
          ...authorization,
          ...request,
        }) as unknown as WhatsappSendAuthorization,
    );

    await expect(
      sendBrunaWhatsappText(
        {
          companyId: "tenant-a",
          conversationId: "conversation-a",
          leadId: "lead-a",
          actionId: "same-action",
          source: "automatic",
          text: "same text",
        },
        {
          authorize,
          loadContext: async () => context,
          sendGraph: graph,
          ...brunaLeaseDeps,
          persist,
        },
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      sendBrunaWhatsappText(
        {
          companyId: "tenant-b",
          conversationId: "conversation-a",
          leadId: "lead-a",
          actionId: "same-action",
          source: "automatic",
          text: "same text",
        },
        {
          authorize,
          loadContext: async () => context,
          sendGraph: graph,
          tryDedupe: dedupe,
          acquireLease: lock,
          renewLease: renew,
          validateLease: validate,
          releaseLease: unlock,
          attempt,
          persist,
        },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(dedupe.mock.calls.map(([call]) => call.resourceKey)).toEqual([
      "tenant-a\u0000conversation-a\u0000same-action",
      "tenant-b\u0000conversation-a\u0000same-action",
    ]);
    expect(dedupe.mock.calls.map(([call]) => call.companyId)).toEqual(["tenant-a", "tenant-b"]);
    expect(lock.mock.calls.map(([call]) => call.companyId)).toEqual(["tenant-a", "tenant-b"]);
    expect(lock.mock.calls.map(([call]) => call.leaseKey)).toEqual([
      "bruna-whatsapp-text:tenant-a:conversation-a",
      "bruna-whatsapp-text:tenant-b:conversation-a",
    ]);
    expect(authorize.mock.calls.map(([call]) => call.companyId)).toEqual([
      "tenant-a",
      "tenant-a",
      "tenant-b",
      "tenant-b",
    ]);
    expect(authorize.mock.calls).toEqual([
      [
        {
          companyId: "tenant-a",
          conversationId: "conversation-a",
          leadId: "lead-a",
          source: "automatic",
        },
      ],
      [
        {
          companyId: "tenant-a",
          conversationId: "conversation-a",
          leadId: "lead-a",
          source: "automatic",
        },
      ],
      [
        {
          companyId: "tenant-b",
          conversationId: "conversation-a",
          leadId: "lead-a",
          source: "automatic",
        },
      ],
      [
        {
          companyId: "tenant-b",
          conversationId: "conversation-a",
          leadId: "lead-a",
          source: "automatic",
        },
      ],
    ]);
    expect(validate.mock.calls.map(([currentLease]) => currentLease.companyId)).toEqual([
      "tenant-a",
      "tenant-b",
    ]);
    expect(validate.mock.calls.map(([currentLease]) => currentLease.leaseKey)).toEqual([
      "bruna-whatsapp-text:tenant-a:conversation-a",
      "bruna-whatsapp-text:tenant-b:conversation-a",
    ]);
  });

  it("does not resend after Graph failure for the same actionId", async () => {
    graph.mockResolvedValueOnce(failedOutbound());
    dedupe.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(send()).resolves.toMatchObject({ ok: false, stage: "graph" });
    await expect(send()).resolves.toMatchObject({
      ok: false,
      stage: "dedupe",
      code: "whatsapp_send_duplicate_prevented",
    });
    expect(graph).toHaveBeenCalledTimes(1);
  });

  it("allows only one concurrent external send", async () => {
    let releaseFirst!: () => void;
    const firstInGraph = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    graph.mockImplementationOnce(async () => {
      await firstInGraph;
      return deliveredOutbound("wamid-concurrent");
    });
    let locked = false;
    lock.mockImplementation(async () => {
      if (locked) return { ok: false, reason: "busy" };
      locked = true;
      return { ok: true, lease };
    });

    const first = send();
    await vi.waitFor(() => expect(graph).toHaveBeenCalledTimes(1));
    const second = send();
    await expect(second).resolves.toMatchObject({
      ok: false,
      stage: "dedupe",
      code: "whatsapp_send_concurrent_or_locked",
    });
    releaseFirst();
    await expect(first).resolves.toMatchObject({ ok: true, simulated: false });
    expect(graph).toHaveBeenCalledTimes(1);
  });

  it("uses distinct UUID owners for concurrent executions with the same actionId", async () => {
    let releaseFirst!: () => void;
    const firstInGraph = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const owners: string[] = [];
    let locked = false;
    lock.mockImplementation(async ({ ownerId }: { ownerId: string }) => {
      owners.push(ownerId);
      if (locked) return { ok: false, reason: "busy" };
      locked = true;
      return { ok: true, lease: { ...lease, ownerId } };
    });
    unlock.mockImplementation(async (releasedLease: typeof lease) => {
      expect(releasedLease.leaseKey).toBe("bruna-whatsapp-text:tenant-a:conversation-a");
      expect(releasedLease.ownerId).toBe(owners[0]);
    });
    graph.mockImplementationOnce(async () => {
      await firstInGraph;
      return deliveredOutbound("wamid-same-action");
    });

    const first = send({ actionId: "same-action" });
    await vi.waitFor(() => expect(graph).toHaveBeenCalledTimes(1));
    const second = send({ actionId: "same-action" });
    await expect(second).resolves.toMatchObject({
      ok: false,
      stage: "dedupe",
      code: "whatsapp_send_concurrent_or_locked",
    });
    expect(owners).toHaveLength(2);
    expect(owners[0]).not.toBe(owners[1]);
    expect(owners[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(owners[1]).toMatch(/^[0-9a-f-]{36}$/);

    releaseFirst();
    await expect(first).resolves.toMatchObject({ ok: true, simulated: false });
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseKey: "bruna-whatsapp-text:tenant-a:conversation-a",
        ownerId: owners[0],
      }),
    );
  });
});
