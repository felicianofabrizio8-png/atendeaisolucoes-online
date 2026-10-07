export const PERMISSIONS = {
  "dashboard.view": "Visualizar dashboard",
  "conversations.read": "Visualizar a fila e seus atendimentos",
  "conversations.reply": "Assumir e responder atendimentos",
  "conversations.view_all": "Visualizar atendimentos de toda a equipe",
  "conversations.assign": "Transferir atendimentos entre usuários",
  "quotes.manage": "Criar e gerenciar orçamentos",
  "agenda.manage": "Gerenciar agenda",
  "products.view": "Consultar catálogo de produtos",
  "products.manage": "Editar produtos e preços",
  "reports.view": "Visualizar relatórios",
  "campaigns.manage": "Gerenciar campanhas e marketing",
  "ai.manage": "Configurar motor da IA",
  "settings.manage": "Gerenciar configurações e integrações",
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
  return "admin";
}
