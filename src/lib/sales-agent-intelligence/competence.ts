// ============================================================================
// Sales Intelligence — competência de vendas da Vendedora, igual para todas
// as empresas e segmentos. Aqui mora COMO vender (estágios, próximas ações,
// princípios de raciocínio); O QUE se vende vem do Business Knowledge de
// cada empresa. Nada de produto, segmento ou empresa fixo neste arquivo.
//
// Os princípios orientam o raciocínio do LLM; não são falas prontas. O LLM
// interpreta o cliente e escolhe a próxima ação; o código valida a escolha
// (ver sales-plan.ts) e os fatos continuam vindo das tools/catálogo.
// ============================================================================

export const SALES_STAGES = [
  "discovery",
  "qualification",
  "recommendation",
  "objection",
  "comparison",
  "negotiation",
  "closing",
  "post_sale",
  "recovery",
] as const;
export type SalesStage = (typeof SALES_STAGES)[number];

export const SALES_NEXT_ACTIONS = [
  "answer_question",
  "discover_needs",
  "recommend_products",
  "present_value",
  "handle_objection",
  "propose_next_step",
  "confirm_purchase_intent",
  "re_engage",
] as const;
export type SalesNextAction = (typeof SALES_NEXT_ACTIONS)[number];

/** Descrição curta de cada ação — vai no contrato da tool, não como fala pronta. */
export const SALES_NEXT_ACTION_DESCRIPTIONS: Record<SalesNextAction, string> = {
  answer_question: "responder objetivamente o que o cliente perguntou, com fatos cadastrados",
  discover_needs:
    "fazer UMA pergunta que revele necessidade, uso, prazo ou restrição ainda desconhecida",
  recommend_products:
    "indicar as opções do catálogo que atendem a necessidade (IDs em suggest_products)",
  present_value: "ligar diferenciais/itens cadastrados à necessidade que o cliente disse ter",
  handle_objection:
    "reconhecer a objeção, entender a causa e responder só com fatos e políticas cadastradas",
  propose_next_step:
    "sugerir o próximo passo possível na empresa (ex.: escolher opção, visita, orçamento)",
  confirm_purchase_intent:
    "cliente sinalizou compra: confirmar a escolha; o fechamento é concluído por um atendente",
  re_engage: "retomar uma conversa parada a partir do que o cliente já disse",
};

interface StagePrinciples {
  goal: string;
  principles: readonly string[];
}

/** Princípios por estágio (raciocínio de vendedor consultivo, sem roteiro). */
export const SALES_STAGE_PRINCIPLES: Record<SalesStage, StagePrinciples> = {
  discovery: {
    goal: "entender o que o cliente quer resolver antes de oferecer",
    principles: [
      "Pergunte sobre uso, contexto e prioridade do cliente, não sobre dados que você não vai usar.",
      "Aproveite o que ele já disse; uma pergunta por vez.",
    ],
  },
  qualification: {
    goal: "confirmar que existe encaixe entre necessidade, restrições e o que a empresa oferece",
    principles: [
      "Descubra restrições que mudam a recomendação (espaço, prazo, orçamento, região), só se forem relevantes.",
      "Se o cliente já deu informação suficiente, avance para recomendar.",
    ],
  },
  recommendation: {
    goal: "indicar poucas opções que atendem a necessidade declarada",
    principles: [
      "Explique em uma frase por que cada opção atende ao que o cliente disse.",
      "Quando o pedido é por atributo/medida, as opções do catálogo recebidas já são todas as compatíveis.",
    ],
  },
  objection: {
    goal: "tratar a dúvida ou resistência sem pressionar",
    principles: [
      "Reconheça a preocupação, entenda a causa real e responda com fatos e políticas cadastradas.",
      "Objeção de preço: mostre o que está incluído e alternativas reais do catálogo; nunca crie condição.",
    ],
  },
  comparison: {
    goal: "ajudar o cliente a escolher entre opções reais",
    principles: [
      "Compare pelo que importa para o cliente, usando só atributos e preços cadastrados.",
      "Custo-benefício depende da necessidade: não é automaticamente o menor preço.",
    ],
  },
  negotiation: {
    goal: "reconhecer pedido de condição diferente da cadastrada",
    principles: [
      "Pedido de desconto, contraproposta ou condição especial é concluído por um atendente humano.",
    ],
  },
  closing: {
    goal: "transformar sinal de compra em próximo passo concreto",
    principles: [
      "Diante de sinal claro de compra, confirme a opção escolhida e o que falta para concluir.",
      "Não conclua pedido nem prometa condição: o atendente finaliza.",
    ],
  },
  post_sale: {
    goal: "cuidar do cliente depois da compra",
    principles: [
      "Responda dúvidas de uso/entrega pelas políticas cadastradas; problema ou reclamação vai para humano.",
    ],
  },
  recovery: {
    goal: "retomar o interesse de quem parou de responder",
    principles: [
      "Retome pelo último interesse real do cliente, com uma pergunta simples e sem insistência.",
    ],
  },
};

/** Válidos em qualquer estágio. */
export const UNIVERSAL_SALES_PRINCIPLES: readonly string[] = [
  "Responda primeiro o que o cliente perguntou; depois conduza, se fizer sentido.",
  "Pense como vendedor consultivo: necessidade → encaixe → valor → próximo passo.",
  "Seja natural e breve; nada de script, pressão ou clichê.",
];

const NEXT_STAGES: Record<SalesStage, readonly SalesStage[]> = {
  discovery: ["qualification", "recommendation"],
  qualification: ["recommendation"],
  recommendation: ["objection", "comparison", "closing"],
  objection: ["recommendation", "closing"],
  comparison: ["recommendation", "closing"],
  negotiation: ["closing"],
  closing: ["post_sale"],
  post_sale: [],
  recovery: ["discovery", "recommendation"],
};

export function isSalesStage(value: unknown): value is SalesStage {
  return typeof value === "string" && (SALES_STAGES as readonly string[]).includes(value);
}

export function isSalesNextAction(value: unknown): value is SalesNextAction {
  return typeof value === "string" && (SALES_NEXT_ACTIONS as readonly string[]).includes(value);
}

/**
 * Competência relevante para o momento: princípios universais + estágio
 * atual + estágios seguintes. Não despeja tudo em todo turno.
 */
export function renderSalesCompetence(stage: SalesStage | null): string {
  const current: SalesStage = stage ?? "discovery";
  const stages = [current, ...NEXT_STAGES[current]];
  const lines = [
    "COMPETÊNCIA DE VENDAS (orienta seu raciocínio; não são falas prontas):",
    ...UNIVERSAL_SALES_PRINCIPLES.map((principle) => `- ${principle}`),
    ...stages.flatMap((key) => {
      const { goal, principles } = SALES_STAGE_PRINCIPLES[key];
      return [
        `${key === current ? "Estágio atual" : "Próximo possível"} — ${key}: ${goal}.`,
        ...principles.map((p) => `  - ${p}`),
      ];
    }),
  ];
  return lines.join("\n");
}
