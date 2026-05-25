// Catálogo de produtos do Atende Ai!
// Store reativo com dois modos:
//  - "demo": dados mock em memória (compatível com seed em localStorage existente).
//  - "remote": lê e escreve na tabela `products` do Supabase (filtrado por company_id via RLS).
//
// A API pública (listProducts, createProduct, updateProduct, deleteProduct, etc.) é
// mantida igual à versão antiga para reduzir refactor nas telas. As mutações em modo
// remoto fazem optimistic update local + persistência no banco; o canal realtime
// reflete mudanças vindas de outras sessões.

import { supabase } from "@/integrations/supabase/client";

export type ProductCategory =
  | "Piscinas de fibra"
  | "Piscinas de vinil"
  | "Troca de vinil"
  | "Aquecedores"
  | "Spas e banheiras"
  | "Acessórios"
  | "Tratamento de água";

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  "Piscinas de fibra",
  "Piscinas de vinil",
  "Troca de vinil",
  "Aquecedores",
  "Spas e banheiras",
  "Acessórios",
  "Tratamento de água",
];

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  description?: string;
  price: number;
  promoPrice?: number;
  notes?: string;
  images: string[];
}


const STORAGE_KEY = "atendeai.products.v1";

const seed: Product[] = [
  {
    id: "p1",
    name: "Piscina de fibra 6x3",
    category: "Piscinas de fibra",
    description: "Piscina retangular 6,00 x 3,00 x 1,40m, cor azul.",
    price: 28500,
    promoPrice: 27500,
    notes: "Inclui escada inox 3 degraus.",
  },
  {
    id: "p2",
    name: "Piscina de fibra 5x2,5",
    category: "Piscinas de fibra",
    price: 21900,
    notes: "Modelo familiar compacto.",
  },
  {
    id: "p3",
    name: "Piscina de vinil 5x2,5",
    category: "Piscinas de vinil",
    price: 18700,
  },
  {
    id: "p4",
    name: "Troca de vinil 4x2",
    category: "Troca de vinil",
    description: "Substituição da manta de vinil para piscinas até 4x2m.",
    price: 4800,
  },
  {
    id: "p5",
    name: "Aquecedor solar para piscina pequena",
    category: "Aquecedores",
    description: "Kit com 4 placas + acessórios.",
    price: 14200,
    promoPrice: 12900,
  },
  {
    id: "p6",
    name: "Trocador de calor 75.000 BTU",
    category: "Aquecedores",
    price: 8900,
  },
  {
    id: "p7",
    name: "Spa 4 lugares + instalação",
    category: "Spas e banheiras",
    description: "Spa hidromassagem 4 lugares com instalação completa inclusa.",
    price: 42000,
    notes: "Frete e instalação inclusos para região metropolitana.",
  },
  {
    id: "p8",
    name: "Kit acessórios premium",
    category: "Acessórios",
    description: "Aspirador, peneira, escova e mangueira 9m.",
    price: 1200,
  },
  {
    id: "p9",
    name: "Tratamento mensal de água",
    category: "Tratamento de água",
    description: "Pacote mensal com produtos e visita técnica quinzenal.",
    price: 320,
  },
];

// ---------- modo & estado ----------
type Mode = "demo" | "remote";
let mode: Mode = "demo";
let companyId: string | null = null;

export function getProductsCompanyId(): string | null {
  return companyId;
}

let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

function loadFromStorage(): Product[] {
  if (typeof window === "undefined") return seed;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed;
    const parsed = JSON.parse(raw) as Product[];
    if (!Array.isArray(parsed)) return seed;
    return parsed;
  } catch {
    return seed;
  }
}

function saveToStorage(items: Product[]) {
  if (typeof window === "undefined" || mode !== "demo") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore quota errors
  }
}

let _products: Product[] = loadFromStorage();
const listeners = new Set<() => void>();

function emit() {
  if (mode === "demo") saveToStorage(_products);
  for (const l of listeners) l();
}

// Lista exportada — referência mutável para compatibilidade com código antigo.
export const products: Product[] = _products;

function syncExportedRef() {
  products.length = 0;
  products.push(..._products);
}

export function listProducts(): Product[] {
  return _products;
}

export function subscribeProducts(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getProduct(id: string): Product | undefined {
  return _products.find((p) => p.id === id);
}

export function activePrice(p: Product): number {
  return p.promoPrice ?? p.price;
}

function genId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- mappers ----------
type DbProduct = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  price: number | string | null;
  promo_price: number | string | null;
  notes: string | null;
};

function toProduct(r: DbProduct): Product {
  const cat = (r.category as ProductCategory) ?? PRODUCT_CATEGORIES[0];
  return {
    id: r.id,
    name: r.name,
    category: PRODUCT_CATEGORIES.includes(cat) ? cat : PRODUCT_CATEGORIES[0],
    description: r.description ?? undefined,
    price: r.price != null ? Number(r.price) : 0,
    promoPrice: r.promo_price != null ? Number(r.promo_price) : undefined,
    notes: r.notes ?? undefined,
  };
}

// ---------- modo ----------
export function getProductsMode(): Mode {
  return mode;
}

export function setProductsMode(next: Mode) {
  if (mode === next) return;
  mode = next;
  if (next === "demo") {
    _products = loadFromStorage();
    syncExportedRef();
    detachRealtime();
    companyId = null;
    emit();
  }
}

function attachRealtime(cid: string) {
  detachRealtime();
  realtimeChannel = supabase
    .channel(`products-${cid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "products", filter: `company_id=eq.${cid}` },
      (payload) => {
        if (payload.eventType === "INSERT") {
          const p = toProduct(payload.new as DbProduct);
          if (!_products.some((x) => x.id === p.id)) {
            _products = [p, ..._products];
            syncExportedRef();
            emit();
          }
        } else if (payload.eventType === "UPDATE") {
          const p = toProduct(payload.new as DbProduct);
          _products = _products.map((x) => (x.id === p.id ? p : x));
          syncExportedRef();
          emit();
        } else if (payload.eventType === "DELETE") {
          const oldId = (payload.old as { id?: string }).id;
          if (oldId) {
            _products = _products.filter((x) => x.id !== oldId);
            syncExportedRef();
            emit();
          }
        }
      },
    )
    .subscribe();
}

function detachRealtime() {
  if (realtimeChannel) {
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

// ---------- carga remota ----------
export async function loadProductsRemote(cid: string) {
  companyId = cid;
  mode = "remote";
  const { data, error } = await supabase
    .from("products")
    .select("id,name,category,description,price,promo_price,notes")
    .eq("company_id", cid)
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("loadProductsRemote", error);
    return;
  }
  _products = (data ?? []).map((r) => toProduct(r as DbProduct));
  syncExportedRef();
  attachRealtime(cid);
  emit();
}

// ---------- mutações ----------
export async function createProduct(input: Omit<Product, "id">): Promise<Product> {
  if (mode === "remote" && companyId) {
    const { data, error } = await supabase
      .from("products")
      .insert({
        company_id: companyId,
        name: input.name,
        category: input.category,
        description: input.description ?? null,
        price: input.price,
        promo_price: input.promoPrice ?? null,
        notes: input.notes ?? null,
      })
      .select("id,name,category,description,price,promo_price,notes")
      .single();
    if (error) throw error;
    const product = toProduct(data as DbProduct);
    if (!_products.some((p) => p.id === product.id)) {
      _products = [product, ..._products];
      syncExportedRef();
      emit();
    }
    return product;
  }
  // demo
  const product: Product = { id: genId(), ...input };
  _products = [product, ..._products];
  syncExportedRef();
  emit();
  return product;
}

export async function updateProduct(
  id: string,
  patch: Partial<Omit<Product, "id">>,
): Promise<Product | undefined> {
  if (mode === "remote" && companyId) {
    const dbPatch: {
      name?: string;
      category?: string | null;
      description?: string | null;
      price?: number;
      promo_price?: number | null;
      notes?: string | null;
    } = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.category !== undefined) dbPatch.category = patch.category;
    if (patch.description !== undefined) dbPatch.description = patch.description ?? null;
    if (patch.price !== undefined) dbPatch.price = patch.price;
    if (patch.promoPrice !== undefined) dbPatch.promo_price = patch.promoPrice ?? null;
    if (patch.notes !== undefined) dbPatch.notes = patch.notes ?? null;
    const { data, error } = await supabase
      .from("products")
      .update(dbPatch)
      .eq("id", id)
      .select("id,name,category,description,price,promo_price,notes")
      .single();
    if (error) throw error;
    const updated = toProduct(data as DbProduct);
    _products = _products.map((p) => (p.id === id ? updated : p));
    syncExportedRef();
    emit();
    return updated;
  }
  // demo
  let updated: Product | undefined;
  _products = _products.map((p) => {
    if (p.id !== id) return p;
    updated = { ...p, ...patch };
    return updated;
  });
  syncExportedRef();
  emit();
  return updated;
}

export async function deleteProduct(id: string): Promise<void> {
  if (mode === "remote" && companyId) {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
  }
  _products = _products.filter((p) => p.id !== id);
  syncExportedRef();
  emit();
}

// ---------- seed ----------
export async function seedMockProductsIntoCompany(cid: string) {
  const rows = seed.map((p) => ({
    company_id: cid,
    name: p.name,
    category: p.category,
    description: p.description ?? null,
    price: p.price,
    promo_price: p.promoPrice ?? null,
    notes: p.notes ?? null,
  }));
  const { error } = await supabase.from("products").insert(rows);
  if (error) throw error;
}
