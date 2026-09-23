// Popup de Configurações — aberto pela engrenagem ao lado do perfil.
// Menu lateral com busca + conteúdo da aba ativa; fundo com blur suave.

import { useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  MessageSquareText,
  Palette,
  Plug,
  Search,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  closeSettings,
  setSettingsTab,
  useSettingsDialog,
  type SettingsTab,
} from "@/lib/settings-dialog";
import { UsersTab } from "./UsersTab";
import { AppearanceTab } from "./AppearanceTab";
import { ServiceTab } from "./ServiceTab";
import { ConnectionsTab } from "./ConnectionsTab";
import { PrivacyTab } from "./PrivacyTab";

const TABS: Array<{
  value: SettingsTab;
  label: string;
  icon: LucideIcon;
  /** Termos extras usados pela busca. */
  keywords: string;
}> = [
  {
    value: "usuarios",
    label: "Usuários e Permissões",
    icon: Users,
    keywords: "convite papel admin atendente financeiro equipe acesso",
  },
  {
    value: "aparencia",
    label: "Aparência",
    icon: Palette,
    keywords: "tema preto escuro claro cor destaque fonte tipografia",
  },
  {
    value: "atendimento",
    label: "Atendimento",
    icon: MessageSquareText,
    keywords: "respostas rápidas notificações som sla tempo resposta motivos perda localização",
  },
  {
    value: "conexoes",
    label: "Conexões",
    icon: Plug,
    keywords: "integrações meta whatsapp instagram facebook canais token webhook",
  },
  {
    value: "privacidade",
    label: "Privacidade",
    icon: ShieldCheck,
    keywords: "dados segurança consentimento lgpd",
  },
];

const TAB_CONTENT: Record<SettingsTab, () => React.JSX.Element> = {
  usuarios: UsersTab,
  aparencia: AppearanceTab,
  atendimento: ServiceTab,
  conexoes: ConnectionsTab,
  privacidade: PrivacyTab,
};

function normalize(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function SettingsDialog() {
  const { open, tab } = useSettingsDialog();
  const [query, setQuery] = useState("");

  const visibleTabs = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return TABS;
    return TABS.filter((t) => normalize(`${t.label} ${t.keywords}`).includes(q));
  }, [query]);

  const Content = TAB_CONTENT[tab];

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          closeSettings();
          setQuery("");
        }
      }}
    >
      <DialogPrimitive.Portal>
        {/* Conteúdo dentro do overlay (centralizado sem transform) para que os
            modais internos das abas, com `position: fixed`, cubram a tela toda. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center sm:p-6 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0">
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="relative flex flex-col md:flex-row w-full h-[100dvh] sm:h-[min(820px,calc(100dvh-3rem))] sm:max-w-5xl sm:rounded-xl border-border sm:border bg-background text-foreground shadow-2xl overflow-hidden focus:outline-none"
          >
            <DialogPrimitive.Title className="sr-only">Configurações</DialogPrimitive.Title>

            {/* Menu lateral */}
            <aside className="md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-border bg-sidebar/60 p-3 md:p-4 flex flex-col gap-3 md:gap-4">
              <div className="relative pr-10 md:pr-0">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && visibleTabs[0]) setSettingsTab(visibleTabs[0].value);
                  }}
                  placeholder="Buscar"
                  className="w-full h-9 rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="min-h-0">
                <div className="hidden md:block px-2 mb-1.5 text-[11px] font-medium text-muted-foreground">
                  Configurações
                </div>
                <nav className="flex md:flex-col gap-0.5 overflow-x-auto scrollbar-none -mx-1 px-1">
                  {visibleTabs.map((t) => {
                    const Icon = t.icon;
                    const active = t.value === tab;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setSettingsTab(t.value)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm whitespace-nowrap transition-colors text-left",
                          active
                            ? "bg-accent text-accent-foreground font-medium"
                            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {t.label}
                      </button>
                    );
                  })}
                  {visibleTabs.length === 0 && (
                    <p className="px-2.5 py-2 text-xs text-muted-foreground">Nada encontrado.</p>
                  )}
                </nav>
              </div>
            </aside>

            {/* Conteúdo da aba */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="p-4 sm:p-6 md:p-8 md:pr-14 max-w-3xl">
                <Content />
              </div>
            </div>

            <DialogPrimitive.Close
              aria-label="Fechar"
              className="absolute right-3 top-3 md:right-4 md:top-4 h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
