// Aba "Conta" — dados de acesso e vínculo: e-mail (só leitura), telefone
// (editável), empresa, função na equipe e quem mais está na equipe.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Building2,
  CalendarDays,
  Check,
  Copy,
  Loader2,
  Mail,
  Phone,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useTeamAccess } from "@/hooks/useTeamAccess";
import { supabase } from "@/integrations/supabase/client";
import { PROFILE_LABEL, presetOf } from "@/lib/team/permissions";
import { formatPhone, initialsOf, updateProfile } from "@/lib/profile-media";
import { SettingsTabHeader } from "./settings-ui";
import "./profile.css";

interface Teammate {
  id: string;
  display_name: string | null;
  avatar_url?: string | null;
}

export function AccountTab() {
  const { user, profile, company, refreshProfile } = useAuth();
  const team = useTeamAccess();
  const savedPhone = profile?.phone ?? "";
  const [phone, setPhone] = useState(formatPhone(savedPhone));
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => setPhone(formatPhone(savedPhone)), [savedPhone]);

  const teammates = useQuery({
    queryKey: ["account-teammates", profile?.company_id],
    enabled: !!profile?.company_id,
    queryFn: async (): Promise<Teammate[]> => {
      const base = supabase.from("profiles") as unknown as {
        select: (c: string) => {
          eq: (
            c: string,
            v: string,
          ) => PromiseLike<{ data: Teammate[] | null; error: { message: string } | null }>;
        };
      };
      const withAvatar = await base
        .select("id, display_name, avatar_url")
        .eq("company_id", profile!.company_id);
      if (!withAvatar.error) return withAvatar.data ?? [];
      const plain = await base.select("id, display_name").eq("company_id", profile!.company_id);
      return plain.data ?? [];
    },
    staleTime: 60_000,
  });

  const email = user?.email ?? profile?.email ?? "—";
  const digits = phone.replace(/\D/g, "");
  const phoneDirty = digits !== savedPhone.replace(/\D/g, "");
  const roleLabel = team.access?.role
    ? PROFILE_LABEL[presetOf(team.access.permissions, team.access.role)]
    : null;
  const since = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
      })
    : null;
  const people = teammates.data ?? [];

  const savePhone = async () => {
    if (!user) return;
    if (digits && (digits.length < 10 || digits.length > 13)) {
      toast.error("Telefone incompleto. Use DDD + número.");
      return;
    }
    setSaving(true);
    try {
      await updateProfile(user.id, { phone: digits ? formatPhone(digits) : null });
      await refreshProfile();
      toast.success("Telefone salvo");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar o telefone.");
    } finally {
      setSaving(false);
    }
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sem permissão de área de transferência */
    }
  };

  return (
    <>
      <div className="hidden md:block">
        <SettingsTabHeader title="Conta" />
      </div>

      <p className="account-section-title">Acesso</p>
      <ul className="settings-list">
        <li>
          <div className="settings-row">
            <RowIcon icon={Mail} tone="#2563eb" />
            <span className="min-w-0 flex-1">
              <span className="account-label">E-mail</span>
              <span className="block truncate text-[15px] font-medium">{email}</span>
            </span>
            <button
              type="button"
              className="settings-icon-btn"
              onClick={copyEmail}
              aria-label="Copiar e-mail"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
        </li>
        <li>
          <label className="settings-row">
            <RowIcon icon={Phone} tone="#16a34a" />
            <span className="min-w-0 flex-1">
              <span className="account-label">Telefone</span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="(11) 91234-5678"
                className="account-input"
              />
            </span>
            {phoneDirty && (
              <button type="button" className="account-save" onClick={savePhone} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
              </button>
            )}
          </label>
        </li>
      </ul>
      <p className="account-help">O e-mail é usado para entrar e não pode ser alterado aqui.</p>

      <p className="account-section-title">Empresa e equipe</p>
      <ul className="settings-list">
        <li>
          <div className="settings-row">
            <RowIcon icon={Building2} tone="#7c3aed" />
            <span className="min-w-0 flex-1">
              <span className="account-label">Empresa</span>
              <span className="block truncate text-[15px] font-medium">
                {company?.name ?? "Sem empresa vinculada"}
              </span>
            </span>
          </div>
        </li>
        <li>
          <div className="settings-row">
            <RowIcon icon={ShieldCheck} tone="#0d9488" />
            <span className="min-w-0 flex-1">
              <span className="account-label">Função na equipe</span>
              <span className="block truncate text-[15px] font-medium">
                {roleLabel ?? (team.isLoading ? "Carregando…" : "—")}
              </span>
            </span>
            {team.access && !team.access.active && <span className="account-badge">Pendente</span>}
          </div>
        </li>
        <li>
          <div className="settings-row">
            <RowIcon icon={Users} tone="#ea580c" />
            <span className="min-w-0 flex-1">
              <span className="account-label">Equipe</span>
              <span className="block truncate text-[15px] font-medium">
                {teammates.isLoading
                  ? "Carregando…"
                  : `${people.length} ${people.length === 1 ? "pessoa" : "pessoas"}`}
              </span>
            </span>
            <span className="account-stack" aria-hidden>
              {people.slice(0, 4).map((p) => (
                <span key={p.id} className="account-stack-item">
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" />
                  ) : (
                    initialsOf(p.display_name ?? "")
                  )}
                </span>
              ))}
              {people.length > 4 && (
                <span className="account-stack-item is-more">+{people.length - 4}</span>
              )}
            </span>
          </div>
        </li>
        {since && (
          <li>
            <div className="settings-row">
              <RowIcon icon={CalendarDays} tone="#64748b" />
              <span className="min-w-0 flex-1">
                <span className="account-label">Membro desde</span>
                <span className="block truncate text-[15px] font-medium first-letter:uppercase">
                  {since}
                </span>
              </span>
            </div>
          </li>
        )}
      </ul>
    </>
  );
}

function RowIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: string }) {
  return (
    <span className="settings-row-icon" style={{ background: tone }}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}
