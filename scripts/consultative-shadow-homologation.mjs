#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const samplesArg = process.argv.find((arg) => arg.startsWith("--samples="));
const samples = Math.max(2, Math.min(1000, Number(samplesArg?.split("=")[1] ?? 100)));

function usage() {
  console.log(`Consultative shadow homologation (safe by default)

Dry-run (no network):
  node scripts/consultative-shadow-homologation.mjs

Execute against a dedicated test project only:
  node scripts/consultative-shadow-homologation.mjs --execute --samples=100

Required execute-only environment variables:
  SHADOW_TEST_SUPABASE_URL
  SHADOW_TEST_SUPABASE_SERVICE_ROLE_KEY
  SHADOW_TEST_PROJECT_REF
  SHADOW_TEST_COMPANY_A_ID
  SHADOW_TEST_COMPANY_B_ID
  SHADOW_HOMOLOGATION_ENV=isolated-test
  SHADOW_HOMOLOGATION_NETWORK=1
  SHADOW_HOMOLOGATION_OUTBOUND=blocked

This script never reads .env, never changes flags, never sends outbound messages,
and never creates tenants or schema objects.
`);
}

if (args.has("--help")) {
  usage();
  process.exit(0);
}

const config = {
  url: process.env.SHADOW_TEST_SUPABASE_URL,
  serviceRoleKey: process.env.SHADOW_TEST_SUPABASE_SERVICE_ROLE_KEY,
  projectRef: process.env.SHADOW_TEST_PROJECT_REF,
  companyA: process.env.SHADOW_TEST_COMPANY_A_ID,
  companyB: process.env.SHADOW_TEST_COMPANY_B_ID,
  environment: process.env.SHADOW_HOMOLOGATION_ENV,
  network: process.env.SHADOW_HOMOLOGATION_NETWORK,
  outbound: process.env.SHADOW_HOMOLOGATION_OUTBOUND,
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertExecuteSafety() {
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) throw new Error(`missing_test_configuration:${missing.join(",")}`);
  if (config.environment !== "isolated-test") throw new Error("unsafe_environment_marker");
  if (config.network !== "1") throw new Error("network_guard_not_enabled");
  if (config.outbound !== "blocked") throw new Error("outbound_must_be_blocked");
  if (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_URL) {
    throw new Error("production_or_current_env_detected_do_not_mix_credentials");
  }
  const url = new URL(config.url);
  if (url.protocol !== "https:") throw new Error("test_supabase_url_must_use_https");
  if (url.hostname !== `${config.projectRef}.supabase.co`) {
    throw new Error("supabase_url_does_not_match_declared_test_project");
  }
  for (const [name, value] of [["companyA", config.companyA], ["companyB", config.companyB]]) {
    if (!uuidPattern.test(value)) throw new Error(`invalid_uuid:${name}`);
  }
  if (config.companyA === config.companyB) throw new Error("synthetic_companies_must_differ");
  for (const key of ["META_ACCESS_TOKEN", "WHATSAPP_ACCESS_TOKEN", "SHADOW_TEST_META_ACCESS_TOKEN"]) {
    if (process.env[key]) throw new Error(`outbound_credential_present:${key}`);
  }
}

function percentile(values, p) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * p) - 1)] ?? 0;
}

function syntheticEvent(companyId, runId, index, latencyMs) {
  const conversationId = randomUUID();
  const leadId = randomUUID();
  return {
    company_id: companyId,
    conversation_id: conversationId,
    lead_id: leadId,
    event_type: "ai_flow_step",
    payload: {
      pilot_run_id: runId,
      synthetic: true,
      consultative_shadow: {
        result: "executed",
        stage: "discovery",
        suggestion_kind: "continue",
        question_generated: false,
        next_action_present: false,
        artifact_counts: {},
        source_counts: {},
        divergence_codes: [],
        latency_ms: latencyMs,
        sample_index: index,
      },
    },
  };
}

async function execute() {
  assertExecuteSafety();
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = randomUUID();
  const latencies = [];
  const companies = [config.companyA, config.companyB];

  for (let index = 0; index < samples; index += 1) {
    const companyId = companies[index % companies.length];
    const started = performance.now();
    const row = syntheticEvent(companyId, runId, index, 0);
    const { error } = await client.from("ai_flow_events").insert(row);
    const elapsed = performance.now() - started;
    if (error) throw new Error(`persistence_insert_failed:${error.message}`);
    latencies.push(elapsed);
  }

  const { data, error } = await client
    .from("ai_flow_events")
    .select("id,company_id,conversation_id,lead_id,payload,created_at")
    .eq("event_type", "ai_flow_step")
    .contains("payload", { pilot_run_id: runId });
  if (error) throw new Error(`persistence_read_failed:${error.message}`);
  if (!Array.isArray(data) || data.length !== samples) {
    throw new Error(`persistence_count_mismatch:expected=${samples}:actual=${data?.length ?? 0}`);
  }

  const allowed = new Set(companies);
  const forbiddenKeys = /^(text|message|phone|price|content)$/i;
  for (const row of data) {
    if (!allowed.has(row.company_id)) throw new Error("tenant_isolation_failed");
    if (row.payload && Object.keys(row.payload).some((key) => forbiddenKeys.test(key))) {
      throw new Error("sensitive_metric_key_detected");
    }
  }

  const counts = Object.fromEntries(companies.map((companyId) => [
    companyId,
    data.filter((row) => row.company_id === companyId).length,
  ]));
  console.log(JSON.stringify({
    ok: true,
    runId,
    samples,
    persistence: "verified",
    counts,
    p95Ms: Number(percentile(latencies, 0.95).toFixed(2)),
    p99Ms: Number(percentile(latencies, 0.99).toFixed(2)),
    outbound: "blocked_by_configuration",
    rollback: "manual_flag_restore_required",
  }, null, 2));
}

if (!args.has("--execute")) {
  usage();
  console.log(`DRY_RUN: no network, no database writes, no credentials loaded from .env; samples=${samples}`);
  process.exit(0);
}

execute().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "homologation_failed" }));
  process.exitCode = 1;
});
