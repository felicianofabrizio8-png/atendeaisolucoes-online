import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, BookMarked, Save } from "lucide-react";
import { toast } from "sonner";
import {
  getMarketingKnowledgeBase,
  upsertMarketingKnowledgeBase,
} from "@/lib/marketing/knowledge-base.functions";
import type { MarketingKnowledgeBaseRow } from "@/lib/marketing/marketing.types";

interface Props {
  companyId: string;
}

interface FieldDef {
  key: keyof Omit<
    MarketingKnowledgeBaseRow,
    "id" | "company_id" | "updated_at" | "updated_by"
  >;
  label: string;
  placeholder: string;
  rows: number;
}

const FIELDS: FieldDef[] = [
  {
    key: "brand_identity",
    label: "Identidade da marca",
    placeholder: "Quem é a empresa, história, propósito, personalidade, público principal…",
    rows: 4,
  },
  {
    key: "tone_of_voice",
    label: "Tom de comunicação",
    placeholder: "Ex.: acolhedor, direto, técnico com leveza; evita gírias; usa 'você'…",
    rows: 3,
  },
  {
    key: "differentiators",
    label: "Diferenciais comerciais",
    placeholder: "O que torna a empresa única em relação aos concorrentes.",
    rows: 3,
  },
  {
    key: "products_services",
    label: "Produtos e serviços em destaque",
    placeholder: "Principais linhas, categorias, serviços oferecidos.",
    rows: 3,
  },
  {
    key: "guarantees",
    label: "Garantias",
    placeholder: "Ex.: garantia de 10 anos, troca em 7 dias, satisfação garantida…",
    rows: 2,
  },
  {
    key: "cities_served",
    label: "Cidades atendidas",
    placeholder: "Ex.: Guarulhos, Arujá, Itaquá e região.",
    rows: 2,
  },
  {
    key: "gifts",
    label: "Brindes",
    placeholder: "Brindes recorrentes ou de campanha.",
    rows: 2,
  },
  {
    key: "commercial_terms",
    label: "Condições comerciais",
    placeholder: "Formas de pagamento, entrega, frete, instalação…",
    rows: 3,
  },
  {
    key: "next_load_forecast",
    label: "Próxima carga prevista",
    placeholder: "Ex.: próxima carga prevista para a primeira quinzena do mês…",
    rows: 2,
  },
  {
    key: "preferred_words",
    label: "Palavras e expressões preferidas",
    placeholder: "Ex.: 'especialistas', 'sob medida', 'atendimento humano'…",
    rows: 2,
  },
  {
    key: "forbidden_words",
    label: "Palavras proibidas",
    placeholder: "Ex.: 'barato', 'promoção relâmpago', 'imperdível'…",
    rows: 2,
  },
  {
    key: "copy_best_practices",
    label: "Boas práticas de copy",
    placeholder: "Ex.: começar com benefício, evitar caixa alta, incluir CTA claro…",
    rows: 3,
  },
  {
    key: "extra_notes",
    label: "Observações adicionais",
    placeholder: "Qualquer contexto extra útil para a IA.",
    rows: 3,
  },
];

const EMPTY: Record<FieldDef["key"], string> = {
  brand_identity: "",
  tone_of_voice: "",
  differentiators: "",
  products_services: "",
  guarantees: "",
  cities_served: "",
  gifts: "",
  commercial_terms: "",
  next_load_forecast: "",
  preferred_words: "",
  forbidden_words: "",
  copy_best_practices: "",
  extra_notes: "",
};

export function MarketingKnowledgeBase({ companyId }: Props) {
  const [values, setValues] = useState<Record<FieldDef["key"], string>>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getMarketingKnowledgeBase()
      .then((res) => {
        if (!alive) return;
        const kb = res.kb as MarketingKnowledgeBaseRow;
        const next = { ...EMPTY };
        for (const f of FIELDS) next[f.key] = (kb[f.key] as string) ?? "";
        setValues(next);
        setUpdatedAt(kb.updated_at);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar base."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [companyId]);

  async function save() {
    setSaving(true);
    try {
      const res = await upsertMarketingKnowledgeBase({ data: values });
      const kb = res.kb as MarketingKnowledgeBaseRow;
      setUpdatedAt(kb.updated_at);
      toast.success("Base de conhecimento salva. A IA já usará este contexto.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar base.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando base de conhecimento…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start gap-3">
          <BookMarked className="h-5 w-5 text-primary mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold">Base de conhecimento da marca</div>
            <p className="text-muted-foreground">
              Este conteúdo é usado como contexto obrigatório em <strong>todas</strong> as
              gerações de conteúdo com IA. Preencha o que fizer sentido para a sua empresa —
              campos vazios são simplesmente ignorados.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.rows >= 4 ? "md:col-span-2" : ""}>
              <Label>{f.label}</Label>
              <Textarea
                value={values[f.key]}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                }
                rows={f.rows}
                placeholder={f.placeholder}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <div className="text-xs text-muted-foreground">
            {updatedAt
              ? `Última atualização: ${new Date(updatedAt).toLocaleString("pt-BR")}`
              : "Ainda não salva."}
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Salvar base de conhecimento
          </Button>
        </div>
      </div>
    </div>
  );
}
