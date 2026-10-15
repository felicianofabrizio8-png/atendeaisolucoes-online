import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Mail, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/auth/AuthContext";
import { useTeamAccess } from "@/hooks/useTeamAccess";
import { PROFILE_LABEL, presetOf, type TeamRole } from "@/lib/team/permissions";
import {
  approveMember,
  cancelInvite,
  inviteUser,
  listCompanyInvites,
  listCompanyUsers,
  listInviteLinks,
  rejectMember,
  updateTeamMember,
  type TeamUser,
} from "@/lib/users.functions";
import { LumePopup } from "@/components/team/LumePopup";
import { SettingsTabHeader } from "./settings-ui";
import { MemberPermissionsDialog } from "./team/MemberPermissionsDialog";
import { PendingApprovals } from "./team/PendingApprovals";
import { InviteLinksSection } from "./team/InviteLinksSection";

const button =
  "inline-flex items-center justify-center gap-2 rounded-full border border-border px-4 py-2 text-sm disabled:opacity-50";
const ROLE_LABEL: Record<TeamRole, string> = {
  admin: "Administrador",
  atendente: "Atendente",
  financeiro: "Financeiro",
};

function statusOf(member: TeamUser) {
  if (member.approvalPending && !member.active) return "Aguardando aprovação";
  return member.active ? "Ativo" : "Desativado";
}

/** Usuários e Permissões: membros, perfis, aprovações, links e convites por e-mail. */
export function UsersTab() {
  const { user, profile } = useAuth();
  const access = useTeamAccess();
  const cache = useQueryClient();
  const [editing, setEditing] = useState<TeamUser | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("atendente");
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["team-users", profile?.company_id],
    enabled: access.isAdmin && access.access?.schemaReady === true,
    queryFn: async () => {
      const [users, invites, links] = await Promise.all([
        listCompanyUsers(),
        listCompanyInvites(),
        listInviteLinks().catch(() => []),
      ]);
      return { ...users, ...invites, links };
    },
  });
  async function refresh() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["team-users"] }),
      cache.invalidateQueries({ queryKey: ["team-access"] }),
      cache.invalidateQueries({ queryKey: ["team-directory"] }),
    ]);
  }
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }
  if (access.isPending) return <Loader2 className="animate-spin" />;
  if (!access.isAdmin)
    return (
      <p className="text-sm text-muted-foreground">Apenas administradores gerenciam a equipe.</p>
    );
  if (access.access?.schemaReady === false)
    return (
      <>
        <SettingsTabHeader
          title="Usuários e permissões"
          description="A atualização da equipe está pronta para ser ativada."
        />
        <p className="rounded-2xl border border-border bg-card p-4 text-sm">
          A migração de equipe precisa ser aplicada ao Supabase antes de convidar pessoas. Sua conta
          administradora continua com acesso ao sistema.
        </p>
      </>
    );
  const members = query.data?.users ?? [];
  return (
    <>
      <SettingsTabHeader
        title="Usuários e permissões"
        description="Cada pessoa tem sua conta e os acessos que você definir."
        action={
          <button className={button} onClick={() => setInviteOpen(true)}>
            <Mail className="h-4 w-4" />
            Convidar por e-mail
          </button>
        }
      />
      {query.isError && (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      )}
      {query.isPending && <Loader2 className="animate-spin" />}

      <PendingApprovals
        members={members}
        busy={busy}
        onApprove={(id) => void perform(() => approveMember(id))}
        onReject={(id) => void perform(() => rejectMember(id))}
      />

      <section aria-label="Membros" className="space-y-2">
        {members
          .filter((member) => !(member.approvalPending && !member.active))
          .map((member) => {
            const name = member.displayName || member.email || "Usuário";
            return (
              <div
                key={member.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4"
              >
                <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-[#6d45d6] to-[#9b7bf0] font-semibold text-white">
                  {name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {name}
                    {member.id === user?.id ? " (você)" : ""}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
                  {PROFILE_LABEL[presetOf(member.permissions, member.role)]}
                </span>
                <span
                  className={`text-xs ${member.active ? "text-muted-foreground" : "text-destructive"}`}
                >
                  {statusOf(member)}
                </span>
                <button
                  className={button}
                  aria-label={`Editar ${name}`}
                  onClick={() => setEditing({ ...member, permissions: [...member.permissions] })}
                >
                  <Settings2 className="h-4 w-4" />
                  Permissões
                </button>
              </div>
            );
          })}
      </section>

      <InviteLinksSection links={query.data?.links ?? []} onChanged={() => void refresh()} />

      <section aria-label="Convites por e-mail" className="mt-8">
        <h3 className="mb-1 text-sm font-semibold">Convites por e-mail</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Válidos por 7 dias e só para o e-mail informado.
        </p>
        {query.data?.invites.map((invite) => {
          const pending =
            !invite.accepted_at && !invite.cancelled_at && new Date(invite.expires_at) > new Date();
          return (
            <div
              key={invite.id}
              className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-border p-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate">{invite.email}</p>
                <span className="text-xs text-muted-foreground">
                  {ROLE_LABEL[invite.role]} ·{" "}
                  {invite.accepted_at
                    ? "Aceito"
                    : invite.cancelled_at
                      ? "Cancelado"
                      : pending
                        ? "Pendente"
                        : "Expirado"}
                </span>
              </div>
              {pending && (
                <>
                  <button
                    className={button}
                    aria-label={`Copiar convite para ${invite.email}`}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(
                          `${window.location.origin}/convite?token=${encodeURIComponent(invite.token)}`,
                        )
                        .then(() => toast.success("Link copiado"))
                        .catch(() => toast.error("Não foi possível copiar"))
                    }
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    disabled={busy}
                    className={button}
                    aria-label={`Cancelar convite para ${invite.email}`}
                    onClick={() =>
                      void perform(() => cancelInvite({ data: { inviteId: invite.id } }))
                    }
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </section>

      <LumePopup
        open={inviteOpen}
        size="sm"
        title="Convidar por e-mail"
        description="Gera um convite só para este e-mail, válido por 7 dias."
        onClose={() => setInviteOpen(false)}
        footer={
          <>
            <button type="button" className="lq-secondary" onClick={() => setInviteOpen(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="lq-primary ml-auto"
              disabled={busy || !email.trim()}
              onClick={() =>
                void perform(async () => {
                  await inviteUser({ data: { email, role } });
                  setInviteOpen(false);
                  setEmail("");
                  toast.success("Convite criado. Copie o link na lista de convites.");
                })
              }
            >
              Criar convite
            </button>
          </>
        }
      >
        <section className="lq-section">
          <label className="block min-w-0">
            <span className="lq-field-label">E-mail</span>
            <input
              type="email"
              required
              className="quote-form-input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
        </section>
        <section className="lq-section">
          <h3 className="lq-section-title">Perfil</h3>
          <div className="lq-chips" role="radiogroup" aria-label="Perfil do convite">
            {(Object.keys(ROLE_LABEL) as TeamRole[]).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={role === value}
                onClick={() => setRole(value)}
              >
                {ROLE_LABEL[value]}
              </button>
            ))}
          </div>
        </section>
      </LumePopup>

      <MemberPermissionsDialog
        member={editing}
        self={editing?.id === user?.id}
        onClose={() => setEditing(null)}
        onSave={(data) =>
          perform(async () => {
            await updateTeamMember(data);
            toast.success("Permissões atualizadas");
          })
        }
      />
    </>
  );
}
