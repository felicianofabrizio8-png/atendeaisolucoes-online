import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, ShieldCheck, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/auth/AuthContext";
import { useTeamAccess } from "@/hooks/useTeamAccess";
import {
  PERMISSIONS,
  ADMIN_ONLY_PERMISSIONS,
  type Permission,
  type TeamRole,
} from "@/lib/team/permissions";
import {
  cancelInvite,
  inviteUser,
  listCompanyInvites,
  listCompanyUsers,
  updateTeamMember,
  type TeamUser,
} from "@/lib/users.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SettingsTabHeader } from "./settings-ui";

const field = "w-full rounded-xl border border-border bg-input px-3 py-2 text-sm";
const button =
  "inline-flex items-center justify-center gap-2 rounded-full border border-border px-4 py-2 text-sm disabled:opacity-50";
const labels: Record<TeamRole, string> = {
  admin: "Administrador",
  atendente: "Atendente",
  financeiro: "Financeiro",
};

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
    queryFn: async () => ({ ...(await listCompanyUsers()), ...(await listCompanyInvites()) }),
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
          title="Equipe e permissões"
          description="A atualização da equipe está pronta para ser ativada."
        />
        <p className="rounded-2xl border border-border bg-card p-4 text-sm">
          A migração de equipe precisa ser aplicada ao Supabase antes de convidar atendentes. Sua
          conta administradora continua com acesso ao sistema.
        </p>
      </>
    );
  return (
    <>
      <SettingsTabHeader
        title="Equipe e permissões"
        description="Cada pessoa tem sua conta, seus atendimentos e os acessos que você definir."
        action={
          <button className={button} onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Convidar
          </button>
        }
      />
      {query.isError && (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      )}
      {query.isPending && <Loader2 className="animate-spin" />}
      <div className="space-y-3">
        {query.data?.users.map((member) => (
          <div
            key={member.id}
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4"
          >
            <div className="grid h-10 w-10 place-items-center rounded-full bg-muted font-semibold">
              {(member.displayName || member.email || "U").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {member.displayName || member.email}
                {member.id === user?.id ? " (você)" : ""}
              </p>
              <p className="truncate text-xs text-muted-foreground">{member.email}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {member.active ? labels[member.role ?? "atendente"] : "Acesso desativado"}
              </p>
            </div>
            <button
              className={button}
              onClick={() => setEditing({ ...member, permissions: [...member.permissions] })}
            >
              <ShieldCheck className="h-4 w-4" />
              Permissões
            </button>
          </div>
        ))}
      </div>
      <h3 className="mb-3 mt-7 text-sm font-semibold">Convites</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Copie o link e compartilhe com a pessoa convidada. Ele é válido por 7 dias e exige o e-mail
        informado.
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
                {labels[invite.role]} ·{" "}
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
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="rounded-3xl bg-background" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Convidar para a equipe</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                await inviteUser({ data: { email, role } });
                setInviteOpen(false);
                setEmail("");
                toast.success("Convite criado. Copie o link na lista de convites.");
              });
            }}
          >
            <label className="block space-y-1 text-sm">
              <span>E-mail</span>
              <input
                type="email"
                required
                className={field}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span>Perfil</span>
              <select
                className={field}
                value={role}
                onChange={(e) => setRole(e.target.value as TeamRole)}
              >
                {Object.entries(labels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              Após a pessoa entrar, você pode personalizar suas permissões.
            </p>
            <button disabled={busy} className={button + " bg-primary text-primary-foreground"}>
              Criar convite
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto rounded-3xl bg-background"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>Permissões de {editing?.displayName || editing?.email}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  await updateTeamMember(editing);
                  setEditing(null);
                  toast.success("Permissões atualizadas");
                });
              }}
            >
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={editing.active}
                  disabled={editing.id === user?.id}
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                />
                Acesso ativo à empresa
              </label>
              <label className="block space-y-1 text-sm">
                <span>Perfil</span>
                <select
                  className={field}
                  value={editing.role ?? "atendente"}
                  onChange={(e) => setEditing({ ...editing, role: e.target.value as TeamRole })}
                >
                  {Object.entries(labels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {editing.role === "admin" ? (
                <p className="rounded-xl bg-muted p-3 text-sm">
                  Administradores têm acesso completo e podem gerenciar a equipe. A empresa sempre
                  precisa de um administrador ativo.
                </p>
              ) : (
                <fieldset className="space-y-3">
                  <legend className="mb-3 text-sm font-semibold">Acessos permitidos</legend>
                  <p className="text-xs text-muted-foreground">
                    Motor da IA, campanhas, integrações e gestão da equipe são exclusivos de
                    administradores.
                  </p>
                  {Object.entries(PERMISSIONS)
                    .filter(([key]) => !ADMIN_ONLY_PERMISSIONS.includes(key as Permission))
                    .map(([key, label]) => (
                      <label key={key} className="flex items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={editing.permissions.includes(key as Permission)}
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              permissions: e.target.checked
                                ? [...editing.permissions, key as Permission]
                                : editing.permissions.filter((p) => p !== key),
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                </fieldset>
              )}
              <button disabled={busy} className={button + " bg-primary text-primary-foreground"}>
                {busy ? "Salvando…" : "Salvar permissões"}
              </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
