import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  MessageSquare,
  MessagesSquare,
  Calendar,
  FileText,
  Package,
  BarChart3,
  Settings,
  Sparkles,
  Megaphone,
  LogOut,
  LogIn,
  Menu,
  Activity,
  Crown,
  Rocket,
  Gauge,
  PanelLeftClose,
  PanelLeftOpen,
  Brain,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getAppearance,
  getServerAppearance,
  subscribeAppearance,
  toggleSidebar,
} from "@/lib/appearance";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { loadRemote, setRepoMode, subscribeRepo, getConversations } from "@/data/leadRepo";
import { loadProductsRemote, setProductsMode } from "@/data/products";
import { loadQuotesRemote, setQuotesMode } from "@/data/quotes";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { NotificationBridge } from "@/components/NotificationBridge";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { openSettings } from "@/lib/settings-dialog";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { NeuralIntelligencePanel } from "@/components/sidebar/NeuralIntelligencePanel";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";

type NavItem = {
  to:
    | "/"
    | "/inbox"
    | "/atendimento"
    | "/agenda"
    | "/orcamentos"
    | "/produtos"
    | "/relatorios"
    | "/executivo"
    | "/ia"
    | "/campanhas"
    | "/criativos"
    | "/marketing"
    | "/saude"
    | "/onboarding"
    | "/runtime/observability";
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
  adminOnly?: boolean;
};

const nav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/onboarding", label: "Primeiros passos", icon: Rocket, adminOnly: true },
  { to: "/inbox", label: "Caixa de atendimento", icon: MessageSquare },
  { to: "/atendimento", label: "Atendimento 2.0", icon: MessagesSquare },
  { to: "/agenda", label: "Agenda", icon: Calendar },
  { to: "/orcamentos", label: "Orçamentos", icon: FileText },
  { to: "/campanhas", label: "Campanhas", icon: Megaphone },
  { to: "/criativos", label: "Criativos IA", icon: Sparkles },
  { to: "/marketing", label: "Marketing IA", icon: Sparkles },
  { to: "/produtos", label: "Produtos", icon: Package },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/executivo", label: "Executivo", icon: Crown, adminOnly: true },
  { to: "/ia", label: "IA de Atendimento", icon: Sparkles },
  { to: "/saude", label: "Saúde do sistema", icon: Activity },
  { to: "/runtime/observability", label: "Observabilidade", icon: Gauge, adminOnly: true },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, company, signOut } = useAuth();
  const { isAdmin } = useIsAdmin();
  const [demoMode, setDemoMode] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState(0);
  // Mesma preferência de tema/cor/fonte: guardada por navegador e já aplicada
  // ao <html> antes da hidratação. Aqui o estado serve só para o que o CSS não
  // resolve sozinho — rótulo do botão, aria e ligar os tooltips do trilho.
  const appearance = useSyncExternalStore(subscribeAppearance, getAppearance, getServerAppearance);
  const sidebarCollapsed = appearance.sidebar === "collapsed";

  // Fase 5.2 — decisão de layout (opção A): dentro de uma conversa aberta o
  // rodapé pertence ao composer. Duas barras fixas competindo pelo mesmo
  // espaço custam ~60px do histórico, empurram o campo de texto para fora do
  // alcance confortável do polegar e brigam com o teclado virtual. A lista
  // (/inbox) mantém a navegação inferior normalmente.
  const isConversationRoute = /^\/inbox\/[^/]+$/.test(location.pathname);
  const showBottomNav = !isConversationRoute;

  // Contador de não-lidas agregadas — usado no item "Caixa de atendimento".
  useEffect(() => {
    const recompute = () => {
      const total = getConversations().reduce((s, c) => s + (c.unread || 0), 0);
      setUnreadTotal(total);
    };
    recompute();
    return subscribeRepo(recompute);
  }, []);

  // Detecta modo demo do localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    setDemoMode(window.localStorage.getItem("atendeai.demo") === "1");
  }, [user]);

  // Fecha o menu mobile ao navegar
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Quando logar, carrega dados reais e desativa demo. Quando deslogar/demo, volta pro mock.
  useEffect(() => {
    if (user && profile) {
      window.localStorage.removeItem("atendeai.demo");
      setDemoMode(false);
      loadRemote(profile.company_id).catch((e) => console.error("loadRemote failed", e));
      loadProductsRemote(profile.company_id).catch((e) =>
        console.error("loadProductsRemote failed", e),
      );
      loadQuotesRemote(profile.company_id).catch((e) =>
        console.error("loadQuotesRemote failed", e),
      );
    } else {
      setRepoMode("demo");
      setProductsMode("demo");
      setQuotesMode("demo");
    }
  }, [user, profile]);

  // /login não usa o shell.
  // /login e o callback OAuth Meta não usam o shell (callback roda em popup).
  if (location.pathname === "/login" || location.pathname.startsWith("/auth/")) {
    return <Outlet />;
  }

  const initials = (profile?.display_name ?? user?.email ?? "DM")
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  const handleSignOut = async () => {
    await signOut();
    window.localStorage.removeItem("atendeai.demo");
    navigate({ to: "/login" });
  };

  const enableDemo = () => {
    window.localStorage.setItem("atendeai.demo", "1");
    setDemoMode(true);
  };

  const handleOpenSettings = () => {
    setMobileOpen(false);
    openSettings();
  };

  const SettingsButton = (
    <button
      onClick={handleOpenSettings}
      title="Configurações"
      aria-label="Configurações"
      className="p-1.5 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground"
    >
      <Settings className="h-4 w-4" />
    </button>
  );

  const SignOutButton = user ? (
    <button
      onClick={handleSignOut}
      title="Sair"
      aria-label="Sair"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      <LogOut className="h-4 w-4" />
    </button>
  ) : null;

  // `collapsible` só é true na sidebar de desktop. A gaveta mobile reaproveita
  // exatamente esta lista, mas lá o trilho de ícones não faz sentido: a gaveta
  // já abre em cima do conteúdo e tem largura de sobra.
  const renderNavList = (collapsible: boolean) => (
    <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
      {nav
        .filter((item) => !item.adminOnly || isAdmin)
        .map((item) => {
          const Icon = item.icon;
          const active =
            item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
          const dynamicBadge = item.to === "/inbox" && unreadTotal > 0 ? unreadTotal : item.badge;
          const link = (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              className={cn(
                "sidebar-row flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm transition-colors",
                "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                // Sem o rótulo, o item ativo perderia metade das pistas. A
                // barra à esquerda devolve o "você está aqui" no trilho.
                active &&
                  "bg-sidebar-accent text-sidebar-accent-foreground font-medium relative before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r before:bg-primary",
              )}
            >
              <span className="relative flex shrink-0 items-center justify-center">
                <Icon className="h-4 w-4" />
                {dynamicBadge ? (
                  // No trilho não cabe o número: vira um ponto no canto do ícone.
                  <span className="sidebar-when-collapsed absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--status-urgent)] ring-2 ring-sidebar" />
                ) : null}
              </span>
              <span className="sidebar-when-expanded flex-1">{item.label}</span>
              {dynamicBadge ? (
                <span className="sidebar-when-expanded rounded bg-[var(--status-urgent)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--status-urgent-foreground)]">
                  {dynamicBadge > 99 ? "99+" : dynamicBadge}
                </span>
              ) : null}
            </Link>
          );

          if (!collapsible || !sidebarCollapsed) return link;

          return (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={26}>
                {item.label}
                {dynamicBadge ? ` · ${dynamicBadge > 99 ? "99+" : dynamicBadge}` : ""}
              </TooltipContent>
            </Tooltip>
          );
        })}
    </nav>
  );

  const FooterPanel = (
    <div className="border-t border-sidebar-border p-3">
      {user ? (
        <>
          <div className="sidebar-when-expanded flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary">
              {initials || "U"}
            </div>
            <div className="leading-tight min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
                {profile?.display_name ?? user.email?.split("@")[0]}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {company?.name ?? "Carregando…"}
              </div>
            </div>
            {SettingsButton}
          </div>

          {/* No trilho, conta e ações empilham centralizadas — nenhum controle
              do rodapé fica inacessível quando a sidebar está minimizada. */}
          <div className="sidebar-when-collapsed flex-col items-center gap-2">
            <div
              className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary"
              title={profile?.display_name ?? user.email ?? undefined}
            >
              {initials || "U"}
            </div>
            {SettingsButton}
            {SignOutButton}
          </div>
        </>
      ) : (
        <>
          <div className="sidebar-when-expanded space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                DM
              </div>
              <div className="leading-tight min-w-0 flex-1">
                <div className="text-sm font-medium truncate">Visitante</div>
                <div className="text-[11px] text-muted-foreground truncate">Modo demo</div>
              </div>
              {SettingsButton}
            </div>
            <button
              onClick={() => navigate({ to: "/login" })}
              className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
            >
              <LogIn className="h-3.5 w-3.5" />
              Entrar / Criar conta
            </button>
            {!demoMode && (
              <button
                onClick={enableDemo}
                className="w-full text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                Continuar como demo
              </button>
            )}
          </div>

          <div className="sidebar-when-collapsed flex-col items-center gap-2">
            <div
              className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground"
              title="Visitante · Modo demo"
            >
              DM
            </div>
            {SettingsButton}
            <button
              onClick={() => navigate({ to: "/login" })}
              title="Entrar / Criar conta"
              aria-label="Entrar / Criar conta"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <LogIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );

  // `withSignOut=false` no menu mobile em tela cheia — o botão de fechar
  // do Sheet ocupa o canto superior direito e colidiria com o botão Sair.
  // `collapsible=true` só na sidebar de desktop, a única que minimiza.
  const renderBrand = (withSignOut = true, collapsible = false) => (
    <div className="sidebar-header relative flex h-14 shrink-0 items-center gap-2 px-4 border-b border-sidebar-border">
      <img
        src="/icon-192.png"
        alt="Atende Ai!"
        className="h-8 w-8 shrink-0 drop-shadow-[0_0_10px_rgba(34,211,238,0.35)]"
      />
      <div className={cn("leading-tight flex-1 min-w-0", collapsible && "sidebar-when-expanded")}>
        <div className="text-sm font-semibold truncate">Atende Ai!</div>
        <div className="text-[10px] text-muted-foreground truncate">Vendas que não esperam</div>
      </div>
      {collapsible ? (
        <span className="sidebar-when-expanded">
          <button
            onClick={toggleSidebar}
            aria-label="Minimizar menu"
            aria-expanded={!sidebarCollapsed}
            title="Minimizar menu"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </span>
      ) : null}
      {withSignOut ? (
        <span className={collapsible ? "sidebar-when-expanded" : undefined}>{SignOutButton}</span>
      ) : null}

      {/* Minimizada, a marca continua visível e o controle de expandir aparece
          por cima dela no hover/foco. Assim o trilho de 72px não precisa
          escolher entre mostrar a identidade do app ou o botão. */}
      {collapsible ? (
        <button
          onClick={toggleSidebar}
          aria-label="Expandir menu"
          aria-expanded={!sidebarCollapsed}
          title="Expandir menu"
          className="sidebar-when-collapsed absolute inset-0 items-center justify-center bg-sidebar text-muted-foreground opacity-0 transition-opacity duration-150 hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none"
        >
          <PanelLeftOpen className="h-[18px] w-[18px]" />
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-[100dvh] w-full max-w-[100vw] overflow-hidden bg-background text-foreground">
      <NotificationBridge />
      <SettingsDialog />

      {/* Sidebar desktop — participa do layout (flex), nunca sobrepõe o
          conteúdo. `main` é flex-1, então minimizar devolve a largura para a
          área principal na mesma animação. */}
      <TooltipProvider delayDuration={250}>
        <aside className="app-sidebar hidden md:flex shrink-0 flex-col overflow-x-hidden border-r border-sidebar-border bg-sidebar">
          {renderBrand(true, true)}
          {demoMode && !user && (
            <div className="sidebar-when-expanded mx-2 mt-2 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2 py-1.5 text-[10px] text-primary">
              <div className="font-semibold">Modo demo</div>
              <div className="text-primary/70">Dados de exemplo locais</div>
            </div>
          )}
          {renderNavList(true)}

          <div className="sidebar-when-expanded">
            <NeuralIntelligencePanel />
          </div>
          {/* O painel neural não cabe em 72px. Em vez de sumir sem aviso, vira
              um atalho que reabre a sidebar onde ele mora. */}
          <div className="sidebar-when-collapsed justify-center border-t border-sidebar-border p-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleSidebar}
                  aria-label="Central de Inteligência AI"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                >
                  <Brain className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={26}>
                Central de Inteligência AI
              </TooltipContent>
            </Tooltip>
          </div>

          {FooterPanel}
        </aside>
      </TooltipProvider>

      <main className="flex-1 min-w-0 min-h-0 h-full flex flex-col">
        {/* Topbar mobile */}
        <div className="md:hidden safe-top px-3 border-b border-border flex items-center gap-2 bg-sidebar shrink-0">
          <div className="h-14 flex items-center gap-2 w-full">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <button
                  aria-label="Abrir menu"
                  className="h-11 w-11 inline-flex items-center justify-center rounded-md hover:bg-accent active:bg-accent"
                >
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[85%] max-w-[320px] p-0 flex flex-col bg-sidebar safe-top safe-bottom"
              >
                <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
                {renderBrand(false)}
                {renderNavList(false)}
                <NeuralIntelligencePanel />
                {FooterPanel}
              </SheetContent>
            </Sheet>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <img
                src="/icon-192.png"
                alt="Atende Ai!"
                className="h-7 w-7 shrink-0 drop-shadow-[0_0_8px_rgba(34,211,238,0.35)]"
              />
              <span className="text-sm font-semibold truncate">Atende Ai!</span>
            </div>
            {SignOutButton}
          </div>
        </div>

        {/*
          Na conversa o scroll pertence exclusivamente à lista de mensagens:
          `overflow-hidden` aqui elimina a rolagem dupla (shell + Virtuoso) que
          fazia o cabeçalho e o composer saírem da tela ao arrastar.
        */}
        <div
          className={
            "flex-1 min-w-0 min-h-0 flex flex-col md:pb-0 " +
            (showBottomNav
              ? "overflow-auto pb-[calc(60px+env(safe-area-inset-bottom))]"
              : "overflow-hidden pb-0")
          }
        >
          <Outlet />
        </div>

        {showBottomNav ? (
          <MobileBottomNav unreadTotal={unreadTotal} onOpenMenu={() => setMobileOpen(true)} />
        ) : null}
      </main>
    </div>
  );
}
