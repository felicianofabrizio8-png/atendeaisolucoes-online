import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Check, Loader2, Pencil, RotateCcw, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/auth/AuthContext";
import { createLead, getLeads, subscribeRepo } from "@/data/leadRepo";
import { formatBRL, type Channel } from "@/data/mock";
import { activePrice, getProduct, products } from "@/data/products";
import {
  buildQuoteMessage,
  createQuote,
  type PaymentMethod,
  type Quote,
  type QuoteCustomerDetails,
} from "@/data/quotes";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/phone";

export const PAYMENT_METHODS: PaymentMethod[] = [
  "Pix",
  "Cartão de crédito",
  "Boleto",
  "Transferência",
  "Dinheiro",
];
export interface QuoteFormModalProps {
  quote?: Quote;
  defaultLeadId?: string;
  defaultConversationId?: string;
  defaultProductId?: string;
  suggestionReason?: string;
  onCancel: () => void;
  onCreated: (quote: Quote) => void;
}
export function todayPlusDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
const emptyCustomer: QuoteCustomerDetails = {
  firstName: "",
  lastName: "",
  email: "",
  phone1: "",
  phone2: "",
  street: "",
  number: "",
  city: "",
  neighborhood: "",
  state: "",
  postalCode: "",
};
const inputClass =
  "quote-form-input w-full min-h-10 rounded-md border border-transparent bg-[#1d1d1d] px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/50";
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
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
    </label>
  );
}
function splitName(name: string) {
  const [firstName = "", ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}
function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}
function parseMoney(value: string) {
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(value)
      ? value.replace(/\./g, "")
      : value;
  return Number(normalized) || 0;
}
function quoteFormErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") return "Falha ao criar orçamento";
  const result = error as { code?: unknown; message?: unknown };
  if (result.code === "23505")
    return "Cliente já cadastrado. Pesquise e selecione o cliente existente.";
  const message = typeof result.message === "string" ? result.message : "";
  if (result.code === "42501" || /row.level security/i.test(message))
    return "Sua sessão não tem permissão para salvar este orçamento.";
  return message || "Falha ao criar orçamento";
}
function isDuplicatePhoneError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const result = error as { code?: unknown; message?: unknown };
  return (
    result.code === "23505" &&
    typeof result.message === "string" &&
    result.message.includes("leads_company_phone_key")
  );
}
async function findCompanyLeadByPhone(companyId: string, phone: string) {
  const { data, error } = await supabase
    .from("leads")
    .select("id,name")
    .eq("company_id", companyId)
    .eq("phone", phone)
    .maybeSingle();
  if (error) throw error;
  return data ?? undefined;
}

export function QuoteFormModal({
  quote,
  defaultLeadId,
  defaultConversationId,
  defaultProductId,
  suggestionReason,
  onCancel,
  onCreated,
}: QuoteFormModalProps) {
  const leads = useSyncExternalStore(subscribeRepo, getLeads, getLeads);
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const [step, setStep] = useState(1);
  const [clientMode, setClientMode] = useState<"existing" | "new">(
    defaultLeadId || quote ? "existing" : "new",
  );
  const [leadId, setLeadId] = useState(quote?.leadId ?? defaultLeadId ?? "");
  const [clientSearch, setClientSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [customer, setCustomer] = useState<QuoteCustomerDetails>({
    ...emptyCustomer,
    ...quote?.customerDetails,
  });
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [handle, setHandle] = useState("");
  const [productId, setProductId] = useState(
    quote?.productId ??
      (defaultProductId && getProduct(defaultProductId)
        ? defaultProductId
        : (products[0]?.id ?? "")),
  );
  const [description, setDescription] = useState(
    quote?.productDescription ?? getProduct(productId)?.description ?? "",
  );
  const [benefits, setBenefits] = useState(
    quote?.benefits ?? getProduct(productId)?.includedItems?.join("\n") ?? "",
  );
  const [unitPriceRaw, setUnitPriceRaw] = useState(
    String(quote?.unitPrice ?? (getProduct(productId) ? activePrice(getProduct(productId)!) : "")),
  );
  const [discountRaw, setDiscountRaw] = useState(String(quote?.discount ?? 0));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(quote?.paymentMethod ?? "Pix");
  const [installments, setInstallments] = useState(quote?.installments ?? 1);
  const [validUntil, setValidUntil] = useState(quote?.validUntil ?? todayPlusDays(7));
  const [inclusosText, setInclusosText] = useState(quote?.inclusos.join("\n") ?? "");
  const [brindesText, setBrindesText] = useState(quote?.brindes.join("\n") ?? "");
  const [porContaText, setPorContaText] = useState(quote?.porConta.join("\n") ?? "");
  const [observacoes, setObservacoes] = useState(quote?.notes ?? "");
  const [customMessage, setCustomMessage] = useState<string | null>(quote?.message ?? null);
  const [editingMessage, setEditingMessage] = useState(false);
  const [defaults, setDefaults] = useState({
    included: "",
    gifts: "",
    customer: "",
    loaded: false,
  });
  const [editDefaultsOpen, setEditDefaultsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedLead = leadId ? leads.find((lead) => lead.id === leadId) : undefined;
  useEffect(() => {
    if (!selectedLead || quote?.customerDetails) return;
    setCustomer((current) =>
      current.firstName
        ? current
        : { ...current, ...splitName(selectedLead.name), phone1: selectedLead.phone ?? "" },
    );
    setChannel(selectedLead.channel);
    setHandle(selectedLead.handle ?? "");
  }, [selectedLead, quote?.customerDetails]);
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("company_settings")
        .select(
          "default_quote_included_items,default_quote_gifts,default_quote_customer_responsibility",
        )
        .eq("company_id", companyId)
        .maybeSingle();
      if (cancelled) return;
      if (error) console.warn("load quote defaults", error);
      const included = (data?.default_quote_included_items as string | null) ?? "";
      const gifts = (data?.default_quote_gifts as string | null) ?? "";
      const responsibility = (data?.default_quote_customer_responsibility as string | null) ?? "";
      setDefaults({ included, gifts, customer: responsibility, loaded: true });
      if (!quote) {
        setInclusosText((value) => value || included);
        setBrindesText((value) => value || gifts);
        setPorContaText((value) => value || responsibility);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, quote]);

  const filteredLeads = useMemo(() => {
    const query = clientSearch.trim().toLocaleLowerCase("pt-BR");
    const phoneQuery = normalizePhone(query);
    if (!query) return [];
    return leads
      .filter(
        (lead) =>
          lead.name.toLocaleLowerCase("pt-BR").includes(query) ||
          (!!phoneQuery && normalizePhone(lead.phone ?? "").includes(phoneQuery)) ||
          (lead.handle ?? "").toLocaleLowerCase("pt-BR").includes(query),
      )
      .slice(0, 8);
  }, [leads, clientSearch]);
  const product = getProduct(productId);
  const unitPrice = parseMoney(unitPriceRaw);
  const discount = Math.max(0, Math.min(parseMoney(discountRaw), unitPrice));
  const finalValue = Math.max(0, unitPrice - discount);
  const fullName = `${customer.firstName.trim()} ${customer.lastName.trim()}`.trim();
  const phoneValid = normalizePhone(customer.phone1).length >= 8;
  const clientValid =
    clientMode === "existing"
      ? !!leadId
      : fullName.length >= 2 &&
        (channel === "whatsapp" ? phoneValid : handle.trim().length >= 2 || phoneValid);
  const autoMessage = useMemo(() => {
    if (!product) return "";
    const base = buildQuoteMessage({
      product,
      finalValue,
      installments,
      paymentMethod,
      validUntil,
      discount,
    });
    const extra: string[] = [];
    if (description.trim()) extra.push("", "Descrição:", description.trim());
    if (benefits.trim()) extra.push("", "Benefícios:", benefits.trim());
    if (inclusosText.trim()) extra.push("", "✅ Itens inclusos:", inclusosText.trim());
    if (brindesText.trim()) extra.push("", "🎁 Brindes:", brindesText.trim());
    if (porContaText.trim()) extra.push("", "⚠️ Por conta do cliente:", porContaText.trim());
    if (observacoes.trim()) extra.push("", "📝 Observações:", observacoes.trim());
    if (!extra.length) return base;
    const closing = "Posso reservar para você?";
    const introduction = base.endsWith(closing) ? base.slice(0, -closing.length).trimEnd() : base;
    return `${introduction}\n${extra.join("\n")}\n\n${closing}`;
  }, [
    product,
    finalValue,
    installments,
    paymentMethod,
    validUntil,
    discount,
    description,
    benefits,
    inclusosText,
    brindesText,
    porContaText,
    observacoes,
  ]);
  const changeCustomer = (key: keyof QuoteCustomerDetails, value: string) =>
    setCustomer((current) => ({ ...current, [key]: value }));
  const selectLead = (lead: (typeof leads)[number]) => {
    setLeadId(lead.id);
    setClientMode("existing");
    setClientSearch(lead.name);
    setSearchOpen(false);
    setCustomer({ ...emptyCustomer, ...splitName(lead.name), phone1: lead.phone ?? "" });
    setChannel(lead.channel);
    setHandle(lead.handle ?? "");
  };
  const addClient = () => {
    setLeadId("");
    setClientMode("new");
    setClientSearch("");
    setSearchOpen(false);
    setCustomer(emptyCustomer);
    setChannel("whatsapp");
    setHandle("");
  };
  const chooseProduct = (id: string) => {
    const next = getProduct(id);
    setProductId(id);
    setDescription(next?.description ?? "");
    setBenefits(next?.includedItems?.join("\n") ?? "");
    setUnitPriceRaw(String(next ? activePrice(next) : ""));
    setCustomMessage(null);
  };
  const submit = async () => {
    if (
      submitting ||
      !clientValid ||
      !product ||
      finalValue <= 0 ||
      installments < 1 ||
      !validUntil
    )
      return;
    setSubmitting(true);
    try {
      let finalLeadId = leadId;
      if (clientMode === "new") {
        const phone = normalizePhone(customer.phone1);
        const existingLead = !phone
          ? undefined
          : companyId
            ? await findCompanyLeadByPhone(companyId, phone)
            : leads.find((lead) => normalizePhone(lead.phone) === phone);
        if (existingLead) {
          finalLeadId = existingLead.id;
          toast.info(`Telefone já cadastrado. Orçamento associado a ${existingLead.name}.`);
        } else {
          try {
            const created = await createLead(
              {
                name: fullName,
                channel,
                phone: phone || undefined,
                handle: handle.trim() || undefined,
              },
              companyId,
            );
            finalLeadId = created.id;
          } catch (error) {
            if (!isDuplicatePhoneError(error) || !companyId || !phone) throw error;
            const matched = await findCompanyLeadByPhone(companyId, phone);
            if (!matched) throw error;
            finalLeadId = matched.id;
            toast.info(`Telefone já cadastrado. Orçamento associado a ${matched.name}.`);
          }
        }
      }
      const result = await createQuote(
        {
          leadId: finalLeadId,
          conversationId:
            defaultConversationId && defaultLeadId === finalLeadId
              ? defaultConversationId
              : quote?.conversationId,
          productId,
          unitPrice,
          discount,
          paymentMethod,
          installments,
          validUntil,
          message: customMessage ?? autoMessage,
          inclusos: lines(inclusosText),
          brindes: lines(brindesText),
          porConta: lines(porContaText),
          notes: observacoes.trim(),
          customerDetails: customer,
          productDescription: description,
          benefits,
        },
        quote?.id,
      );
      onCreated(result);
    } catch (error) {
      toast.error(quoteFormErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };
  const saveDefaults = async (included: string, gifts: string, responsibility: string) => {
    if (!companyId) return;
    const { error } = await supabase
      .from("company_settings")
      .update({
        default_quote_included_items: included,
        default_quote_gifts: gifts,
        default_quote_customer_responsibility: responsibility,
      })
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    setDefaults({ included, gifts, customer: responsibility, loaded: true });
    toast.success("Padrões da empresa atualizados");
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-0 backdrop-blur-sm sm:p-4"
        onClick={onCancel}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={quote ? "Editar orçamento" : "Novo Orçamento"}
          onClick={(event) => event.stopPropagation()}
          className="quote-form relative flex h-[100dvh] w-full max-w-[560px] flex-col overflow-hidden bg-black text-white shadow-2xl sm:h-[min(760px,calc(100dvh-2rem))] sm:rounded-[20px] sm:border sm:border-white/10"
        >
          <div className="shrink-0 px-6 pt-7 sm:px-10 sm:pt-9">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[clamp(2rem,4vw,2.5rem)] font-bold leading-tight tracking-tight">
                {quote ? "Editar Orçamento" : "Novo Orçamento"}
              </h2>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Fechar formulário"
                className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="relative mt-4 flex h-9 items-center rounded-full border border-white/25 pl-3 pr-[3px]">
              <input
                value={clientSearch}
                onFocus={() => setSearchOpen(true)}
                onChange={(event) => {
                  setClientSearch(event.target.value);
                  setSearchOpen(true);
                }}
                placeholder="Pesquisar Cliente"
                aria-label="Pesquisar Cliente"
                className="quote-form-search min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/45"
              />
              <button
                type="button"
                onClick={addClient}
                className="ml-2 flex h-[27px] min-w-12 items-center justify-center rounded-full bg-white px-3 text-xs font-bold text-black hover:bg-white/85"
              >
                Add
              </button>
              {searchOpen && clientSearch.trim() && (
                <div className="absolute inset-x-0 top-full z-30 mt-2 max-h-52 overflow-y-auto rounded-xl border border-white/20 bg-[#171717] p-1 shadow-xl">
                  {filteredLeads.length ? (
                    filteredLeads.map((lead) => (
                      <button
                        type="button"
                        key={lead.id}
                        onClick={() => selectLead(lead)}
                        className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10"
                      >
                        <span className="block font-semibold">{lead.name}</span>
                        <span className="text-xs text-white/50">
                          {lead.phone || lead.handle || lead.channel}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-xs text-white/50">
                      Nenhum cliente encontrado. Use Add para cadastrar.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto px-6 pb-5 pt-5 sm:px-10"
            onClick={() => searchOpen && setSearchOpen(false)}
          >
            {step === 1 && (
              <div className="space-y-5">
                <section>
                  <h3 className="mb-4 text-lg font-bold">Informações Pessoais</h3>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                    <FormField label="Nome">
                      <input
                        value={customer.firstName}
                        onChange={(event) => changeCustomer("firstName", event.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Sobrenome">
                      <input
                        value={customer.lastName}
                        onChange={(event) => changeCustomer("lastName", event.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Email" className="col-span-2">
                      <input
                        type="email"
                        value={customer.email}
                        onChange={(event) => changeCustomer("email", event.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Telefone 1">
                      <input
                        type="tel"
                        value={customer.phone1}
                        onChange={(event) => changeCustomer("phone1", event.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Telefone 2">
                      <input
                        type="tel"
                        value={customer.phone2}
                        onChange={(event) => changeCustomer("phone2", event.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                  </div>
                </section>
                <section>
                  <h3 className="mb-4 text-lg font-bold">Endereço</h3>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                    <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_5rem] gap-x-5">
                      <FormField label="Rua">
                        <input
                          value={customer.street}
                          onChange={(event) => changeCustomer("street", event.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                      <FormField label="Número">
                        <input
                          inputMode="numeric"
                          value={customer.number}
                          onChange={(event) => changeCustomer("number", event.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                    </div>
                    <FormField label="Cidade">
                      <input
                        value={customer.city}
                        onChange={(event) => changeCustomer("city", event.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Bairro">
                      <input
                        value={customer.neighborhood}
                        onChange={(event) => changeCustomer("neighborhood", event.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Estado">
                      <input
                        value={customer.state}
                        onChange={(event) => changeCustomer("state", event.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="CEP">
                      <input
                        value={customer.postalCode}
                        onChange={(event) => changeCustomer("postalCode", event.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                  </div>
                </section>
                {clientMode === "new" && (
                  <details className="text-sm text-white/60">
                    <summary className="cursor-pointer">Canal do novo cliente</summary>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <FormField label="Canal">
                        <select
                          value={channel}
                          onChange={(event) => setChannel(event.target.value as Channel)}
                          className={inputClass}
                        >
                          <option value="whatsapp">WhatsApp</option>
                          <option value="instagram">Instagram</option>
                          <option value="facebook">Facebook</option>
                        </select>
                      </FormField>
                      {channel !== "whatsapp" && (
                        <FormField label="@ usuário">
                          <input
                            value={handle}
                            onChange={(event) => setHandle(event.target.value)}
                            className={inputClass}
                          />
                        </FormField>
                      )}
                    </div>
                  </details>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <section>
                  <h3 className="mb-4 text-lg font-bold">Produto</h3>
                  <div className="space-y-5">
                    <FormField label="Nome do Produto">
                      <select
                        value={productId}
                        onChange={(event) => chooseProduct(event.target.value)}
                        className={inputClass}
                      >
                        {!productId && <option value="">Selecione um produto</option>}
                        {products.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    {defaultProductId && suggestionReason && productId === defaultProductId && (
                      <p className="text-xs text-white/60">Sugerido pela IA: {suggestionReason}</p>
                    )}
                    <FormField label="Descrição">
                      <textarea
                        value={description}
                        onChange={(event) => {
                          setDescription(event.target.value);
                          setCustomMessage(null);
                        }}
                        rows={7}
                        className={`${inputClass} resize-y`}
                      />
                    </FormField>
                    <FormField label="Benefícios">
                      <textarea
                        value={benefits}
                        onChange={(event) => {
                          setBenefits(event.target.value);
                          setCustomMessage(null);
                        }}
                        rows={3}
                        className={`${inputClass} resize-y`}
                      />
                    </FormField>
                  </div>
                </section>
                <details className="rounded-lg border border-white/10 px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-semibold text-white/70">
                    Conteúdo adicional do orçamento
                  </summary>
                  <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!defaults.loaded}
                        onClick={() => {
                          setInclusosText(defaults.included);
                          setBrindesText(defaults.gifts);
                          setPorContaText(defaults.customer);
                          setCustomMessage(null);
                        }}
                        className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs disabled:opacity-40"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Aplicar padrão
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditDefaultsOpen(true)}
                        className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs"
                      >
                        <Settings2 className="h-3 w-3" />
                        Editar padrão
                      </button>
                    </div>
                    <FormField label="Itens inclusos">
                      <textarea
                        value={inclusosText}
                        onChange={(event) => {
                          setInclusosText(event.target.value);
                          setCustomMessage(null);
                        }}
                        rows={3}
                        className={`${inputClass} resize-y`}
                      />
                    </FormField>
                    <FormField label="Brindes">
                      <textarea
                        value={brindesText}
                        onChange={(event) => {
                          setBrindesText(event.target.value);
                          setCustomMessage(null);
                        }}
                        rows={3}
                        className={`${inputClass} resize-y`}
                      />
                    </FormField>
                    <FormField label="Por conta do cliente">
                      <textarea
                        value={porContaText}
                        onChange={(event) => {
                          setPorContaText(event.target.value);
                          setCustomMessage(null);
                        }}
                        rows={3}
                        className={`${inputClass} resize-y`}
                      />
                    </FormField>
                    <FormField label="Observações">
                      <textarea
                        value={observacoes}
                        onChange={(event) => {
                          setObservacoes(event.target.value);
                          setCustomMessage(null);
                        }}
                        rows={3}
                        className={`${inputClass} resize-y`}
                      />
                    </FormField>
                  </div>
                </details>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <section>
                  <h3 className="mb-4 text-lg font-bold">Pagamento</h3>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                    <FormField label="Valor" className="col-span-2 max-w-[48%]">
                      <input
                        inputMode="decimal"
                        value={unitPriceRaw}
                        onChange={(event) => {
                          setUnitPriceRaw(event.target.value.replace(/[^\d,.]/g, ""));
                          setCustomMessage(null);
                        }}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Desconto (R$)">
                      <input
                        inputMode="decimal"
                        value={discountRaw}
                        onChange={(event) => {
                          setDiscountRaw(event.target.value.replace(/[^\d,.]/g, ""));
                          setCustomMessage(null);
                        }}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Forma de Pagamento">
                      <select
                        value={paymentMethod}
                        onChange={(event) => {
                          setPaymentMethod(event.target.value as PaymentMethod);
                          setCustomMessage(null);
                        }}
                        className={inputClass}
                      >
                        {PAYMENT_METHODS.map((method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Parcelas">
                      <select
                        value={installments}
                        onChange={(event) => {
                          setInstallments(Number(event.target.value));
                          setCustomMessage(null);
                        }}
                        className={inputClass}
                      >
                        {[1, 2, 3, 4, 6, 10, 12, 18, 24].map((count) => (
                          <option key={count} value={count}>
                            {count === 1 ? "À vista" : `${count}x`}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Válido até">
                      <input
                        type="date"
                        value={validUntil}
                        onChange={(event) => {
                          setValidUntil(event.target.value);
                          setCustomMessage(null);
                        }}
                        className={inputClass}
                      />
                    </FormField>
                  </div>
                  <p className="mt-4 text-sm text-white/60">
                    Valor final: <strong className="text-white">{formatBRL(finalValue)}</strong>
                  </p>
                </section>
                <details className="rounded-lg border border-white/10 px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-semibold text-white/70">
                    Mensagem pronta para envio
                  </summary>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMessage(true);
                        setCustomMessage(customMessage ?? autoMessage);
                      }}
                      className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs"
                    >
                      <Pencil className="h-3 w-3" />
                      Editar mensagem
                    </button>
                    {customMessage !== null && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomMessage(null);
                          setEditingMessage(false);
                        }}
                        className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Restaurar automática
                      </button>
                    )}
                  </div>
                  {editingMessage ? (
                    <textarea
                      aria-label="Mensagem pronta para envio"
                      value={customMessage ?? autoMessage}
                      onChange={(event) => setCustomMessage(event.target.value)}
                      rows={9}
                      className={`${inputClass} mt-3 resize-y`}
                    />
                  ) : (
                    <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-white/5 p-3 font-sans text-xs leading-relaxed">
                      {customMessage ?? autoMessage}
                    </pre>
                  )}
                </details>
              </div>
            )}
          </div>

          <div className="relative flex shrink-0 items-center justify-between gap-3 px-6 pb-7 pt-3 sm:px-10 sm:pb-9">
            <div className="min-w-[75px]">
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => setStep(step - 1)}
                  className="rounded-full bg-[#242424] px-5 py-2 text-sm font-semibold hover:bg-white/20"
                >
                  Voltar
                </button>
              )}
            </div>
            <div
              aria-label={`Etapa ${step} de 3`}
              className="absolute left-1/2 flex -translate-x-1/2 gap-1"
            >
              {[1, 2, 3].map((item) => (
                <span
                  key={item}
                  className={`h-1.5 w-7 rounded-full ${item === step ? "bg-white" : "bg-[#484848]"}`}
                />
              ))}
            </div>
            {step < 3 ? (
              <button
                type="button"
                disabled={step === 1 ? !clientValid : !product}
                onClick={() => setStep(step + 1)}
                className="ml-auto rounded-full bg-white px-5 py-2 text-sm font-bold text-black hover:bg-white/85 disabled:opacity-40"
              >
                Avançar
              </button>
            ) : (
              <button
                type="button"
                disabled={!clientValid || !product || finalValue <= 0 || !validUntil || submitting}
                onClick={() => void submit()}
                className="ml-auto flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-bold text-black hover:bg-white/85 disabled:opacity-40"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {quote ? "Salvar" : "Criar"}
              </button>
            )}
          </div>
        </div>
      </div>
      <EditDefaultsDialog
        open={editDefaultsOpen}
        onOpenChange={setEditDefaultsOpen}
        initialIncluded={defaults.included}
        initialGifts={defaults.gifts}
        initialCustomer={defaults.customer}
        onSave={saveDefaults}
      />
    </>
  );
}

export function EditDefaultsDialog({
  open,
  onOpenChange,
  initialIncluded,
  initialGifts,
  initialCustomer,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialIncluded: string;
  initialGifts: string;
  initialCustomer: string;
  onSave: (included: string, gifts: string, responsibility: string) => Promise<void>;
}) {
  const [included, setIncluded] = useState(initialIncluded);
  const [gifts, setGifts] = useState(initialGifts);
  const [responsibility, setResponsibility] = useState(initialCustomer);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setIncluded(initialIncluded);
      setGifts(initialGifts);
      setResponsibility(initialCustomer);
    }
  }, [open, initialIncluded, initialGifts, initialCustomer]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar textos padrão dos orçamentos</DialogTitle>
          <DialogDescription>
            Esses textos serão usados nos novos orçamentos da empresa e podem ser ajustados em cada
            proposta.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Itens inclusos">
            <textarea
              value={included}
              onChange={(event) => setIncluded(event.target.value)}
              rows={4}
              className="w-full rounded-md bg-input p-3"
            />
          </FormField>
          <FormField label="Brindes">
            <textarea
              value={gifts}
              onChange={(event) => setGifts(event.target.value)}
              rows={4}
              className="w-full rounded-md bg-input p-3"
            />
          </FormField>
          <FormField label="Por conta do cliente">
            <textarea
              value={responsibility}
              onChange={(event) => setResponsibility(event.target.value)}
              rows={4}
              className="w-full rounded-md bg-input p-3"
            />
          </FormField>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md bg-secondary px-4 py-2 text-sm"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(included, gifts, responsibility);
                onOpenChange(false);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Erro ao salvar padrões");
              } finally {
                setSaving(false);
              }
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {saving ? "Salvando…" : "Salvar padrão"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
