// Tela de Usuários e Permissões — acessível apenas para admins.
// Rota não aninhada (configuracoes_.usuarios) para não exigir layout em /configuracoes.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import {
  Users,
  ArrowLeft,
  UserPlus,
  Trash2,
  Copy,
  Check,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Mail,
  Clock,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  listCompanyUsers,
  listCompanyInvites,
  inviteUser,
  cancelInvite,
  changeUserRole,
  removeUser,
} from "@/lib/users.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/configuracoes_/usuarios")({
  component: UsersPage,
});

type Role = "admin" | "atendente" | "financeiro";

interface UserRow {
  id: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  role: Role | null;
}

interface InviteRow {
  id: string;
  email: string;
  role: Role;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  atendente: "Atendente",
  financeiro: "Financeiro",
};

const ROLE_BADGE: Record<Role, string> = {
  admin: "bg-primary/10 text-primary border-primary/20",
  atendente: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  financeiro: "bg-amber-500/10 text-amber-600 border-amber-500/20",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Agora";
  if (min < 60) return `${min}min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d atrás`;
  return formatDate(iso);
}

function UsersPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Check admin
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate({ to: "/login" });
      return;
    }
    (async () => {
      const { data: companyId } = await supabase.rpc("current_company_id");
      if (!companyId) {
        setIsAdmin(false);
        return;
      }
      const { data } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _company_id: companyId as string,
        _role: "admin",
      });
      setIsAdmin(Boolean(data));
    })();
  }, [user, authLoading, navigate]);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [u, i] = await Promise.all([listCompanyUsers(), listCompanyInvites()]);
      setUsers(u.users as UserRow[]);
      setInvites(i.invites as InviteRow[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao carregar usuários");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void reload();
  }, [isAdmin, reload]);

  if (authLoading || isAdmin === null) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-base font-semibold">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Apenas administradores podem gerenciar usuários e permissões.
        </p>
        <Link
          to="/configuracoes"
          className="text-sm text-primary hover:underline mt-2"
        >
          ← Voltar para Configurações
        </Link>
      </div>
    );
  }

  const adminCount = users.filter((u) => u.role === "admin").length;

  const handleChangeRole = async (target: UserRow, newRole: Role) => {
    if (target.role === newRole) return;
    setBusy(target.id);
    setErr(null);
    try {
      await changeUserRole({ data: { userId: target.id, role: newRole } });
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao alterar papel");
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async () => {
    if (!confirmRemove) return;
    setBusy(confirmRemove.id);
    setErr(null);
    try {
      await removeUser({ data: { userId: confirmRemove.id } });
      setConfirmRemove(null);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao remover usuário");
    } finally {
      setBusy(null);
    }
  };

  const handleCancelInvite = async (id: string) => {
    setBusy(id);
    setErr(null);
    try {
      await cancelInvite({ data: { inviteId: id } });
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao cancelar convite");
    } finally {
      setBusy(null);
    }
  };

  const copyInviteLink = async (token: string, id: string) => {
    const url = `${window.location.origin}/login?invite=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="h-14 px-4 md:px-6 border-b border-border flex items-center gap-3">
        <Link
          to="/configuracoes"
          className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted/50"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Users className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <h1 className="text-sm font-semibold">Usuários e Permissões</h1>
          <p className="text-[11px] text-muted-foreground">
            Gerencie quem tem acesso à empresa e seus papéis
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1.5 hover:opacity-90"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Convidar
        </button>
      </header>

      <div className="p-4 md:p-6 max-w-4xl space-y-6">
        {err && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {err}
          </div>
        )}

        {/* Users */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Usuários ativos ({users.length})
            </h2>
            <span className="text-[11px] text-muted-foreground">
              {adminCount} admin{adminCount === 1 ? "" : "s"}
            </span>
          </div>

          {loading ? (
            <div className="rounded-lg border border-border bg-card p-8 grid place-items-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card divide-y divide-border">
              {users.map((u) => {
                const isSelf = u.id === user?.id;
                const isLastAdmin = u.role === "admin" && adminCount <= 1;
                return (
                  <div
                    key={u.id}
                    className="p-3 md:p-4 flex flex-col md:flex-row md:items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {u.displayName || u.email || "Sem nome"}
                        </span>
                        {isSelf && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            você
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {u.email}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-3">
                        <span>Entrou em {formatDate(u.createdAt)}</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {formatRelative(u.lastSeenAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={u.role ?? ""}
                        onChange={(e) => handleChangeRole(u, e.target.value as Role)}
                        disabled={busy === u.id || isLastAdmin}
                        title={
                          isLastAdmin
                            ? "Não é possível rebaixar o último administrador"
                            : ""
                        }
                        className={cn(
                          "h-8 px-2 rounded-md border text-xs bg-background min-w-[140px]",
                          u.role && ROLE_BADGE[u.role],
                          (busy === u.id || isLastAdmin) && "opacity-60 cursor-not-allowed",
                        )}
                      >
                        {!u.role && <option value="">— sem papel —</option>}
                        <option value="admin">Administrador</option>
                        <option value="atendente">Atendente</option>
                        <option value="financeiro">Financeiro</option>
                      </select>

                      <button
                        onClick={() => setConfirmRemove(u)}
                        disabled={isSelf || isLastAdmin || busy === u.id}
                        title={
                          isSelf
                            ? "Você não pode remover a si mesmo"
                            : isLastAdmin
                              ? "Não é possível remover o último administrador"
                              : "Remover da empresa"
                        }
                        className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Pending invites */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Convites
          </h2>
          {invites.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
              Nenhum convite enviado.
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card divide-y divide-border">
              {invites.map((inv) => {
                const expired = new Date(inv.expires_at) < new Date();
                const status = inv.accepted_at
                  ? { label: "Aceito", color: "text-emerald-600" }
                  : inv.cancelled_at
                    ? { label: "Cancelado", color: "text-muted-foreground" }
                    : expired
                      ? { label: "Expirado", color: "text-destructive" }
                      : { label: "Pendente", color: "text-amber-600" };
                const active = !inv.accepted_at && !inv.cancelled_at && !expired;
                return (
                  <div
                    key={inv.id}
                    className="p-3 md:p-4 flex flex-col md:flex-row md:items-center gap-3"
                  >
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{inv.email}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded border text-[10px]",
                            ROLE_BADGE[inv.role],
                          )}
                        >
                          {ROLE_LABELS[inv.role]}
                        </span>
                        <span className={status.color}>{status.label}</span>
                        <span>· expira {formatDate(inv.expires_at)}</span>
                      </div>
                    </div>
                    {active && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => copyInviteLink(inv.token, inv.id)}
                          className="h-8 px-2.5 rounded-md border border-border text-xs inline-flex items-center gap-1.5 hover:bg-muted/50"
                        >
                          {copiedId === inv.id ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-600" />
                              Copiado
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              Copiar link
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleCancelInvite(inv.id)}
                          disabled={busy === inv.id}
                          className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <ShieldCheck className="h-3 w-3 mt-0.5 shrink-0" />
          Todas as alterações são validadas no servidor e registradas no log de
          auditoria. Sempre deve existir pelo menos um administrador por empresa.
        </p>
      </div>

      {/* Invite dialog */}
      {showInvite && (
        <InviteDialog
          onClose={() => setShowInvite(false)}
          onCreated={async () => {
            setShowInvite(false);
            await reload();
          }}
        />
      )}

      {/* Remove confirmation */}
      {confirmRemove && (
        <ConfirmDialog
          title="Remover usuário?"
          message={
            <>
              <strong>{confirmRemove.displayName || confirmRemove.email}</strong>{" "}
              perderá acesso à empresa. Esta ação pode ser revertida convidando o
              usuário novamente.
            </>
          }
          confirmLabel="Remover"
          danger
          busy={busy === confirmRemove.id}
          onConfirm={handleRemove}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

function InviteDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("atendente");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      await inviteUser({ data: { email, role } });
      onCreated();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Falha ao convidar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4">
      <form
        onSubmit={submit}
        className="bg-card border border-border rounded-lg shadow-lg w-full max-w-sm p-5 space-y-4"
      >
        <div>
          <h3 className="text-sm font-semibold">Convidar usuário</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Geraremos um link de convite válido por 7 dias.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">E-mail</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="pessoa@empresa.com"
            className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Papel</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
          >
            <option value="atendente">Atendente</option>
            <option value="financeiro">Financeiro</option>
            <option value="admin">Administrador</option>
          </select>
        </div>

        {err && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-2.5 py-1.5">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-8 px-3 rounded-md border border-border text-xs hover:bg-muted/50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
            Enviar convite
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4">
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1.5">{message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="h-8 px-3 rounded-md border border-border text-xs hover:bg-muted/50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "h-8 px-3 rounded-md text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60",
              danger
                ? "bg-destructive text-destructive-foreground"
                : "bg-primary text-primary-foreground",
            )}
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
