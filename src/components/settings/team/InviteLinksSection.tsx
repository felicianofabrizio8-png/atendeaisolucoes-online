import { useState } from "react";
import { Copy, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { LumePopup } from "@/components/team/LumePopup";
import { PROFILE_LABEL, PROFILE_PRESETS } from "@/lib/team/permissions";
import {
  createInviteLink,
  inviteLinkUrl,
  revokeInviteLink,
  type InviteLink,
} from "@/lib/users.functions";
import "./team-settings.css";

function linkStatus(link: InviteLink) {
  if (link.revoked_at) return "Revogado";
  if (link.expires_at && new Date(link.expires_at) <= new Date()) return "Vencido";
  if (link.max_uses != null && link.uses >= link.max_uses) return "Esgotado";
  return "Ativo";
}

const VALIDITY: Array<{ label: string; days: number | null }> = [
  { label: "1 dia", days: 1 },
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "Sem prazo", days: null },
];

async function copy(token: string) {
  try {
    await navigator.clipboard.writeText(inviteLinkUrl(token));
    toast.success("Link copiado");
  } catch {
    toast.error("Não foi possível copiar");
  }
}

/** Links de convite estilo Notion: perfil, aprovação, validade e limite de usos. */
export function InviteLinksSection({
  links,
  onChanged,
}: {
  links: InviteLink[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [profile, setProfile] = useState<"funcionario" | "gestor_agenda">("funcionario");
  const [approval, setApproval] = useState(false);
  const [days, setDays] = useState<number | null>(7);
  const [maxUses, setMaxUses] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  function reset() {
    setLabel("");
    setProfile("funcionario");
    setApproval(false);
    setDays(7);
    setMaxUses("");
    setCreated(null);
  }

  async function create() {
    setSaving(true);
    try {
      const link = await createInviteLink({
        role: "atendente",
        permissions: [...PROFILE_PRESETS[profile]],
        requiresApproval: approval,
        expiresInDays: days,
        maxUses: maxUses ? Math.max(1, Number(maxUses)) : null,
        label,
      });
      setCreated(link.token);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar o link.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Links de convite" className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Links de convite</h3>
          <p className="text-xs text-muted-foreground">
            Compartilhe o link. Quem abrir cria a conta (ou entra) e confirma a entrada na equipe.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(true);
          }}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-gradient-to-br from-[#6d45d6] to-[#9b7bf0] px-4 py-2 text-sm font-semibold text-white"
        >
          <Link2 className="h-4 w-4" /> Gerar link
        </button>
      </div>

      <ul className="space-y-2">
        {links.map((link) => {
          const status = linkStatus(link);
          return (
            <li
              key={link.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm"
            >
              <span className="min-w-0">
                <b className="block truncate">{link.label ?? "Link de convite"}</b>
                <span className="block text-xs text-muted-foreground">
                  {status} · {link.uses}
                  {link.max_uses ? `/${link.max_uses}` : ""} usos
                  {link.requires_approval ? " · com aprovação" : ""}
                  {link.expires_at
                    ? ` · até ${new Date(link.expires_at).toLocaleDateString("pt-BR")}`
                    : " · sem prazo"}
                </span>
              </span>
              {status === "Ativo" && (
                <span className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-border px-3 py-1.5"
                    aria-label={`Copiar ${link.label ?? "link"}`}
                    onClick={() => void copy(link.token)}
                  >
                    Copiar
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-border px-3 py-1.5"
                    aria-label={`Revogar ${link.label ?? "link"}`}
                    onClick={async () => {
                      await revokeInviteLink(link.id);
                      onChanged();
                    }}
                  >
                    Revogar
                  </button>
                </span>
              )}
            </li>
          );
        })}
        {!links.length && (
          <li className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
            Nenhum link criado ainda.
          </li>
        )}
      </ul>

      <LumePopup
        open={open}
        title={created ? "Link pronto" : "Gerar link de convite"}
        description={
          created
            ? "Envie para quem vai entrar na equipe."
            : "Defina o perfil de quem entra e por quanto tempo o link vale."
        }
        onClose={() => setOpen(false)}
        footer={
          created ? (
            <button type="button" className="lq-primary ml-auto" onClick={() => setOpen(false)}>
              Concluir
            </button>
          ) : (
            <>
              <button type="button" className="lq-secondary" onClick={() => setOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="lq-primary ml-auto"
                disabled={saving}
                onClick={() => void create()}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Criar link
              </button>
            </>
          )
        }
      >
        {created ? (
          <div className="ts-link-url">
            <span className="min-w-0 flex-1">{inviteLinkUrl(created)}</span>
            <button type="button" aria-label="Copiar link" onClick={() => void copy(created)}>
              <Copy className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <section className="lq-section">
              <label className="block min-w-0">
                <span className="lq-field-label">Nome do link</span>
                <input
                  className="quote-form-input"
                  value={label}
                  maxLength={60}
                  placeholder="Ex.: Equipe de vendas"
                  onChange={(event) => setLabel(event.target.value)}
                />
              </label>
            </section>
            <section className="lq-section">
              <h3 className="lq-section-title">Perfil de quem entra</h3>
              <div
                className="lq-chips lq-chips-lg"
                role="radiogroup"
                aria-label="Perfil de quem entra"
              >
                {(["funcionario", "gestor_agenda"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={profile === key}
                    onClick={() => setProfile(key)}
                  >
                    {PROFILE_LABEL[key]}
                  </button>
                ))}
              </div>
            </section>
            <section className="lq-section">
              <ul className="ts-perm-list">
                <li>
                  <span>
                    Exigir minha aprovação
                    <small>Quem entrar fica aguardando até você aprovar.</small>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    className="ts-switch"
                    aria-label="Exigir minha aprovação"
                    aria-checked={approval}
                    onClick={() => setApproval(!approval)}
                  />
                </li>
              </ul>
            </section>
            <section className="lq-section">
              <h3 className="lq-section-title">Validade</h3>
              <div className="lq-chips" role="radiogroup" aria-label="Validade">
                {VALIDITY.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    role="radio"
                    aria-checked={days === item.days}
                    onClick={() => setDays(item.days)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <label className="mt-4 block min-w-0">
                <span className="lq-field-label">Limite de usos (vazio = sem limite)</span>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className="quote-form-input"
                  value={maxUses}
                  onChange={(event) => setMaxUses(event.target.value)}
                />
              </label>
            </section>
          </>
        )}
      </LumePopup>
    </section>
  );
}
