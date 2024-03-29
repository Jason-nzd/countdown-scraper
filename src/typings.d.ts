export interface Product {
  id: string;
  name: string;
  size?: string;
  currentPrice: number;
  lastUpdated: Date;
  lastChecked: Date;
  priceHistory: DatedPrice[];
  sourceSite: string;
  category: string[];
  unitPrice?: number;
  unitName?: string;
  originalUnitQuantity?: number;
}

export interface DatedPrice {
  date: Date;
  price: number;
}

export interface ProductResponse {
  upsertType: UpsertResponse;
  product: Product;
}

export interface CategorisedUrl {
  url: string;
  categories: string[];
}

export const enum UpsertResponse {
  NewProduct,
  PriceChanged,
  InfoChanged,
  AlreadyUpToDate,
  Failed,
}
