import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ListChecks,
  Loader2,
  MapPin,
  MessageCircle,
  MessageSquareText,
  Package as PackageIcon,
  Pencil,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
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
import { quoteHue, quoteInitials } from "@/lib/quote-presentation";
import "./quotes.css";

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
const BRAZILIAN_STATES = [
  ["AC", "Acre"],
  ["AL", "Alagoas"],
  ["AP", "Amapá"],
  ["AM", "Amazonas"],
  ["BA", "Bahia"],
  ["CE", "Ceará"],
  ["DF", "Distrito Federal"],
  ["ES", "Espírito Santo"],
  ["GO", "Goiás"],
  ["MA", "Maranhão"],
  ["MT", "Mato Grosso"],
  ["MS", "Mato Grosso do Sul"],
  ["MG", "Minas Gerais"],
  ["PA", "Pará"],
  ["PB", "Paraíba"],
  ["PR", "Paraná"],
  ["PE", "Pernambuco"],
  ["PI", "Piauí"],
  ["RJ", "Rio de Janeiro"],
  ["RN", "Rio Grande do Norte"],
  ["RS", "Rio Grande do Sul"],
  ["RO", "Rondônia"],
  ["RR", "Roraima"],
  ["SC", "Santa Catarina"],
  ["SP", "São Paulo"],
  ["SE", "Sergipe"],
  ["TO", "Tocantins"],
] as const;
// Styled by `.lq-form .quote-form-input` (quotes.css); the class also drives the autofill fix.
const inputClass = "quote-form-input";
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
  const [direction, setDirection] = useState(1);
  const reduceMotion = useReducedMotion();
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
  const [cepLoading, setCepLoading] = useState(false);
  const [stateMenuOpen, setStateMenuOpen] = useState(false);

  const selectedLead = leadId ? leads.find((lead) => lead.id === leadId) : undefined;
  useEffect(() => {
    const cep = customer.postalCode.replace(/\D/g, "");
    if (cep.length !== 8) {
      setCepLoading(false);
      return;
    }
    const controller = new AbortController();
    setCepLoading(true);
    void fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("CEP indisponível");
        return response.json() as Promise<{
          erro?: boolean;
          logradouro?: string;
          bairro?: string;
          localidade?: string;
          uf?: string;
        }>;
      })
      .then((address) => {
        if (address.erro) {
          toast.error("CEP não encontrado");
          return;
        }
        setCustomer((current) => ({
          ...current,
          street: address.logradouro || current.street,
          neighborhood: address.bairro || current.neighborhood,
          city: address.localidade || current.city,
          state: address.uf || current.state,
        }));
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") {
          toast.error("Não foi possível consultar o CEP");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCepLoading(false);
      });
    return () => controller.abort();
  }, [customer.postalCode]);
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

  const steps = [
    {
      label: "Cliente",
      hint: quote ? "Confira quem recebe a proposta." : "Para quem é a proposta?",
    },
    { label: "Produto", hint: "O que você está oferecendo?" },
    { label: "Pagamento", hint: "Como o cliente vai pagar?" },
  ];
  const canReach = (target: number) =>
    target <= step || (target === 2 && clientValid) || (target === 3 && clientValid && !!product);
  const goTo = (target: number) => {
    if (!canReach(target) || target === step) return;
    setDirection(target > step ? 1 : -1);
    setStep(target);
  };
  const discountPct = unitPrice > 0 ? Math.round((discount / unitPrice) * 100) : 0;
  const validDays = Math.round(
    (new Date(validUntil + "T12:00:00").getTime() -
      new Date(todayPlusDays(0) + "T12:00:00").getTime()) /
      86_400_000,
  );
  const extraCount = [inclusosText, brindesText, porContaText, observacoes].filter((value) =>
    value.trim(),
  ).length;

  return (
    <>
      <div className="lq-black-backdrop" onClick={onCancel}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={quote ? "Editar orçamento" : "Novo Orçamento"}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
          }}
          className="quote-form lq-black lq-panel lq-form"
        >
          <span className="lq-panel-glow" aria-hidden="true" />
          <div className="lq-form-head">
            <div className="lq-form-title">
              <div>
                <h2>{quote ? "Editar orçamento" : "Novo orçamento"}</h2>
                <p>{steps[step - 1].hint}</p>
              </div>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Fechar formulário"
                className="lq-close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="lq-stepper" aria-label={`Etapa ${step} de 3`}>
              {steps.map((item, index) => {
                const target = index + 1;
                return (
                  <button
                    type="button"
                    key={item.label}
                    onClick={() => goTo(target)}
                    disabled={!canReach(target)}
                    aria-current={target === step ? "step" : undefined}
                    data-state={target === step ? "current" : target < step ? "done" : "todo"}
                  >
                    <i aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            {step === 1 && (
              <div className="lq-client-search">
                <div className="lq-client-box">
                  <Search aria-hidden="true" />
                  <input
                    value={clientSearch}
                    onFocus={() => setSearchOpen(true)}
                    onChange={(event) => {
                      setClientSearch(event.target.value);
                      setSearchOpen(true);
                    }}
                    placeholder="Buscar cliente por nome ou telefone"
                    aria-label="Pesquisar Cliente"
                    className="quote-form-search"
                  />
                  <button type="button" onClick={addClient}>
                    <UserPlus aria-hidden="true" />
                    Novo
                  </button>
                </div>
                {searchOpen && clientSearch.trim() && (
                  <div className="lq-client-results">
                    {filteredLeads.length ? (
                      filteredLeads.map((lead) => (
                        <button type="button" key={lead.id} onClick={() => selectLead(lead)}>
                          <span
                            className="lq-avatar"
                            aria-hidden="true"
                            style={
                              {
                                "--hue": quoteHue(lead.id),
                                width: 32,
                                height: 32,
                                fontSize: 11,
                              } as CSSProperties
                            }
                          >
                            {quoteInitials(lead.name)}
                          </span>
                          <span className="min-w-0">
                            <b className="truncate">{lead.name}</b>
                            <small>{lead.phone || lead.handle || lead.channel}</small>
                          </span>
                        </button>
                      ))
                    ) : (
                      <p>Nenhum cliente encontrado. Toque em Novo para cadastrar.</p>
                    )}
                  </div>
                )}
                {clientMode === "existing" && selectedLead && (
                  <div className="lq-client-chip">
                    <span
                      className="lq-avatar"
                      aria-hidden="true"
                      style={{ "--hue": quoteHue(selectedLead.id) } as CSSProperties}
                    >
                      {quoteInitials(selectedLead.name)}
                    </span>
                    <span>
                      <b>{selectedLead.name}</b> <small>· cliente cadastrado</small>
                    </span>
                    <button type="button" onClick={addClient}>
                      Trocar
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            className="lq-form-body"
            onClick={() => {
              if (searchOpen) setSearchOpen(false);
              if (stateMenuOpen) setStateMenuOpen(false);
            }}
          >
            <motion.div
              key={step}
              initial={reduceMotion ? false : { opacity: 0, x: direction * 28 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              {step === 1 && (
                <>
                  <section className="lq-section">
                    <h3 className="lq-section-title">
                      <span aria-hidden="true">
                        <UserRound />
                      </span>
                      Informações pessoais
                    </h3>
                    <div className="lq-fields">
                      <FormField label="Nome">
                        <input
                          value={customer.firstName}
                          autoComplete="given-name"
                          onChange={(event) => changeCustomer("firstName", event.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                      <FormField label="Sobrenome">
                        <input
                          value={customer.lastName}
                          autoComplete="family-name"
                          onChange={(event) => changeCustomer("lastName", event.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                      <FormField label="Telefone 1">
                        <input
                          type="tel"
                          value={customer.phone1}
                          placeholder="(00) 00000-0000"
                          onChange={(event) => changeCustomer("phone1", event.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                      <FormField label="Telefone 2">
                        <input
                          type="tel"
                          value={customer.phone2}
                          placeholder="Opcional"
                          onChange={(event) => changeCustomer("phone2", event.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                      <FormField label="Email" className="lq-span-2">
                        <input
                          type="email"
                          value={customer.email}
                          placeholder="Opcional"
                          onChange={(event) => changeCustomer("email", event.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                    </div>
                  </section>
                  <section className="lq-section">
                    <h3 className="lq-section-title">
                      <span aria-hidden="true">
                        <MapPin />
                      </span>
                      Endereço
                    </h3>
                    <div className="lq-fields">
                      <FormField label="CEP">
                        <input
                          value={customer.postalCode}
                          inputMode="numeric"
                          autoComplete="postal-code"
                          placeholder="00000-000"
                          onChange={(event) => {
                            const digits = event.target.value.replace(/\D/g, "").slice(0, 8);
                            changeCustomer(
                              "postalCode",
                              digits.length > 5
                                ? `${digits.slice(0, 5)}-${digits.slice(5)}`
                                : digits,
                            );
                          }}
                          className={inputClass}
                        />
                        <span className="lq-hint">
                          {cepLoading ? "Buscando endereço…" : "Preenche rua, bairro e cidade."}
                        </span>
                      </FormField>
                      <FormField label="Estado">
                        <div className="relative">
                          <button
                            type="button"
                            aria-label="Selecionar estado"
                            aria-expanded={stateMenuOpen}
                            onClick={(event) => {
                              event.stopPropagation();
                              setStateMenuOpen((open) => !open);
                            }}
                            className={`${inputClass} flex items-center justify-between text-left`}
                          >
                            <span className={customer.state ? "text-white" : "text-white/40"}>
                              {customer.state
                                ? (BRAZILIAN_STATES.find(([uf]) => uf === customer.state)?.[1] ??
                                  customer.state)
                                : "Selecione"}
                            </span>
                            <ChevronDown className="h-4 w-4 text-white/60" />
                          </button>
                          {stateMenuOpen && (
                            <div className="lq-state-menu" role="listbox">
                              {BRAZILIAN_STATES.map(([uf, name]) => (
                                <button
                                  type="button"
                                  key={uf}
                                  role="option"
                                  aria-selected={customer.state === uf}
                                  onClick={() => {
                                    changeCustomer("state", uf);
                                    setStateMenuOpen(false);
                                  }}
                                >
                                  <span>{name}</span>
                                  <small>{uf}</small>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </FormField>
                      <div className="lq-span-2 grid grid-cols-[minmax(0,1fr)_6rem] gap-x-3.5">
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
                      <FormField label="Bairro">
                        <input
                          value={customer.neighborhood}
                          onChange={(event) => changeCustomer("neighborhood", event.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                      <FormField label="Cidade">
                        <input
                          value={customer.city}
                          onChange={(event) => changeCustomer("city", event.target.value)}
                          className={inputClass}
                        />
                      </FormField>
                    </div>
                  </section>
                  {clientMode === "new" && (
                    <details className="lq-extra">
                      <summary>
                        <MessageCircle className="h-4 w-4 text-white/60" aria-hidden="true" />
                        Canal do novo cliente
                        <small>{channel === "whatsapp" ? "WhatsApp" : channel}</small>
                        <ChevronDown aria-hidden="true" />
                      </summary>
                      <div className="lq-extra-body">
                        <div className="lq-fields">
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
                      </div>
                    </details>
                  )}
                </>
              )}

              {step === 2 && (
                <section className="lq-section">
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
                    <span className="lq-hint-ai">
                      <Sparkles aria-hidden="true" />
                      Sugerido pela IA: {suggestionReason}
                    </span>
                  )}
                  {product && (
                    <div className="lq-product">
                      <span aria-hidden="true">
                        <PackageIcon />
                      </span>
                      <div>
                        <b>{product.name}</b>
                        <small>Preço de tabela</small>
                      </div>
                      <strong>{formatBRL(activePrice(product))}</strong>
                    </div>
                  )}
                  <div className="mt-5 grid gap-4">
                    <FormField label="Descrição">
                      <textarea
                        value={description}
                        onChange={(event) => {
                          setDescription(event.target.value);
                          setCustomMessage(null);
                        }}
                        rows={6}
                        placeholder="Detalhes do produto que o cliente precisa saber"
                        className={inputClass}
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
                        placeholder="Um benefício por linha"
                        className={inputClass}
                      />
                    </FormField>
                  </div>
                  <details className="lq-extra">
                    <summary>
                      <ListChecks className="h-4 w-4 text-white/60" aria-hidden="true" />
                      Conteúdo adicional
                      <small>
                        {extraCount
                          ? `${extraCount} preenchido${extraCount > 1 ? "s" : ""}`
                          : "opcional"}
                      </small>
                      <ChevronDown aria-hidden="true" />
                    </summary>
                    <div className="lq-extra-body">
                      <div className="lq-extra-actions">
                        <button
                          type="button"
                          disabled={!defaults.loaded}
                          onClick={() => {
                            setInclusosText(defaults.included);
                            setBrindesText(defaults.gifts);
                            setPorContaText(defaults.customer);
                            setCustomMessage(null);
                          }}
                        >
                          <RotateCcw aria-hidden="true" />
                          Aplicar padrão
                        </button>
                        <button type="button" onClick={() => setEditDefaultsOpen(true)}>
                          <Settings2 aria-hidden="true" />
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
                          placeholder="Um item por linha"
                          className={inputClass}
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
                          className={inputClass}
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
                          className={inputClass}
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
                          className={inputClass}
                        />
                      </FormField>
                    </div>
                  </details>
                </section>
              )}

              {step === 3 && (
                <section className="lq-section">
                  <div className="lq-fields">
                    <FormField label="Valor">
                      <div className="lq-money" data-prefix="R$">
                        <input
                          inputMode="decimal"
                          value={unitPriceRaw}
                          onChange={(event) => {
                            setUnitPriceRaw(event.target.value.replace(/[^\d,.]/g, ""));
                            setCustomMessage(null);
                          }}
                          className={inputClass}
                        />
                      </div>
                    </FormField>
                    <div>
                      <FormField label="Desconto (R$)">
                        <div className="lq-money" data-prefix="R$">
                          <input
                            inputMode="decimal"
                            value={discountRaw}
                            onChange={(event) => {
                              setDiscountRaw(event.target.value.replace(/[^\d,.]/g, ""));
                              setCustomMessage(null);
                            }}
                            className={inputClass}
                          />
                        </div>
                      </FormField>
                      <div className="lq-chips" role="group" aria-label="Desconto rápido">
                        {[0, 5, 10, 15].map((pct) => (
                          <button
                            type="button"
                            key={pct}
                            aria-pressed={discountPct === pct}
                            disabled={unitPrice <= 0}
                            onClick={() => {
                              setDiscountRaw(String(Math.round(unitPrice * pct) / 100));
                              setCustomMessage(null);
                            }}
                          >
                            {pct === 0 ? "Nenhum" : `${pct}%`}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="lq-span-2">
                      <span className="lq-field-label" id="lq-payment-label">
                        Forma de pagamento
                      </span>
                      <div
                        className="lq-chips lq-chips-lg"
                        role="radiogroup"
                        aria-labelledby="lq-payment-label"
                      >
                        {PAYMENT_METHODS.map((method) => (
                          <button
                            type="button"
                            role="radio"
                            key={method}
                            aria-checked={paymentMethod === method}
                            onClick={() => {
                              setPaymentMethod(method);
                              setCustomMessage(null);
                            }}
                          >
                            {method}
                          </button>
                        ))}
                      </div>
                    </div>
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
                            {count === 1
                              ? "À vista"
                              : `${count}x de ${formatBRL(finalValue / count)}`}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <div>
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
                      <div className="lq-chips" role="group" aria-label="Validade rápida">
                        {[7, 15, 30].map((days) => (
                          <button
                            type="button"
                            key={days}
                            aria-pressed={validDays === days}
                            onClick={() => {
                              setValidUntil(todayPlusDays(days));
                              setCustomMessage(null);
                            }}
                          >
                            {days} dias
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="lq-total" aria-live="polite">
                    <dl>
                      <dt>Valor do produto</dt>
                      <dd>{formatBRL(unitPrice)}</dd>
                      <dt>Desconto{discountPct > 0 ? ` (${discountPct}%)` : ""}</dt>
                      <dd>{discount > 0 ? `− ${formatBRL(discount)}` : formatBRL(0)}</dd>
                    </dl>
                    <div className="lq-total-final">
                      <span>
                        Total · {paymentMethod}
                        {installments > 1
                          ? ` · ${installments}x de ${formatBRL(finalValue / installments)}`
                          : " · à vista"}
                      </span>
                      <strong>{formatBRL(finalValue)}</strong>
                    </div>
                  </div>
                  <details className="lq-extra lq-message">
                    <summary>
                      <MessageSquareText className="h-4 w-4 text-white/60" aria-hidden="true" />
                      Mensagem pronta para envio
                      <small>{customMessage !== null ? "editada" : "automática"}</small>
                      <ChevronDown aria-hidden="true" />
                    </summary>
                    <div className="lq-extra-body">
                      <div className="lq-extra-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMessage(true);
                            setCustomMessage(customMessage ?? autoMessage);
                          }}
                        >
                          <Pencil aria-hidden="true" />
                          Editar mensagem
                        </button>
                        {customMessage !== null && (
                          <button
                            type="button"
                            onClick={() => {
                              setCustomMessage(null);
                              setEditingMessage(false);
                            }}
                          >
                            <RotateCcw aria-hidden="true" />
                            Restaurar automática
                          </button>
                        )}
                      </div>
                      {editingMessage ? (
                        <textarea
                          aria-label="Mensagem pronta para envio"
                          value={customMessage ?? autoMessage}
                          onChange={(event) => setCustomMessage(event.target.value)}
                          rows={10}
                          className={inputClass}
                        />
                      ) : (
                        <pre>{customMessage ?? autoMessage}</pre>
                      )}
                    </div>
                  </details>
                </section>
              )}
            </motion.div>
          </div>

          <div className="lq-form-foot">
            {step > 1 ? (
              <button type="button" onClick={() => goTo(step - 1)} className="lq-secondary">
                Voltar
              </button>
            ) : null}
            <p className="lq-foot-note">
              {step === 1
                ? clientValid
                  ? `Cliente: ${fullName || selectedLead?.name || ""}`
                  : "Preencha nome, sobrenome e telefone para continuar."
                : product && (
                    <>
                      {product.name} · <b>{formatBRL(finalValue)}</b>
                    </>
                  )}
            </p>
            {step < 3 ? (
              <button
                type="button"
                disabled={step === 1 ? !clientValid : !product}
                onClick={() => goTo(step + 1)}
                className="lq-primary"
              >
                Avançar
                <ArrowRight aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!clientValid || !product || finalValue <= 0 || !validUntil || submitting}
                onClick={() => void submit()}
                className="lq-primary"
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
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-3xl">
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
              className="w-full rounded-xl border bg-input p-3 text-sm"
            />
          </FormField>
          <FormField label="Brindes">
            <textarea
              value={gifts}
              onChange={(event) => setGifts(event.target.value)}
              rows={4}
              className="w-full rounded-xl border bg-input p-3 text-sm"
            />
          </FormField>
          <FormField label="Por conta do cliente">
            <textarea
              value={responsibility}
              onChange={(event) => setResponsibility(event.target.value)}
              rows={4}
              className="w-full rounded-xl border bg-input p-3 text-sm"
            />
          </FormField>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-full border px-5 py-2 text-sm font-semibold"
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
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {saving ? "Salvando…" : "Salvar padrão"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
