// Catálogo de produtos do Atende Ai!
// Store reativo com persistência em localStorage. Permite criar, editar e excluir.

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
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore quota errors
  }
}

let _products: Product[] = loadFromStorage();
const listeners = new Set<() => void>();

function emit() {
  saveToStorage(_products);
  for (const l of listeners) l();
}

// Lista exportada — mantida como referência mutável para compatibilidade,
// mas componentes devem usar useProducts() para reatividade.
export const products: Product[] = _products;

export function listProducts(): Product[] {
  return _products;
}

export function subscribeProducts(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
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

export function createProduct(input: Omit<Product, "id">): Product {
  const product: Product = { id: genId(), ...input };
  _products = [product, ..._products];
  // manter referência exportada sincronizada
  products.length = 0;
  products.push(..._products);
  emit();
  return product;
}

export function updateProduct(id: string, patch: Partial<Omit<Product, "id">>): Product | undefined {
  let updated: Product | undefined;
  _products = _products.map((p) => {
    if (p.id !== id) return p;
    updated = { ...p, ...patch };
    return updated;
  });
  products.length = 0;
  products.push(..._products);
  emit();
  return updated;
}

export function deleteProduct(id: string): void {
  _products = _products.filter((p) => p.id !== id);
  products.length = 0;
  products.push(..._products);
  emit();
}
