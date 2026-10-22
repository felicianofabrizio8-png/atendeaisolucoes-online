// Cadastro/edição de produto no mesmo formato dos formulários de Orçamentos e
// Metas: painel preto, etapas no topo e rodapé fixo. Só nome e preço são
// obrigatórios — dá para salvar em qualquer etapa.
import { useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  Code2,
  ImageIcon,
  Images,
  Loader2,
  Package,
  Ruler,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { createProduct, getProductsCompanyId, updateProduct, type Product } from "@/data/products";
import { formatBRL } from "@/data/mock";
import { supabase } from "@/integrations/supabase/client";
import { compressImage, isMobileDevice } from "@/lib/image-compress";
import { cn } from "@/lib/utils";
import { SmartImage } from "@/components/SmartImage";
import {
  parseIncludedItems,
  parseOptionalCatalogNumber,
  parseVariants,
  categoryRequiresDimensions,
  hasCompleteProductDimensions,
} from "@/lib/product-catalog-fields";
import {
  attributeRowsFromSpecifications,
  attributeRowsToSpecifications,
  auditProductFacts,
  normalizeProductFacts,
  type AttributeRow,
  type AttributeRowError,
} from "@/lib/catalog-facts";
import { ProductAttributesField, type AttributeSuggestion } from "./ProductAttributesField";
import "@/components/orcamentos/quotes.css";
import "./products.css";

/** Número digitado ou null (para avisos ao vivo, sem bloquear a digitação). */
function parseLooseNumber(value: string): number | null {
  try {
    return parseOptionalCatalogNumber(value) ?? null;
  } catch {
    return null;
  }
}

const STEPS = [
  { label: "Essencial", hint: "Como o cliente vai ver o produto." },
  { label: "Detalhes", hint: "Medidas, formato e o que vem junto." },
  { label: "Para a IA", hint: "Tudo o que a Vendedora pode afirmar." },
] as const;

/** Em qual etapa fica o campo de cada mensagem de erro. */
function stepForError(message: string): number {
  if (/nome|preço|promocional/i.test(message)) return 1;
  if (/comprimento|medidas|capacidade|largura|profundidade/i.test(message)) return 2;
  return 3;
}

export function ProductFormModal({
  product,
  dimensionRequiredCategories,
  categories,
  attributeSuggestions,
  onClose,
}: {
  product: Product | null;
  dimensionRequiredCategories: string[];
  categories: string[];
  attributeSuggestions: AttributeSuggestion[];
  onClose: () => void;
}) {
  const isEdit = !!product;
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [name, setName] = useState(product?.name ?? "");
  const [model, setModel] = useState(product?.model ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [price, setPrice] = useState<string>(product ? String(product.price) : "");
  const [promoPrice, setPromoPrice] = useState<string>(
    product?.promoPrice ? String(product.promoPrice) : "",
  );
  const [description, setDescription] = useState(product?.description ?? "");
  const [lengthM, setLengthM] = useState(product?.lengthM != null ? String(product.lengthM) : "");
  const [widthM, setWidthM] = useState(product?.widthM != null ? String(product.widthM) : "");
  const [depthM, setDepthM] = useState(product?.depthM != null ? String(product.depthM) : "");
  const [capacityL, setCapacityL] = useState(
    product?.capacityL != null ? String(product.capacityL) : "",
  );
  const [shape, setShape] = useState(product?.shape ?? "");
  const [attributeRows, setAttributeRows] = useState<AttributeRow[]>(() =>
    attributeRowsFromSpecifications(product?.specifications),
  );
  const [attributeErrors, setAttributeErrors] = useState<
    Partial<Record<number, AttributeRowError>>
  >({});
  const [includedItems, setIncludedItems] = useState((product?.includedItems ?? []).join("\n"));
  const [variants, setVariants] = useState(JSON.stringify(product?.variants ?? [], null, 2));
  const [notes, setNotes] = useState(product?.notes ?? "");
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [error, setError] = useState<string | null>(null);
  // Medida/quantidade escrita só na descrição/observações: a Vendedora não a
  // confirma (aviso, não bloqueia).
  const freeTextWarnings = useMemo(() => {
    const attributes = attributeRowsToSpecifications(attributeRows).specifications;
    return auditProductFacts({
      id: product?.id ?? "draft",
      name: name || "draft",
      description,
      notes,
      lengthM: parseLooseNumber(lengthM),
      widthM: parseLooseNumber(widthM),
      depthM: parseLooseNumber(depthM),
      capacityL: parseLooseNumber(capacityL),
      specifications: attributes,
      price: 1,
    })
      .issues.filter((issue) => issue.code === "fact_only_in_free_text")
      .map((issue) => issue.detail)
      .filter((detail): detail is string => Boolean(detail));
  }, [attributeRows, product?.id, name, description, notes, lengthM, widthM, depthM, capacityL]);

  const priceValue = parseLooseNumber(price.replace(",", ".")) ?? 0;
  const promoValue = parseLooseNumber(promoPrice.replace(",", ".")) ?? 0;
  const promoOff =
    priceValue > 0 && promoValue > 0 && promoValue < priceValue
      ? Math.round((1 - promoValue / priceValue) * 100)
      : 0;
  const dimsRequired = categoryRequiresDimensions(category, dimensionRequiredCategories);
  const detailCount = [
    model,
    sku,
    lengthM,
    widthM,
    depthM,
    capacityL,
    shape,
    description,
    includedItems,
  ].filter((value) => value.trim()).length;
  const variantCount = (() => {
    try {
      return parseVariants(variants).length;
    } catch {
      return 0;
    }
  })();

  const goTo = (target: number) => {
    if (target === step || target < 1 || target > 3) return;
    setDirection(target > step ? 1 : -1);
    setStep(target);
  };

  const fail = (message: string) => {
    setError(message);
    goTo(stepForError(message));
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const priceNum = Number(price.replace(",", "."));
    if (!name.trim()) {
      fail("Informe o nome do produto.");
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      fail("Informe um preço válido.");
      return;
    }
    const promoNum = promoPrice ? Number(promoPrice.replace(",", ".")) : undefined;
    if (promoNum !== undefined && (!Number.isFinite(promoNum) || promoNum <= 0)) {
      fail("Preço promocional inválido.");
      return;
    }
    const attributes = attributeRowsToSpecifications(attributeRows);
    setAttributeErrors(
      Object.fromEntries(attributes.issues.map((issue) => [issue.index, issue.error])),
    );
    if (attributes.issues.length > 0) {
      fail("Revise as características destacadas.");
      return;
    }
    let structured;
    try {
      structured = {
        lengthM: parseOptionalCatalogNumber(lengthM),
        widthM: parseOptionalCatalogNumber(widthM),
        depthM: parseOptionalCatalogNumber(depthM),
        capacityL: parseOptionalCatalogNumber(capacityL),
        specifications: attributes.specifications,
        includedItems: parseIncludedItems(includedItems),
        variants: parseVariants(variants),
      };
    } catch (parseError) {
      const reason = parseError instanceof Error ? parseError.message : "";
      fail(
        reason === "catalog_specifications_invalid"
          ? "Especificações devem ser um objeto JSON válido."
          : reason === "catalog_variants_invalid"
            ? "Variantes devem ser uma lista JSON de objetos."
            : "Medidas e capacidade devem ser números não negativos.",
      );
      return;
    }
    if (
      categoryRequiresDimensions(category, dimensionRequiredCategories) &&
      !hasCompleteProductDimensions(structured)
    ) {
      fail("Comprimento, largura e profundidade são obrigatórios para esta categoria.");
      return;
    }
    // Característica com o mesmo nome de um campo acima e valor diferente.
    const conflict = normalizeProductFacts({
      name: name.trim(),
      price: priceNum,
      shape: shape.trim() || null,
      ...structured,
    }).conflicts[0];
    if (conflict) {
      fail(
        `"${conflict.label}" está com ${conflict.attributeValue} nas características e ${conflict.fieldValue} no campo principal.`,
      );
      return;
    }
    const emptyValue = isEdit ? null : undefined;
    const payload = {
      name: name.trim(),
      model: model.trim() || emptyValue,
      sku: sku.trim() || emptyValue,
      category,
      price: priceNum,
      promoPrice: promoNum,
      description: description.trim() || undefined,
      lengthM: structured.lengthM ?? emptyValue,
      widthM: structured.widthM ?? emptyValue,
      depthM: structured.depthM ?? emptyValue,
      capacityL: structured.capacityL ?? emptyValue,
      shape: shape.trim() || emptyValue,
      specifications: structured.specifications,
      includedItems: structured.includedItems,
      variants: structured.variants,
      notes: notes.trim() || undefined,
      images,
    };
    if (isEdit && product) {
      updateProduct(product.id, payload);
      toast.success("Produto atualizado");
    } else {
      createProduct(payload);
      toast.success("Produto cadastrado");
    }
    onClose();
  };

  return (
    <div className="lq-black-backdrop">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Editar produto" : "Novo produto"}
        onSubmit={handleSubmit}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="lq-black lq-panel lq-form lp-form"
      >
        <span className="lq-panel-glow" aria-hidden="true" />
        <div className="lq-form-head">
          <div className="lq-form-title">
            <div>
              <h2>{isEdit ? "Editar produto" : "Novo produto"}</h2>
              <p>{STEPS[step - 1].hint}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar formulário"
              className="lq-close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="lq-stepper" aria-label={`Etapa ${step} de 3`}>
            {STEPS.map((item, index) => {
              const target = index + 1;
              return (
                <button
                  type="button"
                  key={item.label}
                  onClick={() => goTo(target)}
                  aria-current={target === step ? "step" : undefined}
                  data-state={target === step ? "current" : target < step ? "done" : "todo"}
                >
                  <i aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="lq-form-body">
          <motion.div
            key={step}
            initial={reduceMotion ? false : { opacity: 0, x: direction * 28 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === 1 && (
              <>
                <section className="lq-section">
                  <SectionTitle icon={<Images />}>Fotos</SectionTitle>
                  <ProductImagesField images={images} onChange={setImages} />
                </section>
                <section className="lq-section">
                  <SectionTitle icon={<Tag />}>Identificação</SectionTitle>
                  <div className="lq-fields">
                    <FormField label="Nome do produto" className="lq-span-2">
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ex.: Piscina de fibra 6x3"
                        className="quote-form-input"
                        autoFocus={!isEdit}
                      />
                    </FormField>
                    <FormField label="Categoria" className="lq-span-2">
                      <input
                        type="text"
                        list="product-categories"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        placeholder="Ex.: Sofás, Refrigeradores, Serviços"
                        className="quote-form-input"
                      />
                      <datalist id="product-categories">
                        {categories.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                      {categories.length > 0 && (
                        <div role="radiogroup" aria-label="Categorias usadas" className="lq-chips">
                          {categories.slice(0, 10).map((c) => (
                            <button
                              key={c}
                              type="button"
                              role="radio"
                              aria-checked={category === c}
                              onClick={() => setCategory(category === c ? "" : c)}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      )}
                    </FormField>
                  </div>
                </section>
                <section className="lq-section">
                  <SectionTitle icon={<Wallet />}>Preço</SectionTitle>
                  <div className="lq-fields">
                    <FormField label="Preço de tabela">
                      <div className="lq-money" data-prefix="R$">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          placeholder="0,00"
                          className="quote-form-input"
                        />
                      </div>
                    </FormField>
                    <FormField label="Promoção (opcional)">
                      <div className="lq-money" data-prefix="R$">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={promoPrice}
                          onChange={(e) => setPromoPrice(e.target.value)}
                          placeholder="0,00"
                          className="quote-form-input"
                        />
                      </div>
                    </FormField>
                  </div>
                  {promoOff > 0 ? (
                    <span className="lq-hint-ai">
                      <Sparkles aria-hidden="true" />
                      {promoOff}% de desconto · o cliente vê {formatBRL(promoValue)}
                    </span>
                  ) : promoValue > 0 && priceValue > 0 ? (
                    <p className="lq-hint lp-hint-warn">
                      A promoção precisa ser menor que o preço de tabela.
                    </p>
                  ) : null}
                </section>
              </>
            )}

            {step === 2 && (
              <>
                <section className="lq-section">
                  <SectionTitle icon={<Package />}>Modelo e código</SectionTitle>
                  <div className="lq-fields">
                    <FormField label="Modelo (opcional)">
                      <input
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder="Ex.: Caribe 6"
                        className="quote-form-input"
                      />
                    </FormField>
                    <FormField label="SKU (opcional)">
                      <input
                        type="text"
                        value={sku}
                        onChange={(e) => setSku(e.target.value)}
                        placeholder="Ex.: CAR-6X3-AZ"
                        className="quote-form-input"
                      />
                    </FormField>
                  </div>
                </section>
                <section className="lq-section">
                  <SectionTitle icon={<Ruler />}>
                    Medidas e capacidade
                    {dimsRequired && (
                      <small className="lp-required">obrigatórias nesta categoria</small>
                    )}
                  </SectionTitle>
                  <div className="lq-fields">
                    {(
                      [
                        ["Comprimento", "m", lengthM, setLengthM],
                        ["Largura", "m", widthM, setWidthM],
                        ["Profundidade", "m", depthM, setDepthM],
                        ["Capacidade", "L", capacityL, setCapacityL],
                      ] as const
                    ).map(([label, unit, value, setter]) => (
                      <FormField key={label} label={label}>
                        <div className="lp-unit" data-unit={unit}>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={value}
                            onChange={(e) => setter(e.target.value)}
                            placeholder={unit === "L" || !dimsRequired ? "Opcional" : "0,00"}
                            className="quote-form-input"
                          />
                        </div>
                      </FormField>
                    ))}
                    <FormField label="Formato real (opcional)" className="lq-span-2">
                      <input
                        type="text"
                        value={shape}
                        onChange={(e) => setShape(e.target.value)}
                        placeholder="Ex.: quadrada, retangular, redonda"
                        className="quote-form-input"
                      />
                      <span className="lq-hint block">
                        Informe o formato como ele é; o valor não será convertido para outro
                        formato.
                      </span>
                    </FormField>
                  </div>
                </section>
                <section className="lq-section">
                  <div className="grid gap-4">
                    <FormField label="Descrição">
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={4}
                        placeholder="Detalhes do produto que o cliente precisa saber…"
                        className="quote-form-input"
                      />
                      {freeTextWarnings.length > 0 && (
                        <span className="lq-hint lp-hint-warn block">
                          {freeTextWarnings.join(", ")} só no texto: cadastre como característica
                          para a IA poder confirmar.
                        </span>
                      )}
                    </FormField>
                    <FormField label="Itens inclusos (opcional)">
                      <textarea
                        value={includedItems}
                        onChange={(e) => setIncludedItems(e.target.value)}
                        rows={3}
                        placeholder={"Um item por linha\nFiltro\nBomba"}
                        className="quote-form-input"
                      />
                    </FormField>
                  </div>
                </section>
              </>
            )}

            {step === 3 && (
              <>
                <section className="lq-section">
                  <SectionTitle icon={<Sparkles />}>Características</SectionTitle>
                  <ProductAttributesField
                    rows={attributeRows}
                    onChange={setAttributeRows}
                    errors={attributeErrors}
                    suggestions={attributeSuggestions}
                  />
                </section>
                <section className="lq-section">
                  <FormField label="Observações (opcional)">
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Ex.: Inclui escada inox"
                      className="quote-form-input"
                    />
                  </FormField>
                  <details className="lq-extra">
                    <summary>
                      <Code2 className="h-4 w-4 text-white/60" aria-hidden="true" />
                      Variantes/cores JSON
                      <small>
                        {variantCount
                          ? `${variantCount} cadastrada${variantCount > 1 ? "s" : ""}`
                          : "opcional"}
                      </small>
                      <ChevronDown aria-hidden="true" />
                    </summary>
                    <div className="lq-extra-body">
                      <textarea
                        aria-label="Variantes/cores JSON"
                        value={variants}
                        onChange={(e) => setVariants(e.target.value)}
                        rows={6}
                        spellCheck={false}
                        className="quote-form-input lp-code"
                      />
                      <span className="lq-hint">
                        Lista de objetos, ex.: {'[{ "name": "Azul", "color": "azul" }]'}
                      </span>
                    </div>
                  </details>
                </section>
              </>
            )}
          </motion.div>

          {error && (
            <div role="alert" className="lp-error">
              {error}
            </div>
          )}
        </div>

        <div className="lq-form-foot">
          {step > 1 && (
            <button
              type="button"
              onClick={() => goTo(step - 1)}
              className="lq-icon lp-foot-back"
              aria-label="Etapa anterior"
            >
              <ArrowLeft aria-hidden="true" />
            </button>
          )}
          <p className="lq-foot-note">
            {name.trim() ? (
              <>
                {name.trim()}
                {priceValue > 0 && (
                  <>
                    {" "}
                    · <b>{formatBRL(promoOff > 0 ? promoValue : priceValue)}</b>
                  </>
                )}
              </>
            ) : (
              "Nome e preço são obrigatórios."
            )}
            {step === 2 &&
              detailCount > 0 &&
              ` · ${detailCount} detalhe${detailCount > 1 ? "s" : ""}`}
          </p>
          {step < 3 && (
            <button type="button" onClick={() => goTo(step + 1)} className="lq-secondary">
              Próximo
              <ArrowRight aria-hidden="true" />
            </button>
          )}
          <button type="submit" className="lq-primary">
            <Check className="h-4 w-4" />
            {isEdit ? "Salvar" : "Cadastrar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="lq-section-title">
      <span aria-hidden="true">{icon}</span>
      {children}
    </h3>
  );
}

function FormField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="lq-field-label">{label}</span>
      {children}
    </label>
  );
}

export function ConfirmDeleteModal({
  product,
  onClose,
  onConfirm,
}: {
  product: Product;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="lq-black-backdrop lp-top" onClick={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="lp-delete-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="lq-black lq-panel lp-confirm"
      >
        <span className="lp-confirm-icon" aria-hidden="true">
          <Trash2 />
        </span>
        <h2 id="lp-delete-title">Excluir produto?</h2>
        <p>
          <b>{product.name}</b> será removido do catálogo. Essa ação não pode ser desfeita.
        </p>
        <div className="lp-confirm-actions">
          <button type="button" onClick={onClose} className="lq-secondary" autoFocus>
            Cancelar
          </button>
          <button type="button" onClick={onConfirm} className="lq-primary lp-danger">
            <Trash2 aria-hidden="true" /> Excluir
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductImagesField({
  images,
  onChange,
}: {
  images: string[];
  onChange: (next: string[]) => void;
}) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Local blob previews appended optimistically while uploading
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const isMobile = useMemo(() => isMobileDevice(), []);

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files as ArrayLike<File>);
    if (list.length === 0) return;
    const companyId = getProductsCompanyId();
    if (!companyId) {
      toast.error("Carregue uma empresa antes de enviar fotos.");
      return;
    }

    // Optimistic local previews for instant feedback
    const previewUrls = list
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => URL.createObjectURL(f));
    setPendingPreviews((p) => [...p, ...previewUrls]);

    setUploading(true);
    setProgress({ done: 0, total: list.length });
    const uploaded: string[] = [];
    try {
      let done = 0;
      for (const file of list) {
        if (!file.type.startsWith("image/")) {
          toast.error(`Arquivo ignorado (não é imagem): ${file.name}`);
          done++;
          setProgress({ done, total: list.length });
          continue;
        }
        try {
          const compressed = await compressImage(file);
          const path = `${companyId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
          const { error } = await supabase.storage.from("product-images").upload(path, compressed, {
            cacheControl: "31536000",
            upsert: false,
            contentType: compressed.type || "image/jpeg",
          });
          if (error) {
            console.error("PRODUCT_IMAGE_UPLOAD_ERROR", error);
            const msg = /quota/i.test(error.message)
              ? "Limite de armazenamento da empresa atingido. Remova imagens antigas ou contate o admin."
              : `Falha ao enviar ${file.name}: ${error.message}`;
            toast.error(msg);
          } else {
            const { getPublicImageUrl } = await import("@/lib/storage");
            uploaded.push(getPublicImageUrl(path));
          }
        } catch (e) {
          console.error("PRODUCT_IMAGE_COMPRESS_ERROR", e);
          toast.error(`Falha ao processar ${file.name}`);
        }
        done++;
        setProgress({ done, total: list.length });
      }
      if (uploaded.length) {
        onChange([...images, ...uploaded]);
        toast.success(`${uploaded.length} foto(s) adicionada(s)`);
      }
    } finally {
      // Release object URLs
      previewUrls.forEach((u) => URL.revokeObjectURL(u));
      setPendingPreviews((p) => p.filter((u) => !previewUrls.includes(u)));
      setUploading(false);
      setProgress(null);
      if (galleryRef.current) galleryRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  };

  const remove = (idx: number) => {
    onChange(images.filter((_, i) => i !== idx));
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...images];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const hasPhotos = images.length > 0 || pendingPreviews.length > 0;

  return (
    <div className="lp-photos">
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {hasPhotos && (
        <div className="lp-photo-grid">
          {images.map((url, idx) => (
            <div key={url + idx} className="lp-photo">
              <SmartImage
                src={url}
                alt={`Foto ${idx + 1}`}
                aspectRatio="1/1"
                wrapperClassName="lp-cover-img"
              />
              {idx === 0 && <span className="lp-photo-cover">Capa</span>}
              <div className="lp-photo-bar">
                <button
                  type="button"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  aria-label="Mover para esquerda"
                  title="Mover para esquerda"
                >
                  <ArrowLeft />
                </button>
                <button
                  type="button"
                  onClick={() => move(idx, 1)}
                  disabled={idx === images.length - 1}
                  aria-label="Mover para direita"
                  title="Mover para direita"
                >
                  <ArrowRight />
                </button>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  data-danger
                  aria-label="Remover"
                  title="Remover"
                >
                  <Trash2 />
                </button>
              </div>
            </div>
          ))}
          {pendingPreviews.map((url) => (
            <div key={url} className="lp-photo" data-pending>
              <img src={url} alt="" />
              <Loader2 className="animate-spin" aria-hidden="true" />
            </div>
          ))}
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        data-over={dragOver || undefined}
        data-compact={hasPhotos || undefined}
        className="lp-drop"
      >
        {!hasPhotos && (
          <div className="lp-drop-art" aria-hidden="true">
            <ImageIcon />
          </div>
        )}
        <div className="lp-drop-text">
          <b>
            {uploading && progress
              ? `Enviando ${progress.done}/${progress.total}…`
              : hasPhotos
                ? "Adicionar mais fotos"
                : "Adicione as fotos do produto"}
          </b>
          {!hasPhotos && (
            <small>
              {isMobile ? "Da câmera ou da galeria." : "Arraste aqui ou escolha do computador."} A
              primeira é a capa.
            </small>
          )}
        </div>
        <div className="lp-drop-actions">
          {isMobile && (
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={uploading}
              className={cn("lp-drop-btn", "lp-drop-btn-primary")}
            >
              <Camera aria-hidden="true" />
              Câmera
            </button>
          )}
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            disabled={uploading}
            className={cn("lp-drop-btn", !isMobile && "lp-drop-btn-primary")}
          >
            {uploading ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : hasPhotos ? (
              <Upload aria-hidden="true" />
            ) : (
              <ImageIcon aria-hidden="true" />
            )}
            {isMobile ? "Galeria" : "Escolher fotos"}
          </button>
        </div>
      </div>
      <p className="lq-hint">
        Imagens são comprimidas automaticamente para envio rápido no WhatsApp.
      </p>
    </div>
  );
}
