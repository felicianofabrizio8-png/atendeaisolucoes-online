// Abas da tela IA de Atendimento — ordem única usada pelo seletor mobile e
// pela lista de abas do desktop.

export type IaTabId =
  | "perfil"
  | "conhecimento"
  | "faq"
  | "aprendizados"
  | "uso"
  | "analytics"
  | "followup"
  | "templates"
  | "automacao"
  | "treinamento";

export const IA_TABS: { value: IaTabId; label: string }[] = [
  { value: "perfil", label: "Perfil" },
  { value: "conhecimento", label: "Base de Conhecimento" },
  { value: "faq", label: "FAQ" },
  { value: "aprendizados", label: "Aprendizados" },
  { value: "uso", label: "Uso & Logs" },
  { value: "analytics", label: "Analytics" },
  { value: "followup", label: "Follow-up" },
  { value: "templates", label: "Templates" },
  { value: "automacao", label: "Automação" },
  { value: "treinamento", label: "Treinamento" },
];

/** Rótulos com o contador de aprendizados pendentes aplicado. */
export function iaTabOptions(pendingCount: number): { value: IaTabId; label: string }[] {
  return IA_TABS.map((t) =>
    t.value === "aprendizados" && pendingCount > 0
      ? { ...t, label: `${t.label} (${pendingCount})` }
      : t,
  );
}
