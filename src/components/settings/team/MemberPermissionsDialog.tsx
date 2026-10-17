import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { LumePopup } from "@/components/team/LumePopup";
import {
  ADMIN_ONLY_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_GROUPS,
  PROFILE_LABEL,
  PROFILE_PRESETS,
  presetOf,
  type Permission,
  type TeamRole,
} from "@/lib/team/permissions";
import type { TeamUser } from "@/lib/users.functions";
import "./team-settings.css";

/** Permissões de uma pessoa: perfil pronto ou ajuste fino por módulo. */
export function MemberPermissionsDialog({
  member,
  self,
  onClose,
  onSave,
}: {
  member: TeamUser | null;
  self: boolean;
  onClose: () => void;
  onSave: (data: Pick<TeamUser, "id" | "role" | "active" | "permissions">) => Promise<void>;
}) {
  const [role, setRole] = useState<TeamRole | null>("atendente");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!member) return;
    setRole(member.role ?? "atendente");
    setPermissions([...member.permissions]);
    setActive(member.active);
  }, [member]);

  const preset = presetOf(permissions, role);
  const choose = (next: "funcionario" | "gestor_agenda" | "admin") => {
    if (next === "admin") return setRole("admin");
    setRole("atendente");
    setPermissions([...PROFILE_PRESETS[next]]);
  };
  const toggle = (key: Permission) =>
    setPermissions((list) =>
      list.includes(key) ? list.filter((item) => item !== key) : [...list, key],
    );

  async function save() {
    if (!member) return;
    setSaving(true);
    try {
      await onSave({ id: member.id, role, active, permissions });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <LumePopup
      open={!!member}
      size="lg"
      title={member?.displayName || member?.email || "Permissões"}
      description={member?.email ?? undefined}
      onClose={onClose}
      footer={
        <>
          <p className="lq-foot-note">{PROFILE_LABEL[preset]}</p>
          <button
            type="button"
            className="lq-primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar
          </button>
        </>
      }
    >
      <section className="lq-section">
        <h3 className="lq-section-title">Perfil</h3>
        <div className="lq-chips lq-chips-lg" role="radiogroup" aria-label="Perfil">
          {(["funcionario", "gestor_agenda", "admin"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={preset === key}
              disabled={self && key !== "admin"}
              onClick={() => choose(key)}
            >
              {PROFILE_LABEL[key]}
            </button>
          ))}
          {preset === "personalizado" && (
            <button type="button" role="radio" aria-checked disabled>
              Personalizado
            </button>
          )}
        </div>
      </section>

      {role === "admin" ? (
        <p className="ts-note">
          Administradores têm acesso completo e gerenciam a equipe. A empresa sempre precisa de um
          administrador ativo.
        </p>
      ) : (
        PERMISSION_GROUPS.map((group) => (
          <section key={group.module} className="lq-section">
            <h3 className="lq-section-title">{group.module}</h3>
            <ul className="ts-perm-list">
              {group.items.map((item) => {
                const locked = ADMIN_ONLY_PERMISSIONS.includes(item.key);
                const on = permissions.includes(item.key);
                return (
                  <li key={item.key}>
                    <span>
                      {PERMISSIONS[item.key]}
                      <small>{locked ? "Só administradores." : item.hint}</small>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      className="ts-switch"
                      aria-label={PERMISSIONS[item.key]}
                      aria-checked={on}
                      disabled={locked}
                      onClick={() => toggle(item.key)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <section className="lq-section">
        <ul className="ts-perm-list">
          <li>
            <span>
              Acesso ativo
              <small>
                {self
                  ? "Você não pode desativar a própria conta."
                  : "Desativar libera os atendimentos dela."}
              </small>
            </span>
            <button
              type="button"
              role="switch"
              className="ts-switch"
              aria-label="Acesso ativo"
              aria-checked={active}
              disabled={self}
              onClick={() => setActive(!active)}
            />
          </li>
        </ul>
      </section>
    </LumePopup>
  );
}
