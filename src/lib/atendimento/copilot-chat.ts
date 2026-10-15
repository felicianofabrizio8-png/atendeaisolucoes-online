export const CHAT_LIMITS = {
  files: 5,
  fileBytes: 5 * 1024 * 1024,
  totalBytes: 10 * 1024 * 1024,
  question: 4000,
  history: 12,
} as const;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const DOCUMENT_TYPES = ["application/pdf", "text/plain", "text/csv"];
export interface CopilotTurn {
  role: "user" | "assistant";
  text: string;
}
export function attachmentError(file: Pick<File, "name" | "type" | "size">): string | null {
  if (![...IMAGE_TYPES, ...DOCUMENT_TYPES].includes(file.type))
    return "Use imagens PNG, JPG, WEBP, GIF ou documentos PDF, TXT e CSV.";
  if (!file.size) return "O arquivo está vazio.";
  if (file.size > CHAT_LIMITS.fileBytes) return "Cada arquivo pode ter até 5 MB.";
  return null;
}
export function greeting(name?: string | null, hour = new Date().getHours()) {
  const period = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const firstName = name?.trim().split(/\s+/)[0];
  return firstName ? `${period}, ${firstName}.` : `${period}.`;
}
export const COPILOT_ACTIONS = [
  {
    label: "Próxima resposta",
    prompt:
      "Escreva somente a melhor próxima resposta para este cliente, pronta para eu revisar e enviar.",
  },
  {
    label: "Resumo",
    prompt:
      "Resuma esta conversa: necessidade do cliente, informações confirmadas, pendências e próximo passo.",
  },
  {
    label: "Sugestões",
    prompt:
      "Sugira três próximos passos práticos para conduzir este atendimento, com base na conversa.",
  },
] as const;
