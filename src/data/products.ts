// Catálogo de produtos do Atende Ai!
// Mock — substituir por backend depois. Categorias configuráveis para qualquer negócio.

export type ProductCategory =
  | "Piscinas de fibra"
  | "Piscinas de vinil"
  | "Troca de vinil"
  | "Aquecedores"
  | "Spas e banheiras"
  | "Acessórios"
  | "Tratamento de água";

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  description?: string;
  price: number;
  promoPrice?: number;
  notes?: string;
}

export const products: Product[] = [
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

export function getProduct(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

export function activePrice(p: Product): number {
  return p.promoPrice ?? p.price;
}
