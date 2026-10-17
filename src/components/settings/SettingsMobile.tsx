// Configurações no celular — navegação em pilha, como os apps do ChatGPT e do
// Claude: uma lista de seções agrupadas (ícone, nome, descrição e seta) e, ao
// tocar, a seção abre em tela cheia com "voltar". Nada de abas rolando de lado.

import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, LogOut, Search, X, type LucideIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { closeSettings, setSettingsTab, type SettingsTab } from "@/lib/settings-dialog";

export interface MobileSettingsItem {
  value: SettingsTab;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Cor do quadradinho do ícone. */
  tone: string;
  group: string;
  keywords: string;
}

export function SettingsMobile({
  items,
  tab,
  initialDetail,
  render,
}: {
  items: MobileSettingsItem[];
  tab: SettingsTab;
  /** Abriu já numa seção (openSettings("conexoes")): começa no detalhe. */
  initialDetail: boolean;
  render: (tab: SettingsTab) => React.ReactNode;
}) {
  const { user, profile, company, signOut } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(initialDetail);
  const [query, setQuery] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  // Cada seção abre do topo.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [detail, tab]);

  const current = items.find((item) => item.value === tab) ?? items[0];
  const q = normalize(query.trim());
  const visible = q
    ? items.filter((item) => normalize(`${item.label} ${item.hint} ${item.keywords}`).includes(q))
    : items;
  const groups = [...new Set(visible.map((item) => item.group))];

  const name = profile?.display_name ?? user?.email?.split("@")[0] ?? "Visitante";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  const open = (value: SettingsTab) => {
    setSettingsTab(value);
    setDetail(true);
  };

  return (
    <div className="settings-mobile">
      {/* ── Lista de seções ── */}
      <section
        className="settings-screen"
        data-state={detail ? "behind" : "active"}
        aria-hidden={detail}
        inert={detail}
      >
        <header className="settings-topbar">
          <span className="w-10" />
          <span className="settings-topbar-title">Configurações</span>
          <DialogPrimitive.Close aria-label="Fechar" className="settings-icon-btn">
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        </header>

        <div className="settings-scroll">
          {user && (
            <div className="settings-profile">
              <span className="settings-avatar">{initials || "U"}</span>
              <div className="min-w-0">
                <p className="truncate text-[17px] font-semibold">{name}</p>
                <p className="truncate text-[13px] text-muted-foreground">
                  {[company?.name, user.email].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
          )}

          <label className="settings-search">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="sr-only">Buscar nas configurações</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar configuração"
            />
            {query && (
              <button
                type="button"
                aria-label="Limpar busca"
                onClick={() => setQuery("")}
                className="settings-clear"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>

          {groups.map((group) => (
            <div key={group} className="settings-group">
              <p className="settings-group-title">{group}</p>
              <ul className="settings-list">
                {visible
                  .filter((item) => item.group === group)
                  .map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.value}>
                        <button
                          type="button"
                          className="settings-row"
                          onClick={() => open(item.value)}
                        >
                          <span className="settings-row-icon" style={{ background: item.tone }}>
                            <Icon className="h-[18px] w-[18px]" />
                          </span>
                          <span className="min-w-0 flex-1 text-left">
                            <span className="block truncate text-[15px] font-medium">
                              {item.label}
                            </span>
                            <span className="block truncate text-[12.5px] text-muted-foreground">
                              {item.hint}
                            </span>
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
          {visible.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nada encontrado.</p>
          )}

          {user && (
            <ul className="settings-list mt-6">
              <li>
                <button
                  type="button"
                  className="settings-row text-[var(--status-urgent)]"
                  onClick={async () => {
                    closeSettings();
                    await signOut();
                    window.localStorage.removeItem("atendeai.demo");
                    await navigate({ to: "/", replace: true });
                  }}
                >
                  <span className="settings-row-icon bg-[var(--status-urgent)]/15">
                    <LogOut className="h-[18px] w-[18px]" />
                  </span>
                  <span className="flex-1 text-left text-[15px] font-medium">Sair da conta</span>
                </button>
              </li>
            </ul>
          )}
          <p className="mt-6 pb-2 text-center text-[11px] text-muted-foreground/60">Lume</p>
        </div>
      </section>

      {/* ── Seção aberta ── */}
      <section
        className="settings-screen settings-detail"
        data-state={detail ? "active" : "ahead"}
        aria-hidden={!detail}
        inert={!detail}
      >
        <header className="settings-topbar">
          <button type="button" className="settings-back" onClick={() => setDetail(false)}>
            <ChevronLeft className="h-5 w-5" />
            <span>Voltar</span>
          </button>
          <span className="settings-topbar-title">{current?.label}</span>
          <DialogPrimitive.Close aria-label="Fechar" className="settings-icon-btn">
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        </header>
        <div ref={bodyRef} className={cn("settings-scroll settings-body")}>
          {detail && current ? render(current.value) : null}
        </div>
      </section>
    </div>
  );
}

function normalize(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
