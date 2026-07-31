import { forwardRef, useCallback, useRef, type ComponentPropsWithoutRef } from "react";
import type { ItemProps } from "react-virtuoso";
import type { Message } from "@/data/mock";

/**
 * Infraestrutura de instrumentação de scroll da Inbox.
 * Extraída de src/routes/inbox.$conversationId.lazy.tsx (Fase 7.3) sem
 * qualquer alteração de comportamento: mesmas funções, mesma ordem de
 * efeitos colaterais e mesmo estado de módulo compartilhado.
 */

export type InboxScrollTraceReason =
  | "INITIAL_LOAD"
  | "VIRTUOSO_RESTORE"
  | "IMAGE_DECODE"
  | "RESIZE_OBSERVER"
  | "FOLLOW_OUTPUT"
  | "REALTIME"
  | "USER_SCROLL"
  | "SCROLL_CONTROLLER"
  | "RESTORE_POSITION"
  | "OUTRO";

export interface InboxScrollVirtualSnapshot {
  totalItems: number;
  renderedItems: number | null;
  virtualizedItems: number | null;
  firstItemIndex: number | null;
  lastItemIndex: number | null;
  rangeStartIndex: number | null;
  rangeEndIndex: number | null;
}

export interface InboxScrollMetrics extends InboxScrollVirtualSnapshot {
  timestamp: string;
  elapsedMs: number;
  conversationId: string | null;
  scrollTop: number | null;
  scrollHeight: number | null;
  clientHeight: number | null;
  distanceToEnd: number | null;
}

export interface InboxScrollTraceEntry extends InboxScrollMetrics {
  seq: number;
  reason: InboxScrollTraceReason;
  event: string;
  details?: Record<string, unknown>;
}

interface InboxScrollTraceState {
  active: boolean;
  conversationId: string | null;
  startedAt: number;
  seq: number;
  scroller: HTMLElement | null;
  getSnapshot: (() => InboxScrollVirtualSnapshot) | null;
  pendingReason: InboxScrollTraceReason | null;
  pendingReasonUntil: number;
  lastUserInputAt: number;
  restoreScrollTopPatch: (() => void) | null;
  restoreScrollToPatch: (() => void) | null;
  restoreScrollIntoViewPatch: (() => void) | null;
}

declare global {
  interface Window {
    __INBOX_SCROLL_TRACE__?: InboxScrollTraceEntry[];
  }
}

export const INBOX_SCROLL_TRACE_WINDOW_MS = 3000;
export const INBOX_SCROLL_TRACE_SELECTOR = "[data-inbox-virtual-item='true']";

const inboxScrollTraceState: InboxScrollTraceState = {
  active: false,
  conversationId: null,
  startedAt: 0,
  seq: 0,
  scroller: null,
  getSnapshot: null,
  pendingReason: null,
  pendingReasonUntil: 0,
  lastUserInputAt: 0,
  restoreScrollTopPatch: null,
  restoreScrollToPatch: null,
  restoreScrollIntoViewPatch: null,
};

function inboxTraceNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function isInboxScrollTraceActive(): boolean {
  if (typeof window === "undefined") return false;
  if (!inboxScrollTraceState.active) return false;
  return inboxTraceNow() - inboxScrollTraceState.startedAt <= INBOX_SCROLL_TRACE_WINDOW_MS;
}

function readInboxScrollMetrics(): Omit<InboxScrollMetrics, keyof InboxScrollVirtualSnapshot> {
  const scroller = inboxScrollTraceState.scroller;
  const elapsedMs = Math.round(inboxTraceNow() - inboxScrollTraceState.startedAt);
  if (!scroller) {
    return {
      timestamp: new Date().toISOString(),
      elapsedMs,
      conversationId: inboxScrollTraceState.conversationId,
      scrollTop: null,
      scrollHeight: null,
      clientHeight: null,
      distanceToEnd: null,
    };
  }
  const distanceToEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  return {
    timestamp: new Date().toISOString(),
    elapsedMs,
    conversationId: inboxScrollTraceState.conversationId,
    scrollTop: Math.round(scroller.scrollTop),
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    distanceToEnd: Math.round(distanceToEnd),
  };
}

function getInboxVirtualSnapshot(): InboxScrollVirtualSnapshot {
  return (
    inboxScrollTraceState.getSnapshot?.() ?? {
      totalItems: 0,
      renderedItems: null,
      virtualizedItems: null,
      firstItemIndex: null,
      lastItemIndex: null,
      rangeStartIndex: null,
      rangeEndIndex: null,
    }
  );
}

export function traceInboxScroll(
  reason: InboxScrollTraceReason,
  event: string,
  details?: Record<string, unknown>,
) {
  if (!isInboxScrollTraceActive()) return;
  const entry: InboxScrollTraceEntry = {
    seq: ++inboxScrollTraceState.seq,
    reason,
    event,
    ...readInboxScrollMetrics(),
    ...getInboxVirtualSnapshot(),
    ...(details ? { details } : {}),
  };
  window.__INBOX_SCROLL_TRACE__ = window.__INBOX_SCROLL_TRACE__ ?? [];
  window.__INBOX_SCROLL_TRACE__.push(entry);
  // eslint-disable-next-line no-console
  console.debug("[inbox-scroll-trace]", entry);
}

export function markInboxScrollIntent(
  reason: InboxScrollTraceReason,
  event: string,
  details?: Record<string, unknown>,
) {
  inboxScrollTraceState.pendingReason = reason;
  inboxScrollTraceState.pendingReasonUntil = inboxTraceNow() + 1200;
  traceInboxScroll(reason, event, details);
}

export function inferInboxScrollReason(): InboxScrollTraceReason {
  const now = inboxTraceNow();
  if (
    inboxScrollTraceState.pendingReason &&
    now <= inboxScrollTraceState.pendingReasonUntil
  ) {
    return inboxScrollTraceState.pendingReason;
  }
  if (now - inboxScrollTraceState.lastUserInputAt <= 500) return "USER_SCROLL";
  if (now - inboxScrollTraceState.startedAt <= 700) return "INITIAL_LOAD";
  return "OUTRO";
}

// Callback registrado pelo componente para cancelar o bottom-lock inicial
// assim que o usuário interage. Vive no escopo do módulo porque
// `markInboxUserInput` é chamado por wrappers estáticos do scroller.
let inboxBottomLockCancelHandler: ((reason: string) => void) | null = null;

export function setInboxBottomLockCancelHandler(fn: ((reason: string) => void) | null) {
  inboxBottomLockCancelHandler = fn;
}

export function markInboxUserInput(source: string) {
  inboxScrollTraceState.lastUserInputAt = inboxTraceNow();
  traceInboxScroll("USER_SCROLL", "USER_INPUT", { source });
  inboxBottomLockCancelHandler?.(source);
}

function patchInboxScrollerScrollTop(scroller: HTMLElement) {
  inboxScrollTraceState.restoreScrollTopPatch?.();
  inboxScrollTraceState.restoreScrollToPatch?.();
  const descriptor =
    Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop") ??
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");
  if (!descriptor?.get || !descriptor.set) {
    inboxScrollTraceState.restoreScrollTopPatch = null;
    return;
  }
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    enumerable: false,
    get() {
      return descriptor.get?.call(this) ?? 0;
    },
    set(value: number) {
      const before = descriptor.get?.call(this) ?? 0;
      descriptor.set?.call(this, value);
      const after = descriptor.get?.call(this) ?? value;
      traceInboxScroll(inferInboxScrollReason(), "scrollTop_SET", {
        before: Math.round(before),
        assigned: Math.round(value),
        after: Math.round(after),
      });
    },
  });
  inboxScrollTraceState.restoreScrollTopPatch = () => {
    delete (scroller as { scrollTop?: number }).scrollTop;
  };
  const originalScrollTo = scroller.scrollTo.bind(scroller);
  scroller.scrollTo = ((...args: Parameters<HTMLElement["scrollTo"]>) => {
    const before = scroller.scrollTop;
    traceInboxScroll(inferInboxScrollReason(), "scrollTo_CALL", {
      before: Math.round(before),
      args,
    });
    originalScrollTo(...args);
    traceInboxScroll(inferInboxScrollReason(), "scrollTo_AFTER", {
      before: Math.round(before),
      after: Math.round(scroller.scrollTop),
    });
  }) as HTMLElement["scrollTo"];
  inboxScrollTraceState.restoreScrollToPatch = () => {
    scroller.scrollTo = originalScrollTo;
  };
}

function patchInboxScrollIntoView() {
  if (inboxScrollTraceState.restoreScrollIntoViewPatch) return;
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = function patchedScrollIntoView(
    arg?: boolean | ScrollIntoViewOptions,
  ) {
    const element = this as HTMLElement;
    markInboxScrollIntent("USER_SCROLL", "scrollIntoView_CALL", {
      targetId: element.id || null,
      targetTagName: element.tagName,
      targetClassName: element.className || null,
      arg: typeof arg === "boolean" ? arg : arg ? { ...arg } : undefined,
    });
    return originalScrollIntoView.call(this, arg as ScrollIntoViewOptions);
  };
  inboxScrollTraceState.restoreScrollIntoViewPatch = () => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  };
}

export function getInboxScrollTraceScroller(): HTMLElement | null {
  return inboxScrollTraceState.scroller;
}

export function setInboxScrollTraceScroller(scroller: HTMLElement | null) {
  if (inboxScrollTraceState.scroller === scroller) return;
  inboxScrollTraceState.restoreScrollTopPatch?.();
  inboxScrollTraceState.restoreScrollToPatch?.();
  inboxScrollTraceState.restoreScrollTopPatch = null;
  inboxScrollTraceState.restoreScrollToPatch = null;
  inboxScrollTraceState.scroller = scroller;
  if (scroller) {
    patchInboxScrollerScrollTop(scroller);
    traceInboxScroll("INITIAL_LOAD", "SCROLLER_ATTACHED");
  } else {
    traceInboxScroll("OUTRO", "SCROLLER_DETACHED");
  }
}

export function startInboxScrollTrace(
  conversationId: string,
  getSnapshot: () => InboxScrollVirtualSnapshot,
) {
  if (typeof window === "undefined") return;
  inboxScrollTraceState.active = true;
  inboxScrollTraceState.conversationId = conversationId;
  inboxScrollTraceState.startedAt = inboxTraceNow();
  inboxScrollTraceState.seq = 0;
  inboxScrollTraceState.getSnapshot = getSnapshot;
  inboxScrollTraceState.pendingReason = null;
  inboxScrollTraceState.pendingReasonUntil = 0;
  inboxScrollTraceState.lastUserInputAt = 0;
  window.__INBOX_SCROLL_TRACE__ = [];
  patchInboxScrollIntoView();
  traceInboxScroll("INITIAL_LOAD", "TRACE_START", {
    windowMs: INBOX_SCROLL_TRACE_WINDOW_MS,
    restoreStateFromConfigured: false,
  });
  window.setTimeout(() => {
    if (inboxScrollTraceState.conversationId !== conversationId) return;
    traceInboxScroll("OUTRO", "TRACE_END");
    inboxScrollTraceState.active = false;
    inboxScrollTraceState.restoreScrollIntoViewPatch?.();
    inboxScrollTraceState.restoreScrollIntoViewPatch = null;
  }, INBOX_SCROLL_TRACE_WINDOW_MS);
}

export function stopInboxScrollTrace(conversationId: string) {
  if (inboxScrollTraceState.conversationId !== conversationId) return;
  traceInboxScroll("OUTRO", "TRACE_STOP");
  inboxScrollTraceState.active = false;
  inboxScrollTraceState.restoreScrollIntoViewPatch?.();
  inboxScrollTraceState.restoreScrollIntoViewPatch = null;
}

export const TracedVirtuosoScroller = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  function TracedVirtuosoScroller(props, forwardedRef) {
    const resizeObserverRef = useRef<ResizeObserver | null>(null);

    const setRef = useCallback(
      (node: HTMLDivElement | null) => {
        resizeObserverRef.current?.disconnect();
        resizeObserverRef.current = null;
        setInboxScrollTraceScroller(node);
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
        if (!node || typeof ResizeObserver === "undefined") return;
        resizeObserverRef.current = new ResizeObserver((entries) => {
          for (const entry of entries) {
            traceInboxScroll("RESIZE_OBSERVER", "SCROLLER_RESIZE", {
              width: Math.round(entry.contentRect.width),
              height: Math.round(entry.contentRect.height),
            });
          }
        });
        resizeObserverRef.current.observe(node);
      },
      [forwardedRef],
    );

    return (
      <div
        {...props}
        ref={setRef}
        onWheel={(event) => {
          markInboxUserInput("wheel");
          props.onWheel?.(event);
        }}
        onTouchMove={(event) => {
          markInboxUserInput("touchmove");
          props.onTouchMove?.(event);
        }}
        onPointerDown={(event) => {
          markInboxUserInput("pointerdown");
          props.onPointerDown?.(event);
        }}
        onScroll={(event) => {
          traceInboxScroll(inferInboxScrollReason(), "SCROLL_EVENT", {
            targetClassName: (event.currentTarget as HTMLElement).className,
          });
          props.onScroll?.(event);
        }}
      />
    );
  },
);

export function TracedVirtuosoItem({
  children,
  context: _context,
  ...props
}: ItemProps<Message> & { context?: unknown }) {
  return (
    <div {...props} data-inbox-virtual-item="true">
      {children}
    </div>
  );
}
