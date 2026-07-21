// ============================================================================
// FASE 3.3 · ETAPA 2B.1 — Ativação piloto do Coach Interpreter (corrigida).
//
// Diferenças em relação à Etapa 2B:
//  - A autorização do tenant piloto NÃO usa mais prefixo/sufixo do UUID.
//    A validação exige IGUALDADE EXATA entre `input.companyId` e
//    `input.approvedPilotCompanyId` (carregado pelo wrapper CLI a partir da
//    variável server-side `COACH_PILOT_COMPANY_ID`).
//  - Se a origem da configuração do piloto estiver ausente ou inválida,
//    a função retorna o código estável `pilot_config_invalid` ANTES de
//    consultar ou escrever qualquer coisa no banco.
//  - A validação do actor é escopada ao tenant piloto (admin do próprio
//    tenant, não de outro).
//  - Terminologia transacional corrigida: NÃO é uma transação SQL atômica;
//    é um fluxo com rollback compensatório. Se o rollback também falhar,
//    devolve `compensation_failed` com severidade alta.
//  - Nenhum UUID (aprovado ou recebido) aparece integralmente em resultados,
//    mensagens ou logs. Sempre mascarado por `maskUuid`.
//
// Continua sendo um módulo puro (dependências injetadas). O wrapper CLI liga
// as dependências reais a `supabaseAdmin` e valida o ambiente.
// ============================================================================

// -----------------------------------------------------------------------------
// Nome esperado do tenant piloto — auxiliar, NÃO substitui a igualdade do UUID.
// -----------------------------------------------------------------------------
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
  | "pilot_config_invalid"
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
  | "audit_failed_rolled_back"
  | "compensation_failed";

export interface PilotActivationInput {
  companyId: string;
  action: PilotAction;
  actorUserId: string;
  reason: string;
  dryRun: boolean;
  /** Deve ser exatamente "production" para permitir escrita real. */
  environment: string;
  /**
   * UUID íntegro do tenant piloto aprovado, injetado pelo wrapper CLI a
   * partir de `COACH_PILOT_COMPANY_ID`. NUNCA hardcodado, nunca versionado,
   * nunca impresso, nunca enviado ao frontend.
   */
  approvedPilotCompanyId: string | undefined;
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
  /** Severidade para operadores; alta em cenários irreversíveis (compensation_failed). */
  severity?: "info" | "warn" | "error" | "critical";
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
  /**
   * Deve retornar true APENAS quando o usuário for admin do tenant informado
   * (não basta ser admin de outra empresa). O `companyId` recebido é sempre
   * o piloto aprovado.
   */
  actorIsAdminOfCompany(userId: string, companyId: string): Promise<boolean>;
  /** Conta tenants (excluindo `excludeCompanyId`) com a flag já habilitada. */
  countOtherEnabled(excludeCompanyId: string): Promise<number>;
  /**
   * UPDATE otimista compensado: só atualiza a linha se o valor atual for
   * `expectedBefore`. Retorna quantas linhas foram afetadas. Isto NÃO é
   * uma transação SQL atômica junto com o audit_log; é operação
   * independente compensada em caso de falha.
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
export function maskUuid(id: string | undefined | null): string {
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

/** Comparação em tempo constante para reduzir sinal de timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
    severity: extras.severity ?? "info",
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
    severity: extras.severity ?? "error",
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
// Núcleo — orquestra validações → dry-run OU execução compensada.
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

  // 2) formato do UUID recebido
  if (typeof input.companyId !== "string" || !UUID_RE.test(input.companyId)) {
    return fail("company_id_invalid", input);
  }

  // 3) CONFIGURAÇÃO DO PILOTO — precisa existir e ser um UUID válido.
  //    Sem isso, abortar ANTES de qualquer consulta ao banco. O valor esperado
  //    nunca é revelado em mensagem/erro.
  const approved = input.approvedPilotCompanyId;
  if (typeof approved !== "string" || approved.trim() === "" || !UUID_RE.test(approved)) {
    return fail("pilot_config_invalid", input, {
      message:
        "Configuração do piloto ausente ou inválida (COACH_PILOT_COMPANY_ID). Operação bloqueada.",
      severity: "critical",
    });
  }

  // 4) AUTORIZAÇÃO — igualdade INTEGRAL, case-insensitive (UUIDs são
  //    canonicamente lowercase, mas aceitamos ambas as caixas). NUNCA basear
  //    em prefixo/sufixo/regex parcial.
  if (!safeEqual(input.companyId.toLowerCase(), approved.toLowerCase())) {
    return fail("company_not_pilot", input, {
      message: "company_id não corresponde ao tenant piloto aprovado.",
    });
  }

  // 5) ambiente production (dry-run também exige, para evitar apontar para
  //    banco errado por engano; o wrapper CLI passa APP_ENVIRONMENT explícito)
  if (input.environment !== "production") {
    return fail("environment_not_production", input, {
      message: `Ambiente não é production (recebido: ${input.environment || "vazio"}).`,
    });
  }

  // 6) empresa existe e nome bate (defesa em profundidade — não substitui o UUID)
  const company = await deps.fetchCompany(input.companyId);
  if (!company) return fail("company_not_found", input);
  if (normalizeName(company.name) !== PILOT_COMPANY_NAME_NORMALIZED) {
    return fail("company_name_mismatch", input, {
      message: "Nome da empresa não corresponde a Solário Piscinas.",
    });
  }

  // 7) settings existe
  const settings = await deps.fetchSettings(input.companyId);
  if (!settings) return fail("settings_not_found", input);
  const currentState = Boolean(settings.coach_interpreter_enabled);

  // 8) actor existe e é admin DO TENANT PILOTO (não de outro tenant)
  const actor = await deps.fetchActor(input.actorUserId);
  if (!actor) return fail("actor_not_found", input, { currentState });
  const isAdmin = await deps.actorIsAdminOfCompany(input.actorUserId, input.companyId);
  if (!isAdmin) return fail("actor_not_admin", input, { currentState });

  const desired = input.action === "enable";

  // 9) idempotência — nenhum audit_log falso é emitido
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

  // 10) nenhum outro tenant pode estar habilitado ao ativar
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

  // 11) DRY-RUN — nada é escrito
  if (input.dryRun) {
    return ok("dry_run_ok", input, {
      currentState,
      wouldChangeTo: desired,
      auditPreview,
      message: `DRY-RUN — mudaria coach_interpreter_enabled: ${currentState} → ${desired}.`,
    });
  }

  // 12) EXECUÇÃO — UPDATE otimista (expectedBefore garante linha única)
  const upd = await deps.updateFlag(input.companyId, currentState, desired);
  if (upd.error) return fail("update_failed", input, { currentState });
  if (upd.rowsAffected === 0) return fail("update_no_row", input, { currentState });
  if (upd.rowsAffected > 1) {
    // Rollback compensatório imediato. Se ele também falhar, escalar como
    // compensation_failed — jamais retornar sucesso nesse caminho.
    const rb = await deps.updateFlag(input.companyId, desired, currentState);
    if (rb.error || rb.rowsAffected === 0) {
      return fail("compensation_failed", input, {
        currentState,
        message:
          "UPDATE afetou múltiplas linhas e o rollback compensatório falhou. " +
          "Estado inconsistente — executar rollback manual imediatamente.",
        severity: "critical",
      });
    }
    return fail("update_multiple_rows", input, { currentState });
  }

  // 13) AUDITORIA — se falhar, tentar rollback compensatório da flag.
  //     Se o rollback também falhar → compensation_failed (crítico).
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
    const rb = await deps.updateFlag(input.companyId, desired, currentState);
    if (rb.error || rb.rowsAffected === 0) {
      return fail("compensation_failed", input, {
        currentState,
        message:
          "Falha no audit_log e o rollback compensatório da flag também falhou. " +
          "Estado inconsistente — executar rollback manual imediatamente.",
        severity: "critical",
      });
    }
    return fail("audit_failed_rolled_back", input, {
      currentState,
      message: "Falha no audit_log — flag revertida pelo rollback compensatório.",
      severity: "warn",
    });
  }

  return ok(desired ? "activated" : "deactivated", input, {
    currentState,
    wouldChangeTo: desired,
    auditPreview,
    message: `coach_interpreter_enabled: ${currentState} → ${desired}.`,
  });
}
