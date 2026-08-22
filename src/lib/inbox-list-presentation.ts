export type InboxListMessage = {
  role?: string | null;
  text?: string | null;
};

export type InboxListConversation = {
  lastMessageAt: string;
  awaitingReply: boolean;
  unread: number;
};

export type InboxListItem = {
  conv: InboxListConversation;
  last?: InboxListMessage;
};

export function sortInboxByRecentMessage<T extends InboxListItem>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      new Date(b.conv.lastMessageAt).getTime() -
      new Date(a.conv.lastMessageAt).getTime(),
  );
}

export function inboxMessagePreview(message?: InboxListMessage): string {
  const text = message?.text?.trim() || "—";
  return message?.role === "agent" ? `Você: ${text}` : text;
}

export function inboxPrimaryAction(
  message: InboxListMessage | undefined,
  awaitingReply: boolean,
  fallback: string,
): string {
  return message?.role === "lead" && awaitingReply ? "Responder cliente" : fallback;
}

export function normalizeInboxSearch(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesInboxSearch(query: string, values: readonly unknown[]): boolean {
  const normalizedQuery = normalizeInboxSearch(query);
  if (!normalizedQuery) return true;

  const haystack = values.map(normalizeInboxSearch).join(" ");
  if (haystack.includes(normalizedQuery)) return true;

  const queryDigits = query.replace(/\D+/g, "");
  if (queryDigits.length < 3) return false;
  return values.some((value) => String(value ?? "").replace(/\D+/g, "").includes(queryDigits));
}
