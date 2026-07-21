// ============================================================================
// FASE 3.3 · ETAPA 2B — Ativação piloto do Coach Interpreter
//
// Mecanismo server-side (service_role) para HABILITAR ou DESABILITAR a flag
// `coach_interpreter_enabled` EXCLUSIVAMENTE no tenant piloto aprovado.
//
// Restrições de projeto (obrigatórias):
//  - Sem novas tabelas, RPCs, triggers, migrations, feature flags ou endpoints.
//  - Não expor via UI comum nem rota pública.
//  - Sem alterar contratos, prompts, agente, runtime ou Coach Panel V1.
//  - Padrão dry_run=true; nenhuma escrita sem dry_run=false explícito.
//
// O módulo é PURO: recebe `deps` (funções de acesso ao banco) — o wrapper CLI
// injeta implementações reais usando `supabaseAdmin`. Isto permite testar todos
// os cenários (positivos, negativos e edge-cases) sem tocar em produção.
//
// Segurança:
//  - `service_role` só existe no wrapper CLI e nunca é passado como argumento.
//  - Logs e resultado usam UUID mascarado (`3a7e989c…cbeb48fd`).
//  - Erros carregam códigos estáveis; nenhum detalhe de banco vaza.
// ============================================================================

// -----------------------------------------------------------------------------
// Invariantes do piloto — HARDCODED de propósito. Qualquer company_id que não
// case com prefixo/sufixo abaixo é rejeitado como `company_not_pilot`, mesmo
// que exista no banco. Nome esperado normalizado sem acentos.
// -----------------------------------------------------------------------------
export const PILOT_COMPANY_ID_PREFIX = "3a7e989c";
export const PILOT_COMPANY_ID_SUFFIX = "cbeb48fd";
export const PILOT_COMPANY_NAME_EXPECTED = "Solário Piscinas";
const PILOT_COMPANY_NAME_NORMALIZED = normalizeName(PILOT_COMPANY_NAME_EXPECTED);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// -----------------------------------------------------------------------------
// Tipos públicos
// -----------------------------------------------------------------------------
export type PilotAction = "enable" | "disable";

export type PilotActivationCode =
  // sucesso
  | "dry_run_ok"
  | "activated"
  | "deactivated"
  | "already_enabled"
  | "already_disabled"
  // validação de entrada
  | "reason_missing"
  | "company_id_invalid"
  | "company_not_pilot"
  | "environment_not_production"
  // pré-condições de banco
  | "company_not_found"
  | "company_name_mismatch"
  | "settings_not_found"
  | "actor_not_found"
  | "actor_not_admin"
  | "other_tenant_enabled"
  // execução
  | "update_no_row"
  | "update_multiple_rows"
  | "update_failed"
  | "audit_failed_rolled_back";

export interface PilotActivationInput {
  companyId: string;
  action: PilotAction;
  actorUserId: string;
  reason: string;
  dryRun: boolean;
  /** Deve ser exatamente "production" para permitir escrita real. */
  environment: string;
}

export interface AuditPreview {
  action: "update_company_settings";
  entity: "company_settings";
  entity_id_masked: string;
  company_id_masked: string;
  actor_user_id_masked: string;
  before: { coach_interpreter_enabled: boolean };
  after: { coach_interpreter_enabled: boolean; reason: string; feature: "coach_interpreter" };
}

export interface PilotActivationResult {
  ok: boolean;
  code: PilotActivationCode;
  action: PilotAction;
  dryRun: boolean;
  /** Estado da flag antes da operação (null se desconhecido). */
  currentState: boolean | null;
  /** Estado alvo caso a operação prossiga. */
  wouldChangeTo: boolean | null;
  /** Preview do audit_log — presente em dry_run ou execução bem-sucedida. */
  auditPreview: AuditPreview | null;
  /** Rótulo mascarado da empresa (nunca UUID completo). */
  companyLabel: string;
  /** Mensagem sanitizada para operador humano. */
  message: string;
}

// -----------------------------------------------------------------------------
// Dependências injetadas — o wrapper CLI implementa cada uma sobre
// `supabaseAdmin`. Os testes injetam implementações mockadas.
// -----------------------------------------------------------------------------
export interface AuditInsertRow {
  company_id: string;
  user_id: string;
  action: "update_company_settings";
  entity: "company_settings";
  entity_id: string;
  before: { coach_interpreter_enabled: boolean };
  after: { coach_interpreter_enabled: boolean; reason: string; feature: "coach_interpreter" };
}

export interface PilotActivationDeps {
  fetchCompany(id: string): Promise<{ id: string; name: string } | null>;
  fetchSettings(companyId: string): Promise<{ coach_interpreter_enabled: boolean } | null>;
  fetchActor(userId: string): Promise<{ id: string } | null>;
  actorIsAdmin(userId: string): Promise<boolean>;
  /** Conta tenants (excluindo `excludeCompanyId`) com a flag já habilitada. */
  countOtherEnabled(excludeCompanyId: string): Promise<number>;
  /**
   * UPDATE otimista: só atualiza a linha se o valor atual for `expectedBefore`.
   * Retorna quantas linhas foram afetadas.
   */
  updateFlag(
    companyId: string,
    expectedBefore: boolean,
    desired: boolean,
  ): Promise<{ rowsAffected: number; error?: string }>;
  insertAudit(row: AuditInsertRow): Promise<{ error?: string }>;
}

// -----------------------------------------------------------------------------
// Helpers puros
// -----------------------------------------------------------------------------
export function maskUuid(id: string): string {
  if (typeof id !== "string" || id.length < 12) return "***";
  const head = id.slice(0, 8);
  const tail = id.slice(-8);
  return `${head}…${tail}`;
}

function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function ok(
  code: PilotActivationCode,
  input: PilotActivationInput,
  extras: Partial<PilotActivationResult>,
): PilotActivationResult {
  return {
    ok: true,
    code,
    action: input.action,
    dryRun: input.dryRun,
    currentState: extras.currentState ?? null,
    wouldChangeTo: extras.wouldChangeTo ?? null,
    auditPreview: extras.auditPreview ?? null,
    companyLabel: maskUuid(input.companyId),
    message: extras.message ?? code,
  };
}

function fail(
  code: PilotActivationCode,
  input: PilotActivationInput,
  extras: Partial<PilotActivationResult> = {},
): PilotActivationResult {
  return {
    ok: false,
    code,
    action: input.action,
    dryRun: input.dryRun,
    currentState: extras.currentState ?? null,
    wouldChangeTo: extras.wouldChangeTo ?? null,
    auditPreview: extras.auditPreview ?? null,
    companyLabel: maskUuid(input.companyId),
    message: extras.message ?? code,
  };
}

function buildAuditPreview(
  input: PilotActivationInput,
  before: boolean,
  desired: boolean,
): AuditPreview {
  return {
    action: "update_company_settings",
    entity: "company_settings",
    entity_id_masked: maskUuid(input.companyId),
    company_id_masked: maskUuid(input.companyId),
    actor_user_id_masked: maskUuid(input.actorUserId),
    before: { coach_interpreter_enabled: before },
    after: {
      coach_interpreter_enabled: desired,
      reason: input.reason.trim(),
      feature: "coach_interpreter",
    },
  };
}

// -----------------------------------------------------------------------------
// Núcleo — orquestra validações → dry-run OU execução com auditoria e rollback.
// -----------------------------------------------------------------------------
export async function runPilotActivation(
  input: PilotActivationInput,
  deps: PilotActivationDeps,
): Promise<PilotActivationResult> {
  // 1) motivo obrigatório
  if (typeof input.reason !== "string" || input.reason.trim().length < 5) {
    return fail("reason_missing", input, {
      message: "Motivo obrigatório (mínimo 5 caracteres não em branco).",
    });
  }

  // 2) formato do UUID
  if (typeof input.companyId !== "string" || !UUID_RE.test(input.companyId)) {
    return fail("company_id_invalid", input);
  }

  // 3) invariantes do piloto (prefixo/sufixo)
  const lower = input.companyId.toLowerCase();
  if (!lower.startsWith(PILOT_COMPANY_ID_PREFIX) || !lower.endsWith(PILOT_COMPANY_ID_SUFFIX)) {
    return fail("company_not_pilot", input, {
      message: "company_id não corresponde ao tenant piloto aprovado.",
    });
  }

  // 4) ambiente production (dry-run também exige, para evitar apontar para
  //    banco errado por engano; o wrapper CLI passa APP_ENVIRONMENT explicito)
  if (input.environment !== "production") {
    return fail("environment_not_production", input, {
      message: `Ambiente não é production (recebido: ${input.environment || "vazio"}).`,
    });
  }

  // 5) empresa existe e nome bate
  const company = await deps.fetchCompany(input.companyId);
  if (!company) return fail("company_not_found", input);
  if (normalizeName(company.name) !== PILOT_COMPANY_NAME_NORMALIZED) {
    return fail("company_name_mismatch", input, {
      message: "Nome da empresa não corresponde a Solário Piscinas.",
    });
  }

  // 6) settings existe
  const settings = await deps.fetchSettings(input.companyId);
  if (!settings) return fail("settings_not_found", input);
  const currentState = Boolean(settings.coach_interpreter_enabled);

  // 7) actor existe e é admin
  const actor = await deps.fetchActor(input.actorUserId);
  if (!actor) return fail("actor_not_found", input, { currentState });
  const isAdmin = await deps.actorIsAdmin(input.actorUserId);
  if (!isAdmin) return fail("actor_not_admin", input, { currentState });

  const desired = input.action === "enable";

  // 8) idempotência — nenhum audit_log falso é emitido
  if (input.action === "enable" && currentState === true) {
    return ok("already_enabled", input, {
      currentState,
      wouldChangeTo: true,
      message: "Coach Interpreter já habilitado; nenhuma alteração.",
    });
  }
  if (input.action === "disable" && currentState === false) {
    return ok("already_disabled", input, {
      currentState,
      wouldChangeTo: false,
      message: "Coach Interpreter já desabilitado; nenhuma alteração.",
    });
  }

  // 9) nenhum outro tenant pode estar habilitado ao ativar
  if (input.action === "enable") {
    const others = await deps.countOtherEnabled(input.companyId);
    if (others > 0) {
      return fail("other_tenant_enabled", input, {
        currentState,
        message: `Existem ${others} outra(s) empresa(s) com a flag habilitada.`,
      });
    }
  }

  const auditPreview = buildAuditPreview(input, currentState, desired);

  // 10) DRY-RUN — nada é escrito
  if (input.dryRun) {
    return ok("dry_run_ok", input, {
      currentState,
      wouldChangeTo: desired,
      auditPreview,
      message: `DRY-RUN — mudaria coach_interpreter_enabled: ${currentState} → ${desired}.`,
    });
  }

  // 11) EXECUÇÃO — UPDATE otimista (expectedBefore garante linha única)
  const upd = await deps.updateFlag(input.companyId, currentState, desired);
  if (upd.error) return fail("update_failed", input, { currentState });
  if (upd.rowsAffected === 0) return fail("update_no_row", input, { currentState });
  if (upd.rowsAffected > 1) {
    // Rollback imediato: reverter todas as linhas afetadas ao estado anterior.
    // O UPDATE já ocorreu; devolvemos ao valor prévio ainda dentro do escopo
    // da mesma "operação lógica" e retornamos erro.
    await deps.updateFlag(input.companyId, desired, currentState);
    return fail("update_multiple_rows", input, { currentState });
  }

  // 12) AUDITORIA — se falhar, rollback da flag
  const auditRow: AuditInsertRow = {
    company_id: input.companyId,
    user_id: input.actorUserId,
    action: "update_company_settings",
    entity: "company_settings",
    entity_id: input.companyId,
    before: { coach_interpreter_enabled: currentState },
    after: {
      coach_interpreter_enabled: desired,
      reason: input.reason.trim(),
      feature: "coach_interpreter",
    },
  };
  const audit = await deps.insertAudit(auditRow);
  if (audit.error) {
    // rollback da flag
    await deps.updateFlag(input.companyId, desired, currentState);
    return fail("audit_failed_rolled_back", input, {
      currentState,
      message: "Falha no audit_log — flag revertida.",
    });
  }

  return ok(desired ? "activated" : "deactivated", input, {
    currentState,
    wouldChangeTo: desired,
    auditPreview,
    message: `coach_interpreter_enabled: ${currentState} → ${desired}.`,
  });
}
