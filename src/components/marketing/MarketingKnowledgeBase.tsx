import { LumePulse } from "./MarketingMotion";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Save, Fingerprint, MessageCircle, ShoppingBag, NotebookPen } from "lucide-react";
import { lumeToast as toast } from "./MarketingFeedback";
import { MarketingArtwork } from "./MarketingArtwork";
import {
  getMarketingKnowledgeBase,
  upsertMarketingKnowledgeBase,
} from "@/lib/marketing/knowledge-base.functions";
import type { MarketingKnowledgeBaseRow } from "@/lib/marketing/marketing.types";

interface Props {
  companyId: string;
}

interface FieldDef {
  key: keyof Omit<MarketingKnowledgeBaseRow, "id" | "company_id" | "updated_at" | "updated_by">;
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

const GROUPS = [
  {
    title: "Essência",
    help: "Comece pelo que torna sua marca única.",
    icon: Fingerprint,
    fields: ["brand_identity", "differentiators", "products_services"],
  },
  {
    title: "Voz",
    help: "Defina como você quer conversar com as pessoas.",
    icon: MessageCircle,
    fields: ["tone_of_voice", "preferred_words", "forbidden_words", "copy_best_practices"],
  },
  {
    title: "Negócio",
    help: "Deixe suas condições comerciais sempre à mão.",
    icon: ShoppingBag,
    fields: ["guarantees", "cities_served", "gifts", "commercial_terms", "next_load_forecast"],
  },
  {
    title: "Detalhes",
    help: "Acrescente o que mais a IA precisa saber.",
    icon: NotebookPen,
    fields: ["extra_notes"],
  },
];

export function MarketingKnowledgeBase({ companyId }: Props) {
  const [values, setValues] = useState<Record<FieldDef["key"], string>>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [group, setGroup] = useState(0);
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
        <LumePulse className="h-4 w-4 animate-spin" /> Carregando base de conhecimento…
      </div>
    );
  }

  const filled = FIELDS.filter((f) => values[f.key].trim()).length;
  return (
    <div className="mkt-brand-layout">
      <aside className="mkt-brand-index">
        <div className="mkt-brand-cover">
          <MarketingArtwork kind="prism" />
          <strong>
            {filled}
            <span>/{FIELDS.length}</span>
          </strong>
          <small>informações que a Lume já conhece</small>
        </div>
        <nav aria-label="Partes da identidade da marca">
          {GROUPS.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.title}
                aria-pressed={group === index}
                onClick={() => setGroup(index)}
              >
                <Icon size={19} />
                <span>
                  {item.title}
                  <small>
                    {item.fields.length} {item.fields.length === 1 ? "informação" : "informações"}
                  </small>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="mkt-brand-progress">
          <span>
            {filled} de {FIELDS.length} informações preenchidas
          </span>
          <progress value={filled} max={FIELDS.length} />
          <small>Preencha o que fizer sentido. Todos os campos são opcionais.</small>
        </div>
      </aside>
      <div className="mkt-knowledge-form">
        {GROUPS.map((item, index) => (
          <section key={item.title} hidden={group !== index} className="mkt-brand-section">
            <h3>{item.title}</h3>
            <p>{item.help}</p>
            <div className="mkt-brand-fields">
              {FIELDS.filter((f) => item.fields.includes(f.key)).map((f) => (
                <div key={f.key}>
                  <Label htmlFor={`mkt-brand-${f.key}`}>{f.label}</Label>
                  <Textarea
                    id={`mkt-brand-${f.key}`}
                    value={values[f.key]}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    rows={f.rows}
                    placeholder={f.placeholder}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
        <div className="mkt-brand-save">
          <div>
            <strong>A Lume aprende com o que você conta.</strong>
            <small>
              {updatedAt
                ? `Salvo em ${new Date(updatedAt).toLocaleString("pt-BR")}`
                : "Suas alterações serão aplicadas ao salvar."}
            </small>
          </div>
          <Button className="mkt-primary" onClick={save} disabled={saving}>
            {saving ? <LumePulse className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{" "}
            Salvar base de conhecimento
          </Button>
        </div>
      </div>
    </div>
  );
}
