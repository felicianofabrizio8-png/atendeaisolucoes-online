// Qualidade do catálogo (somente leitura): o que impede a Vendedora de usar
// um fato com segurança. Sugestões de tipagem só são gravadas quando alguém
// clica em "Aplicar" no produto (aprovação explícita).
import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { updateProduct, type Product } from "@/data/products";
import {
  applyAuditSuggestions,
  auditCatalogFacts,
  renderFactValue,
  typedAttributeValue,
  type CatalogAuditIssue,
  type CatalogAuditProductReport,
} from "@/lib/catalog-facts";
import type { ProductSpecifications } from "@/lib/product-catalog-fields";

const ISSUE_MESSAGES: Record<CatalogAuditIssue["code"], string> = {
  price_missing: "Sem preço cadastrado.",
  promo_not_lower: "Preço promocional igual ou maior que o preço normal.",
  specifications_invalid: "Características em formato inválido.",
  attribute_untyped: "Característica sem tipo definido",
  attribute_missing_unit: "Número sem unidade",
  attribute_conflict: "Valor diferente do campo principal",
  fact_only_in_free_text: "Medida/quantidade só no texto livre (a IA não a confirma)",
  possible_duplicate: "Possível duplicado",
};

function issueText(issue: CatalogAuditIssue): string {
  const base = ISSUE_MESSAGES[issue.code];
  const subject = issue.subject ? ` — ${issue.subject}` : "";
  const detail = issue.detail ? `: ${issue.detail}` : "";
  return `${base}${subject}${detail}`;
}

export function CatalogAuditPanel({
  products,
  onEdit,
}: {
  products: Product[];
  onEdit: (product: Product) => void;
}) {
  const [open, setOpen] = useState(false);
  const reports = useMemo(
    () =>
      auditCatalogFacts(
        products.map((product) => ({ ...product, promoPrice: product.promoPrice ?? null })),
      ),
    [products],
  );
  if (reports.length === 0) return null;

  const apply = (report: CatalogAuditProductReport) => {
    const product = products.find((candidate) => candidate.id === report.productId);
    if (!product) return;
    const summary = report.suggestions
      .map(
        (suggestion) =>
          `${suggestion.label}: ${renderFactValue(typedAttributeValue(suggestion.attribute))}`,
      )
      .join("\n");
    if (!window.confirm(`Aplicar tipagem em "${product.name}"?\n\n${summary}`)) return;
    void updateProduct(product.id, {
      specifications: applyAuditSuggestions(
        product.specifications,
        report.suggestions,
      ) as ProductSpecifications,
    }).then((updated) => {
      if (updated) toast.success("Características atualizadas");
    });
  };

  return (
    <section className="lp-audit" data-open={open || undefined}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="lp-audit-head"
      >
        <span className="lp-audit-icon" aria-hidden="true">
          <AlertTriangle />
        </span>
        <span className="lp-audit-text">
          <b>
            {reports.length} produto{reports.length === 1 ? "" : "s"} para revisar
          </b>
          <small>Informações que a IA não consegue confirmar ao vender.</small>
        </span>
        {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
      </button>
      {open && (
        <ul className="lp-audit-list">
          {reports.map((report) => {
            const product = products.find((candidate) => candidate.id === report.productId);
            return (
              <li key={report.productId}>
                <div className="lp-audit-row">
                  <b>{report.productName}</b>
                  {report.suggestions.length > 0 && (
                    <button type="button" onClick={() => apply(report)} className="lp-audit-apply">
                      Aplicar tipagem sugerida
                    </button>
                  )}
                  {product && (
                    <button type="button" onClick={() => onEdit(product)} className="lp-audit-edit">
                      Editar
                    </button>
                  )}
                </div>
                <ul className="lp-audit-issues">
                  {report.issues.map((issue, index) => (
                    <li key={index}>{issueText(issue)}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
