export const PERMISSIONS = {
  "dashboard.view": "Visualizar dashboard",
  "conversations.read": "Visualizar a fila e seus atendimentos",
  "conversations.reply": "Assumir e responder atendimentos",
  "conversations.view_all": "Visualizar atendimentos de toda a equipe",
  "conversations.assign": "Transferir atendimentos entre usuários",
  "quotes.manage": "Criar e gerenciar orçamentos",
  "agenda.manage": "Usar a agenda (pessoal)",
  "agenda.team": "Gerenciar agenda da equipe",
  "products.view": "Consultar catálogo de produtos",
  "products.manage": "Editar produtos e preços",
  "reports.view": "Visualizar relatórios",
  "campaigns.manage": "Gerenciar campanhas e marketing",
  "ai.manage": "Configurar motor da IA",
  "settings.manage": "Gerenciar configurações e integrações",
  "goals.view": "Ver metas",
  "goals.manage": "Gerenciar metas",
} as const;

export type Permission = keyof typeof PERMISSIONS;
// These modules already have admin-only workflows in the database/server.
export const ADMIN_ONLY_PERMISSIONS: Permission[] = [
  "ai.manage",
  "settings.manage",
  "campaigns.manage",
];
export type TeamRole = "admin" | "atendente" | "financeiro";
export const DEFAULT_ATTENDANT: Permission[] = [
  "conversations.read",
  "conversations.reply",
  "quotes.manage",
  "agenda.manage",
  "products.view",
  "goals.view",
];
export interface TeamAccess {
  schemaReady?: boolean;
  role: TeamRole | null;
  active: boolean;
  permissions: Permission[];
}
export function can(access: TeamAccess | undefined, permission: Permission): boolean {
  return (
    !!access?.active &&
    (access.role === "admin" ||
      (!ADMIN_ONLY_PERMISSIONS.includes(permission) && access.permissions.includes(permission)))
  );
}
export function pagePermission(path: string): Permission | "admin" | null {
  if (path === "/") return "dashboard.view";
  if (/^\/(inbox|atendimento)(\/|-|$)/.test(path)) return "conversations.read";
  if (path.startsWith("/orcamentos")) return "quotes.manage";
  if (path.startsWith("/agenda")) return "agenda.manage";
  if (path.startsWith("/produtos")) return "products.view";
  if (path.startsWith("/relatorios")) return "reports.view";
  if (/^\/(campanhas|criativos|marketing)/.test(path)) return "campaigns.manage";
  if (/^\/(ia|runtime|executivo|saude)/.test(path)) return "ai.manage";
  if (path.startsWith("/configuracoes/usuarios")) return "admin";
  if (/^\/(configuracoes\/(coach|regras|recovery))/.test(path)) return "ai.manage";
  if (/^\/(configuracoes|onboarding)/.test(path)) return "settings.manage";
  if (path.startsWith("/metas")) return "goals.view";
  return "admin";
}
export function canOpenPage(access: TeamAccess | undefined, path: string): boolean {
  const permission = pagePermission(path);
  return (
    !!access?.active &&
    (permission === null ||
      (permission === "admin" ? access.role === "admin" : can(access, permission)))
  );
}

/** Private API routes default to administration; new routes do not inherit operator access. */
export function apiPermission(path: string): Permission | "admin" {
  if (path === "/api/dashboard/analyze") return "dashboard.view";
  if (path === "/api/atendimento/copilot") return "conversations.read";
  // Lume: hoje age só na Agenda; novos domínios entram com a permissão deles.
  if (/^\/api\/lume\/(chat|action|status)$/.test(path)) return "agenda.manage";
  if (path === "/api/atendimento/followup" || path === "/api/ai/followup-status")
    return "conversations.read";
  if (/^\/api\/whatsapp\/(send(?:-|$)|forward-message|templates\/send)/.test(path))
    return "conversations.reply";
  if (path === "/api/whatsapp/templates/list") return "conversations.read";
  if (
    /^\/api\/(atendimento\/followup|ai\/(suggest(?:-reply|-product)?|v2-suggestion|agent-takeover|mark-sent|followup-status|followup-reactivate)|recovery\/(assist|execute))$/.test(
      path,
    )
  )
    return "conversations.reply";
  if (
    /^\/api\/(relationship-campaigns|ai\/(creative-generator|campaign-creative|campaign-advisor))/.test(
      path,
    )
  )
    return "campaigns.manage";
  if (/^\/api\/(ai|runtime|coach|executive|scientific|business|system-health)/.test(path))
    return "ai.manage";
  if (/^\/api\/(meta|whatsapp|onboarding)/.test(path)) return "settings.manage";
  if (/^\/api\/goals\//.test(path)) return "goals.view";
  return "admin";
}

export const PERMISSION_GROUPS: Array<{ module: string; items: Array<{ key: Permission; hint: string }> }> = [
  { module: "Painel", items: [{ key: "dashboard.view", hint: "Vê os números da empresa." }] },
  {
    module: "Atendimento",
    items: [
      { key: "conversations.read", hint: "Vê a fila e os próprios atendimentos." },
      { key: "conversations.reply", hint: "Assume e responde clientes." },
      { key: "conversations.view_all", hint: "Acompanha os atendimentos de todos." },
      { key: "conversations.assign", hint: "Transfere atendimentos entre pessoas." },
    ],
  },
  {
    module: "Agenda",
    items: [
      { key: "agenda.manage", hint: "Tem a própria agenda: clientes, lembretes e tarefas." },
      { key: "agenda.team", hint: "Cria compromissos da equipe e vê a agenda de todos." },
    ],
  },
  {
    module: "Metas",
    items: [
      { key: "goals.view", hint: "Vê as metas da empresa e as próprias." },
      { key: "goals.manage", hint: "Cria, edita e acompanha as metas de todos." },
    ],
  },
  { module: "Orçamentos", items: [{ key: "quotes.manage", hint: "Cria e envia orçamentos." }] },
  {
    module: "Catálogo",
    items: [
      { key: "products.view", hint: "Consulta produtos e preços." },
      { key: "products.manage", hint: "Edita produtos e preços." },
    ],
  },
  { module: "Relatórios", items: [{ key: "reports.view", hint: "Vê relatórios." }] },
  { module: "Marketing", items: [{ key: "campaigns.manage", hint: "Só administradores." }] },
  { module: "IA", items: [{ key: "ai.manage", hint: "Só administradores." }] },
  { module: "Configurações", items: [{ key: "settings.manage", hint: "Só administradores." }] },
];

export const PROFILE_PRESETS = {
  funcionario: [...DEFAULT_ATTENDANT],
  gestor_agenda: [...DEFAULT_ATTENDANT, "agenda.team"],
} satisfies Record<string, Permission[]>;

export function presetOf(permissions: Permission[], role: TeamRole | null) {
  if (role === "admin") return "admin" as const;
  const same = (a: Permission[], b: Permission[]) =>
    a.length === b.length && a.every((item) => b.includes(item));
  if (same(permissions, PROFILE_PRESETS.gestor_agenda)) return "gestor_agenda" as const;
  if (same(permissions, PROFILE_PRESETS.funcionario)) return "funcionario" as const;
  return "personalizado" as const;
}

export function canManageGoals(access: TeamAccess | undefined): boolean {
  return can(access, "goals.manage");
}

export function canManageTeamAgenda(access: TeamAccess | undefined): boolean {
  return can(access, "agenda.team");
}

export const PROFILE_LABEL = {
  funcionario: "Funcionário",
  gestor_agenda: "Gestor da agenda",
  admin: "Administrador",
  personalizado: "Personalizado",
} as const;
