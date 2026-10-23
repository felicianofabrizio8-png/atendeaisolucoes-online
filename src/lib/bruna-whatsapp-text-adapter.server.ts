import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { postGraph, type PostGraphInput } from "./outbound/MetaOutbound.server";
import type { OutboundResult } from "./outbound/MetaOutboundContract";
import { tryDedupe } from "./runtime/RuntimeStateStore.server";
import {
  acquireBrunaLease,
  releaseBrunaLease,
  renewBrunaLease,
  validateBrunaLease,
} from "./bruna/bruna-lease.server";
import { resolveWhatsappSendCredentials } from "./whatsapp/send-credentials";
import {
  authorizeWhatsappSend,
  type WhatsappSendAuthorization,
} from "./whatsapp-send-authorization.server";

export type BrunaWhatsappTextInput = {
  companyId: string;
  conversationId: string;
  leadId: string;
  /** Stable id supplied by the caller for one Bruna action. */
  actionId: string;
  text: string;
  source: "automatic";
};

type SendContext = {
  accessToken: string;
  phoneNumberId: string;
  recipient: string;
};

const BRUNA_GRAPH_TIMEOUT_ENV = "BRUNA_WHATSAPP_GRAPH_TIMEOUT_MS";
const DEFAULT_BRUNA_GRAPH_TIMEOUT_MS = 15_000;
const MIN_BRUNA_GRAPH_TIMEOUT_MS = 1_000;
const MAX_BRUNA_GRAPH_TIMEOUT_MS = 30_000;
const BRUNA_LEASE_TTL_SECONDS = 30;
const BRUNA_LEASE_RENEW_INTERVAL_MS = 10_000;

export type BrunaWhatsappTextResult =
  | {
      ok: true;
      simulated: false;
      externalId: string | null;
    }
  | {
      ok: true;
      simulated: true;
      externalId: null;
      simulationId: string | null;
      externalRequestSent: false;
    }
  | {
      ok: false;
      stage: "authorization" | "context" | "dedupe" | "graph" | "persistence";
      code: string;
      error?: string;
    };

export type BrunaWhatsappTextAdapterDeps = {
  authorize?: typeof authorizeWhatsappSend;
  loadContext?: (authorization: WhatsappSendAuthorization) => Promise<SendContext | null>;
  sendGraph?: <TRaw = unknown>(input: PostGraphInput) => Promise<OutboundResult<TRaw>>;
  /** Override local-only timeout in tests; production reads BRUNA_WHATSAPP_GRAPH_TIMEOUT_MS. */
  graphTimeoutMs?: number;
  acquireLease?: typeof acquireBrunaLease;
  renewLease?: typeof renewBrunaLease;
  validateLease?: typeof validateBrunaLease;
  releaseLease?: typeof releaseBrunaLease;
  leaseTtlSeconds?: number;
  leaseRenewIntervalMs?: number;
  tryDedupe?: typeof tryDedupe;
  persist?: (input: {
    companyId: string;
    conversationId: string;
    integrationId: string;
    text: string;
    actionId: string;
    externalId: string | null;
    sentAt: string;
  }) => Promise<void>;
  attempt?: Partial<BrunaWhatsappAttemptPersistence>;
};

type BrunaWhatsappAttemptInput = {
  companyId: string;
  integrationId: string;
  conversationId: string;
  leadId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  payload: Record<string, unknown>;
};

type BrunaWhatsappAttemptPersistence = {
  create: (input: BrunaWhatsappAttemptInput) => Promise<{ id: string }>;
  claim: (companyId: string, attemptId: string) => Promise<void>;
  accept: (companyId: string, attemptId: string, providerMessageId: string | null) => Promise<void>;
  complete: (
    companyId: string,
    attemptId: string,
    providerMessageId: string | null,
  ) => Promise<void>;
  fail: (
    companyId: string,
    attemptId: string,
    errorCode: string,
    errorMessage: string,
  ) => Promise<void>;
  uncertain: (companyId: string, attemptId: string, reason: string) => Promise<void>;
};

/**
 * Isolated bridge for the future Bruna -> WhatsApp text integration.
 *
 * This module is deliberately not imported by ai-agent.server.ts or any route.
 * Authorization is mandatory and happens before credentials, Graph API, or any
 * delivery side effect. A simulated outbound result is preserved as simulated.
 */
export async function sendBrunaWhatsappText(
  input: BrunaWhatsappTextInput,
  deps: BrunaWhatsappTextAdapterDeps = {},
): Promise<BrunaWhatsappTextResult> {
  if (input.source !== "automatic") {
    return {
      ok: false,
      stage: "authorization",
      code: "whatsapp_send_source_not_allowed",
      error: "bruna_whatsapp_text_requires_automatic_source",
    };
  }
  if (!input.actionId.trim()) {
    return {
      ok: false,
      stage: "dedupe",
      code: "whatsapp_send_action_id_required",
      error: "bruna_whatsapp_text_requires_caller_action_id",
    };
  }

  let authorization: WhatsappSendAuthorization;
  try {
    authorization = await (deps.authorize ?? authorizeWhatsappSend)({
      companyId: input.companyId,
      conversationId: input.conversationId,
      leadId: input.leadId,
      source: input.source,
    });
  } catch (error) {
    return {
      ok: false,
      stage: "authorization",
      code: "whatsapp_send_not_authorized",
      error: error instanceof Error ? error.message : "authorization_failed",
    };
  }

  let context: SendContext | null;
  try {
    context = await (deps.loadContext ?? loadDefaultContext)(authorization);
  } catch (error) {
    return {
      ok: false,
      stage: "context",
      code: "whatsapp_context_load_failed",
      error: error instanceof Error ? error.message : "context_load_failed",
    };
  }
  if (!context) {
    return { ok: false, stage: "context", code: "whatsapp_not_connected" };
  }

  // The caller owns action identity. The dedupe claim is kept even when Graph or
  // persistence fails, so a later call cannot resend a message whose provider
  // outcome is already unknown to us.
  // Keep the tenant in the serialized key as a defense in depth. The runtime
  // RPC also receives companyId and the database index is tenant-scoped, but
  // older deployments may still have a global runtime_dedupe index.
  const requestKey = buildRequestKey(input);
  const leaseKey = `bruna-whatsapp-text:${input.companyId}:${input.conversationId}`;
  // actionId is stable for dedupe/audit only. Each invocation gets an exclusive
  // owner so a late finally cannot release a later fenced lease.
  const ownerId = globalThis.crypto.randomUUID();
  const leaseTtlSeconds = deps.leaseTtlSeconds ?? BRUNA_LEASE_TTL_SECONDS;
  const acquired = await (deps.acquireLease ?? acquireBrunaLease)({
    leaseKey,
    ownerId,
    ttlSeconds: leaseTtlSeconds,
    companyId: input.companyId,
  });
  if (!acquired.ok) {
    return {
      ok: false,
      stage: "dedupe",
      code:
        acquired.reason === "busy"
          ? "whatsapp_send_concurrent_or_locked"
          : "whatsapp_lease_unavailable",
    };
  }

  let lease = acquired.lease;
  let leaseLost = false;
  let abortInFlight: (() => void) | undefined;
  let renewInFlight: Promise<void> | undefined;
  const markLeaseLost = () => {
    leaseLost = true;
    abortInFlight?.();
  };
  const renew = async () => {
    if (leaseLost) return;
    const result = await (deps.renewLease ?? renewBrunaLease)({
      lease,
      ttlSeconds: leaseTtlSeconds,
    });
    if (result.ok) {
      lease = result.lease;
    } else {
      markLeaseLost();
    }
  };
  const renewTimer: ReturnType<typeof setInterval> = setInterval(() => {
    if (!renewInFlight) {
      // A renewal outage is a lease loss.  The interval callback must consume
      // that rejection: an unhandled rejection here could otherwise terminate
      // the request before its finally block releases the fenced lease.
      renewInFlight = renew()
        .catch(() => {
          markLeaseLost();
        })
        .finally(() => {
          renewInFlight = undefined;
        });
    }
  }, deps.leaseRenewIntervalMs ?? BRUNA_LEASE_RENEW_INTERVAL_MS);
  let dedupeClaimed = false;
  let graphStarted = false;
  try {
    dedupeClaimed = await (deps.tryDedupe ?? tryDedupe)({
      operation: "bruna-whatsapp-text",
      resourceKey: requestKey,
      bucket: 0,
      ttlSeconds: 24 * 60 * 60,
      companyId: input.companyId,
    });
    if (leaseLost) {
      return { ok: false, stage: "dedupe", code: "whatsapp_lease_lost" };
    }
    if (!dedupeClaimed) {
      return { ok: false, stage: "dedupe", code: "whatsapp_send_duplicate_prevented" };
    }

    // Re-check immediately before entering the only Graph side-effect boundary.
    // This closes the authorization -> takeover race during context loading.
    try {
      authorization = await (deps.authorize ?? authorizeWhatsappSend)({
        companyId: input.companyId,
        conversationId: input.conversationId,
        leadId: input.leadId,
        source: "automatic",
      });
    } catch (error) {
      return {
        ok: false,
        stage: "authorization",
        code: "whatsapp_send_not_authorized",
        error: error instanceof Error ? error.message : "authorization_failed",
      };
    }
    if (leaseLost) {
      return { ok: false, stage: "dedupe", code: "whatsapp_lease_lost" };
    }

    const payload = {
      messaging_product: "whatsapp",
      to: context.recipient,
      type: "text" as const,
      text: { body: input.text },
    };

    // This is the final lease fence immediately before the only external
    // side-effect boundary. Validate the current lease (and therefore its
    // current fence token) after all preparation is complete. Any inability
    // to prove ownership is a hard stop: never send to Graph.
    const leaseBeingValidated = lease;
    let leaseCheck;
    try {
      leaseCheck = await (deps.validateLease ?? validateBrunaLease)(leaseBeingValidated);
    } catch (error) {
      if (leaseLost) {
        return { ok: false, stage: "dedupe", code: "whatsapp_lease_lost" };
      }
      return {
        ok: false,
        stage: "dedupe",
        code: "whatsapp_lease_validation_failed",
        error: error instanceof Error ? error.message : "whatsapp_lease_validation_failed",
      };
    }
    if (leaseLost) {
      return { ok: false, stage: "dedupe", code: "whatsapp_lease_lost" };
    }
    if (!leaseCheck.ok) {
      return {
        ok: false,
        stage: "dedupe",
        code:
          leaseCheck.reason === "invalid" ? "whatsapp_lease_invalid" : "whatsapp_lease_unavailable",
      };
    }
    if (!leaseCheck.valid) {
      return { ok: false, stage: "dedupe", code: "whatsapp_lease_expired" };
    }
    if (
      leaseCheck.fenceToken !== leaseBeingValidated.fenceToken ||
      lease.fenceToken !== leaseBeingValidated.fenceToken ||
      !Number.isFinite(Date.parse(leaseCheck.expiresAt)) ||
      Date.parse(leaseCheck.expiresAt) <= Date.now()
    ) {
      return { ok: false, stage: "dedupe", code: "whatsapp_lease_lost" };
    }

    // The attempt is the durable send authorization. It must be created and
    // claimed before crossing the Graph side-effect boundary. Because the RPC
    // create is idempotent and claim only accepts `queued`, an existing or
    // uncertain attempt cannot authorize another provider call.
    const attemptContext: AttemptContext = {
      input,
      authorization,
      context,
      requestKey,
      payload,
      deps: deps.attempt,
    };
    const claimedAttempt = await createAndClaimAttempt(attemptContext);
    if (!claimedAttempt.ok) return claimedAttempt.result;

    let outbound: OutboundResult | undefined;
    try {
      const controller = new AbortController();
      abortInFlight = () => controller.abort();
      if (leaseLost) return { ok: false, stage: "dedupe", code: "whatsapp_lease_lost" };
      graphStarted = true;
      const timeoutMs = resolveBrunaGraphTimeoutMs(deps.graphTimeoutMs);
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        outbound = await new Promise<OutboundResult>((resolve, reject) => {
          let settled = false;
          let graphPromise: Promise<OutboundResult>;
          try {
            // Invoke Graph before arming the timer.  Deferring this call to a
            // microtask would queue the timeout first and could time out a
            // response that settles exactly at the configured boundary.
            graphPromise = Promise.resolve(
              (deps.sendGraph ?? postGraph)({
                companyId: authorization.companyId,
                action: "whatsapp.send.text.bruna",
                url: `https://graph.facebook.com/v20.0/${context.phoneNumberId}/messages`,
                method: "POST",
                headers: {
                  Authorization: `Bearer ${context.accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
                logicalPayload: payload,
                agentId: "bruna",
                signal: controller.signal,
                extractExternalId: (value) =>
                  (value as { messages?: Array<{ id?: string }> } | null)?.messages?.[0]?.id ??
                  null,
              }),
            );
          } catch (error) {
            settled = true;
            reject(error);
            return;
          }
          timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new BrunaGraphTimeoutError(timeoutMs));
            controller.abort();
          }, timeoutMs);
          void graphPromise.then(
            (value) => {
              if (settled) return;
              settled = true;
              resolve(value);
            },
            (error: unknown) => {
              if (settled) return;
              settled = true;
              reject(error);
            },
          );
        });
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    } catch (error) {
      if (leaseLost) {
        if (graphStarted) {
          const attemptResult = await finalizeUncertainAttempt({
            ...attemptContext,
            attemptId: claimedAttempt.attemptId,
            reason: "bruna_lease_lost_during_graph_request",
          });
          if (!attemptResult.ok) return attemptResult;
        }
        return { ok: false, stage: "dedupe", code: "whatsapp_lease_lost" };
      }
      if (error instanceof BrunaGraphTimeoutError) {
        const attemptResult = await finalizeUncertainAttempt({
          ...attemptContext,
          attemptId: claimedAttempt.attemptId,
          reason: error.message,
        });
        if (!attemptResult.ok) return attemptResult;
        return { ok: false, stage: "graph", code: "graph_api_timeout", error: error.message };
      }
      if (isAbortError(error)) {
        const message = error instanceof Error ? error.message : "graph_api_aborted";
        const attemptResult = await finalizeUncertainAttempt({
          ...attemptContext,
          attemptId: claimedAttempt.attemptId,
          reason: message,
        });
        if (!attemptResult.ok) return attemptResult;
        return { ok: false, stage: "graph", code: "graph_api_aborted", error: message };
      }
      const message = error instanceof Error ? error.message : "graph_api_exception";
      const attemptResult = await finalizeUncertainAttempt({
        ...attemptContext,
        attemptId: claimedAttempt.attemptId,
        reason: message,
      });
      if (!attemptResult.ok) return attemptResult;
      return { ok: false, stage: "graph", code: "graph_api_exception", error: message };
    }

    abortInFlight = undefined;
    if (leaseLost) {
      const attemptResult = await finalizeUncertainAttempt({
        ...attemptContext,
        attemptId: claimedAttempt.attemptId,
        reason: "bruna_lease_lost_after_graph_request",
      });
      if (!attemptResult.ok) return attemptResult;
      return { ok: false, stage: "dedupe", code: "whatsapp_lease_lost" };
    }

    // A custom outbound boundary is untrusted input just like the real Graph
    // adapter.  An undefined/malformed result is not a successful delivery and
    // must never reach persistence or throw while inspecting `success`.
    if (!isOutboundResult(outbound)) {
      const attemptResult = await finalizeUncertainAttempt({
        ...attemptContext,
        attemptId: claimedAttempt.attemptId,
        reason: "graph_api_returned_invalid_result",
      });
      if (!attemptResult.ok) return attemptResult;
      return {
        ok: false,
        stage: "graph",
        code: "graph_api_invalid_response",
        error: "graph_api_returned_invalid_result",
      };
    }

    if (!outbound.success && isAbortErrorMessage(outbound.error)) {
      const attemptResult = await finalizeUncertainAttempt({
        ...attemptContext,
        attemptId: claimedAttempt.attemptId,
        reason: outbound.error,
      });
      if (!attemptResult.ok) return attemptResult;
      return {
        ok: false,
        stage: "graph",
        code: "graph_api_aborted",
        error: outbound.error,
      };
    }

    if (outbound.success && outbound.simulated) {
      const attemptResult = await finalizeFailedAttempt({
        ...attemptContext,
        attemptId: claimedAttempt.attemptId,
        errorCode: "simulated",
        errorMessage: "whatsapp_graph_simulated",
      });
      if (!attemptResult.ok) return attemptResult;
      return {
        ok: true,
        simulated: true,
        externalId: null,
        simulationId: outbound.simulationId,
        externalRequestSent: false,
      };
    }
    if (!outbound.success) {
      const attemptResult = outbound.externalRequestSent
        ? await finalizeFailedAttempt({
            ...attemptContext,
            attemptId: claimedAttempt.attemptId,
            errorCode: `graph_http_${outbound.status ?? "unknown"}`,
            errorMessage: outbound.error,
          })
        : await finalizeUncertainAttempt({
            ...attemptContext,
            attemptId: claimedAttempt.attemptId,
            reason: outbound.error,
          });
      if (!attemptResult.ok) return attemptResult;
      return {
        ok: false,
        stage: "graph",
        code: "graph_api_failed",
        error: outbound.error,
      };
    }

    try {
      const attemptResult = await finalizeDeliveredAttempt({
        ...attemptContext,
        attemptId: claimedAttempt.attemptId,
        providerMessageId: outbound.externalId,
      });
      if (!attemptResult.ok) return attemptResult;
      await (deps.persist ?? persistBrunaMessage)({
        companyId: input.companyId,
        conversationId: input.conversationId,
        integrationId: authorization.integrationId,
        text: input.text,
        actionId: input.actionId,
        externalId: outbound.externalId,
        sentAt: new Date().toISOString(),
      });
    } catch (error) {
      return {
        ok: false,
        stage: "persistence",
        code: "whatsapp_persistence_failed_after_send",
        error: error instanceof Error ? error.message : "whatsapp_persistence_failed",
      };
    }
    return { ok: true, simulated: false, externalId: outbound.externalId };
  } finally {
    if (renewTimer !== undefined) clearInterval(renewTimer);
    try {
      await renewInFlight;
    } catch {
      // Defensive: the scheduled renewal already converts failures to lease
      // loss, but cleanup must remain non-rejecting if a custom dependency
      // violates that contract.
      markLeaseLost();
    }
    try {
      // `renewInFlight` is awaited before reading `lease`, so release always
      // carries the newest fence token returned by a completed renewal.
      await (deps.releaseLease ?? releaseBrunaLease)(lease);
    } catch {
      // Release is best effort; the fenced RPC/TTL remains the safety net.
    }
  }
}

class BrunaGraphTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`graph_request_timeout_after_${timeoutMs}ms`);
    this.name = "BrunaGraphTimeoutError";
  }
}

type AttemptOperationResult =
  | { ok: true }
  | { ok: false; stage: "persistence"; code: string; error: string };
type AttemptFailure = Exclude<AttemptOperationResult, { ok: true }>;

type AttemptContext = {
  input: BrunaWhatsappTextInput;
  authorization: WhatsappSendAuthorization;
  context: SendContext;
  requestKey: string;
  payload: Record<string, unknown>;
  deps?: Partial<BrunaWhatsappAttemptPersistence>;
};

function attemptInput(args: AttemptContext): BrunaWhatsappAttemptInput {
  return {
    companyId: args.input.companyId,
    integrationId: args.authorization.integrationId,
    conversationId: args.input.conversationId,
    leadId: args.input.leadId,
    idempotencyKey: args.requestKey,
    requestFingerprint: JSON.stringify({
      integrationId: args.authorization.integrationId,
      recipient: args.context.recipient,
      text: args.input.text,
    }),
    payload: args.payload,
  };
}

async function createAndClaimAttempt(
  args: AttemptContext,
): Promise<{ ok: true; attemptId: string } | { ok: false; result: AttemptFailure }> {
  try {
    const attempt = await (args.deps?.create ?? createWhatsappSendAttempt)(attemptInput(args));
    await (args.deps?.claim ?? claimWhatsappSendAttempt)(args.input.companyId, attempt.id);
    return { ok: true, attemptId: attempt.id };
  } catch (error) {
    return {
      ok: false,
      result: attemptPersistenceFailure(error),
    };
  }
}

async function finalizeUncertainAttempt(
  args: AttemptContext & { attemptId: string; reason: string },
): Promise<AttemptOperationResult> {
  try {
    await (args.deps?.uncertain ?? markWhatsappSendAttemptUncertain)(
      args.input.companyId,
      args.attemptId,
      args.reason,
    );
    return { ok: true };
  } catch (error) {
    return attemptPersistenceFailure(error);
  }
}

async function finalizeFailedAttempt(
  args: AttemptContext & { attemptId: string; errorCode: string; errorMessage: string },
): Promise<AttemptOperationResult> {
  try {
    await (args.deps?.fail ?? failWhatsappSendAttempt)(
      args.input.companyId,
      args.attemptId,
      args.errorCode,
      args.errorMessage,
    );
    return { ok: true };
  } catch (error) {
    return attemptPersistenceFailure(error);
  }
}

async function finalizeDeliveredAttempt(
  args: AttemptContext & { attemptId: string; providerMessageId: string | null },
): Promise<AttemptOperationResult> {
  try {
    await (args.deps?.accept ?? acceptWhatsappSendAttempt)(
      args.input.companyId,
      args.attemptId,
      args.providerMessageId,
    );
    await (args.deps?.complete ?? completeWhatsappSendAttempt)(
      args.input.companyId,
      args.attemptId,
      args.providerMessageId,
    );
    return { ok: true };
  } catch (error) {
    return attemptPersistenceFailure(error);
  }
}

function attemptPersistenceFailure(error: unknown): AttemptFailure {
  return {
    ok: false,
    stage: "persistence",
    code: "whatsapp_attempt_persistence_failed",
    error: error instanceof Error ? error.message : "whatsapp_attempt_persistence_failed",
  };
}

type SupabaseRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

function attemptsRpcClient(): SupabaseRpcClient {
  return supabaseAdmin as unknown as SupabaseRpcClient;
}

function rpcRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

async function createWhatsappSendAttempt(
  input: BrunaWhatsappAttemptInput,
): Promise<{ id: string }> {
  const result = await attemptsRpcClient().rpc("create_whatsapp_send_attempt", {
    p_company_id: input.companyId,
    p_integration_id: input.integrationId,
    p_conversation_id: input.conversationId,
    p_lead_id: input.leadId,
    p_idempotency_key: input.idempotencyKey,
    p_request_fingerprint: input.requestFingerprint,
    p_payload: input.payload,
  });
  if (result.error) throw result.error;
  const id = rpcRow(result.data)?.id;
  if (typeof id !== "string" || !id) throw new Error("whatsapp_attempt_create_invalid_response");
  return { id };
}

async function callAttemptRpc(name: string, args: Record<string, unknown>): Promise<void> {
  const result = await attemptsRpcClient().rpc(name, args);
  if (result.error) throw result.error;
}

function claimWhatsappSendAttempt(companyId: string, attemptId: string): Promise<void> {
  return callAttemptRpc("claim_whatsapp_send_attempt", {
    p_company_id: companyId,
    p_attempt_id: attemptId,
  });
}

function acceptWhatsappSendAttempt(
  companyId: string,
  attemptId: string,
  providerMessageId: string | null,
): Promise<void> {
  return callAttemptRpc("accept_whatsapp_send_attempt", {
    p_company_id: companyId,
    p_attempt_id: attemptId,
    p_provider_message_id: providerMessageId,
  });
}

function completeWhatsappSendAttempt(
  companyId: string,
  attemptId: string,
  providerMessageId: string | null,
): Promise<void> {
  return callAttemptRpc("complete_whatsapp_send_attempt", {
    p_company_id: companyId,
    p_attempt_id: attemptId,
    p_provider_message_id: providerMessageId,
  });
}

function failWhatsappSendAttempt(
  companyId: string,
  attemptId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  return callAttemptRpc("fail_whatsapp_send_attempt", {
    p_company_id: companyId,
    p_attempt_id: attemptId,
    p_error_code: errorCode,
    p_error_message: errorMessage,
  });
}

function markWhatsappSendAttemptUncertain(
  companyId: string,
  attemptId: string,
  reason: string,
): Promise<void> {
  return callAttemptRpc("mark_whatsapp_send_attempt_uncertain", {
    p_company_id: companyId,
    p_attempt_id: attemptId,
    p_reason: reason,
  });
}

function resolveBrunaGraphTimeoutMs(override?: number): number {
  const raw = process.env[BRUNA_GRAPH_TIMEOUT_ENV]?.trim();
  const configured = override ?? (raw ? Number(raw) : undefined);
  const value =
    typeof configured === "number" && Number.isFinite(configured)
      ? configured
      : DEFAULT_BRUNA_GRAPH_TIMEOUT_MS;
  return Math.min(
    MAX_BRUNA_GRAPH_TIMEOUT_MS,
    Math.max(MIN_BRUNA_GRAPH_TIMEOUT_MS, Math.floor(value)),
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && (error.name === "AbortError" || isAbortErrorMessage(error.message));
}

function isAbortErrorMessage(message: string): boolean {
  return /abort|cancel/i.test(message);
}

function isOutboundResult(value: unknown): value is OutboundResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  if (typeof result.success !== "boolean") return false;
  if (result.success) {
    if (result.simulated === true) {
      return (
        (result.environment === "staging" || result.environment === "unknown") &&
        result.externalRequestSent === false &&
        (typeof result.simulationId === "string" || result.simulationId === null) &&
        typeof (result.would as Record<string, unknown> | undefined)?.url === "string" &&
        typeof (result.would as Record<string, unknown> | undefined)?.method === "string"
      );
    }
    return (
      result.simulated === false &&
      result.externalRequestSent === true &&
      (result.environment === "production" || result.environment === "legacy") &&
      (typeof result.externalId === "string" || result.externalId === null) &&
      typeof result.status === "number" &&
      Number.isFinite(result.status) &&
      typeof result.raw !== "undefined"
    );
  }
  return (
    result.simulated === false &&
    (result.environment === "production" ||
      result.environment === "legacy" ||
      result.environment === "staging" ||
      result.environment === "unknown") &&
    typeof result.externalRequestSent === "boolean" &&
    typeof result.error === "string" &&
    typeof result.retryable === "boolean" &&
    (result.status === undefined ||
      (typeof result.status === "number" && Number.isFinite(result.status))) &&
    (result.externalRequestSent
      ? typeof result.rawBody === "string" && "parsedBody" in result
      : result.rawBody === undefined && result.parsedBody === undefined)
  );
}

function buildRequestKey(input: BrunaWhatsappTextInput): string {
  return [input.companyId, input.conversationId, input.actionId]
    .map((part) => part.trim())
    .join("\u0000");
}

async function persistBrunaMessage(input: {
  companyId: string;
  conversationId: string;
  integrationId: string;
  text: string;
  actionId: string;
  externalId: string | null;
  sentAt: string;
}): Promise<void> {
  const message = await supabaseAdmin.from("messages").insert({
    company_id: input.companyId,
    conversation_id: input.conversationId,
    role: "agent",
    text: input.text,
    at: input.sentAt,
    external_id: input.externalId,
    integration_id: input.integrationId,
    // Keep the same message source contract as sendWhatsappText; Bruna's
    // identity is carried in metadata and does not create a new source enum.
    source: "ai_agent",
    source_metadata: {
      agent_id: "bruna",
      adapter: "bruna-whatsapp-text",
      action_id: input.actionId,
    },
  });
  if (message.error) throw message.error;

  const conversation = await supabaseAdmin
    .from("conversations")
    .update({ last_message_at: input.sentAt, awaiting_reply: false })
    .eq("id", input.conversationId)
    .eq("company_id", input.companyId);
  if (conversation.error) throw conversation.error;
}

async function loadDefaultContext(
  authorization: WhatsappSendAuthorization,
): Promise<SendContext | null> {
  const [{ data: lead }, { data: integration }] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select("phone, external_id")
      .eq("id", authorization.leadId)
      .eq("company_id", authorization.companyId)
      .maybeSingle(),
    supabaseAdmin
      .from("integrations")
      .select("access_token, external_account_id")
      .eq("id", authorization.integrationId)
      .eq("company_id", authorization.companyId)
      .eq("channel", "whatsapp")
      .eq("active", true)
      .maybeSingle(),
  ]);
  const recipient = String(lead?.external_id ?? lead?.phone ?? "").replace(/\D/g, "");
  const credentials = resolveWhatsappSendCredentials(integration);
  if (recipient.length < 8 || recipient.length > 15) {
    return null;
  }
  if (!credentials.ok) {
    throw new Error(`whatsapp_credentials_${credentials.reason}`);
  }
  return {
    accessToken: credentials.accessToken,
    phoneNumberId: credentials.phoneNumberId,
    recipient,
  };
}
