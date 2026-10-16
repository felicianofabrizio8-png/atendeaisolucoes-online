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
  Activity,
  Crown,
  Rocket,
  Gauge,
  PanelLeftClose,
  PanelLeftOpen,
  Brain,
  Wand2,
  Bot,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  getAppearance,
  getServerAppearance,
  subscribeAppearance,
  toggleSidebar,
} from "@/lib/appearance";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { loadRemote, refreshTeamScope, setRepoMode, subscribeRepo, getConversations } from "@/data/leadRepo";
import { loadProductsRemote, setProductsMode } from "@/data/products";
import { loadQuotesRemote, setQuotesMode } from "@/data/quotes";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { NotificationBridge } from "@/components/NotificationBridge";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { openSettings } from "@/lib/settings-dialog";
import { useTeamAccess } from "@/hooks/useTeamAccess";
import { AccessDenied } from "@/components/team/AccessDenied";
import { NeuralIntelligencePanel } from "@/components/sidebar/NeuralIntelligencePanel";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { LumeLogo } from "@/components/brand/LumeLogo";

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
  /** Grupo no menu em grade do mobile. */
  group: NavGroup;
};

type NavGroup = "Principal" | "Vendas" | "Marketing e IA" | "Sistema";
const NAV_GROUPS: NavGroup[] = ["Principal", "Vendas", "Marketing e IA", "Sistema"];

const nav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, group: "Principal" },
  { to: "/onboarding", label: "Primeiros passos", icon: Rocket, adminOnly: true, group: "Sistema" },
  { to: "/inbox", label: "Caixa de atendimento", icon: MessageSquare, group: "Principal" },
  { to: "/atendimento", label: "Chat", icon: MessagesSquare, group: "Principal" },
  { to: "/agenda", label: "Agenda", icon: Calendar, group: "Principal" },
  { to: "/orcamentos", label: "Orçamentos", icon: FileText, group: "Vendas" },
  { to: "/campanhas", label: "Campanhas", icon: Megaphone, group: "Marketing e IA" },
  { to: "/criativos", label: "Criativos IA", icon: Wand2, group: "Marketing e IA" },
  { to: "/marketing", label: "Marketing IA", icon: Sparkles, group: "Marketing e IA" },
  { to: "/produtos", label: "Produtos", icon: Package, group: "Vendas" },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3, group: "Vendas" },
  { to: "/executivo", label: "Executivo", icon: Crown, adminOnly: true, group: "Vendas" },
  { to: "/ia", label: "IA de Atendimento", icon: Bot, group: "Marketing e IA" },
  { to: "/saude", label: "Saúde do sistema", icon: Activity, group: "Sistema" },
  { to: "/runtime/observability", label: "Observabilidade", icon: Gauge, adminOnly: true, group: "Sistema" },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, company, signOut } = useAuth();
  const access = useTeamAccess();
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
    if (user && profile && access.access?.active) {
      window.localStorage.removeItem("atendeai.demo");
      setDemoMode(false);
      if (access.can("conversations.read")) loadRemote(profile.company_id).catch((e) => console.error("loadRemote failed", e));
      else setRepoMode("demo");
      if (access.can("products.view")) loadProductsRemote(profile.company_id).catch((e) =>
        console.error("loadProductsRemote failed", e),
      );
      else setProductsMode("demo");
      if (access.can("quotes.manage")) loadQuotesRemote(profile.company_id).catch((e) =>
        console.error("loadQuotesRemote failed", e),
      );
      else setQuotesMode("demo");
    } else {
      setRepoMode("demo");
      setProductsMode("demo");
      setQuotesMode("demo");
    }
  }, [user, profile, access.access]);

  useEffect(() => {
    if (!profile || !access.can("conversations.read") || !access.access?.schemaReady) return;
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try { await refreshTeamScope(profile.company_id); }
      catch (error) { console.error("team scope refresh failed", error); }
      finally { running = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [profile, access.access]);

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
    await navigate({ to: "/", replace: true });
  };

  const enableDemo = () => {
    window.localStorage.setItem("atendeai.demo", "1");
    setDemoMode(true);
  };

  const leaveDemoForAuth = () => {
    window.localStorage.removeItem("atendeai.demo");
    setDemoMode(false);
    window.location.replace("/");
  };

  const handleOpenSettings = () => {
    setMobileOpen(false);
    openSettings();
  };

  // Menu em grade do mobile: mesmos itens e permissões da sidebar, agrupados.
  // `order` corre por todos os grupos e escalona a entrada dos blocos.
  let launcherOrder = 0;
  const launcherGroups = NAV_GROUPS.map((group) => ({
    group,
    items: nav
      .filter((item) => item.group === group && ((!user && demoMode) || access.canOpen(item.to)))
      .map((item) => ({ item, order: launcherOrder++ })),
  })).filter((g) => g.items.length > 0);

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
        .filter((item) => (!user && demoMode) || access.canOpen(item.to))
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
              onClick={leaveDemoForAuth}
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
              onClick={leaveDemoForAuth}
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
      <LumeLogo
        variant="lockup"
        aria-label="Lume"
        className={cn(
          "h-8 w-[116px] text-sidebar-foreground",
          collapsible && "sidebar-when-expanded",
        )}
      />
      {collapsible && (
        <LumeLogo
          variant="mark"
          aria-label="Lume"
          className="sidebar-when-collapsed h-8 w-8 text-sidebar-foreground"
        />
      )}
      <div className={cn("flex-1 min-w-0", collapsible && "sidebar-when-expanded")} />
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
            {access.can("ai.manage") && <NeuralIntelligencePanel />}
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
        {/* Topbar mobile — marca à esquerda, conta à direita. O avatar abre
            o mesmo menu em grade da barra inferior; é o caminho para o menu
            nas rotas em que a barra inferior não aparece (conversa aberta). */}
        <div className="md:hidden safe-top px-3 border-b border-border/70 flex items-center gap-2 bg-sidebar shrink-0">
          <div className="h-14 flex items-center gap-1 w-full">
            <Link to="/" aria-label="Lume — início" className="flex items-center min-w-0 flex-1 pl-1">
              <LumeLogo
                variant="lockup"
                aria-label="Lume"
                className="h-7 w-[98px] text-sidebar-foreground"
              />
            </Link>
            <button
              onClick={handleOpenSettings}
              aria-label="Configurações"
              className="h-11 w-11 inline-flex items-center justify-center rounded-full text-muted-foreground active:bg-accent"
            >
              <Settings className="h-[18px] w-[18px]" />
            </button>
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu"
              aria-expanded={mobileOpen}
              className="h-11 w-11 inline-flex items-center justify-center rounded-full active:bg-accent"
            >
              <span
                className={cn(
                  "h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-semibold",
                  user ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {user ? initials || "U" : "DM"}
              </span>
            </button>
          </div>
        </div>

        {/* Menu completo no mobile: folha que sobe de baixo (alcance do
            polegar) com os destinos em grade, agrupados — o mesmo acesso da
            sidebar do desktop, filtrado pelas mesmas permissões. */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="bottom"
            mobileFullscreen={false}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="mobile-launcher md:hidden max-h-[88dvh] rounded-t-[28px] border-sidebar-border bg-sidebar p-0 flex flex-col gap-0"
          >
            <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
            <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />

            <div className="flex items-center gap-3 px-5 pt-3 pb-4 pr-14">
              <div
                className={cn(
                  "h-11 w-11 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold",
                  user ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {user ? initials || "U" : "DM"}
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[15px] font-semibold">
                  {user ? (profile?.display_name ?? user.email?.split("@")[0]) : "Visitante"}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {user ? (company?.name ?? "Carregando…") : "Modo demo · dados de exemplo"}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
              {launcherGroups.map(({ group, items }) => (
                <section key={group} className="mb-4">
                  <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {group}
                  </h3>
                  <div className="grid grid-cols-4 gap-2">
                    {items.map(({ item, order }) => {
                      const Icon = item.icon;
                      const active =
                        item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
                      const badge = item.to === "/inbox" && unreadTotal > 0 ? unreadTotal : 0;
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          aria-current={active ? "page" : undefined}
                          data-active={active || undefined}
                          className="launcher-tile"
                          style={{ "--i": order } as CSSProperties}
                        >
                          <span className="launcher-tile-icon">
                            <Icon className="h-[22px] w-[22px]" aria-hidden />
                            {badge ? (
                              <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-[var(--status-urgent)] px-1 text-center text-[9px] font-bold leading-4 text-[var(--status-urgent-foreground)] ring-2 ring-sidebar">
                                {badge > 99 ? "99+" : badge}
                              </span>
                            ) : null}
                          </span>
                          <span className="launcher-tile-label">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}

              {access.can("ai.manage") && (
                <div className="mb-4 overflow-hidden rounded-2xl border border-sidebar-border">
                  <NeuralIntelligencePanel />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleOpenSettings}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-sidebar-accent text-sm font-medium"
                >
                  <Settings className="h-4 w-4" />
                  Configurações
                </button>
                {user ? (
                  <button
                    onClick={handleSignOut}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-sidebar-accent text-sm font-medium text-muted-foreground"
                  >
                    <LogOut className="h-4 w-4" />
                    Sair
                  </button>
                ) : (
                  <button
                    onClick={leaveDemoForAuth}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-medium text-primary-foreground"
                  >
                    <LogIn className="h-4 w-4" />
                    Entrar
                  </button>
                )}
              </div>
              {!user && !demoMode && (
                <button
                  onClick={enableDemo}
                  className="mt-3 w-full text-xs text-muted-foreground underline underline-offset-2"
                >
                  Continuar como demo
                </button>
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/*
          Na conversa o scroll pertence exclusivamente à lista de mensagens:
          `overflow-hidden` aqui elimina a rolagem dupla (shell + Virtuoso) que
          fazia o cabeçalho e o composer saírem da tela ao arrastar.
        */}
        <div
          className={
            "app-content flex-1 min-w-0 min-h-0 flex flex-col md:pb-0 " +
            (showBottomNav
              ? "overflow-auto pb-[var(--mobile-dock-space)]"
              : "overflow-hidden pb-0")
          }
        >
          {(!user && demoMode) || access.canOpen(location.pathname) ? <Outlet /> : <AccessDenied access={access} />}
        </div>

        {showBottomNav ? (
          <MobileBottomNav
            unreadTotal={unreadTotal}
            menuOpen={mobileOpen}
            onOpenMenu={() => setMobileOpen(true)}
            canOpen={(to) => (!user && demoMode) || access.canOpen(to)}
          />
        ) : null}
      </main>
    </div>
  );
}
