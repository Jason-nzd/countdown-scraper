export interface Product {
  id: string;
  name: string;
  size?: string;
  currentPrice: number;
  lastUpdated: string;
  priceHistory: DatedPrice[];
  sourceSite: string;
  category: string[];
}

export interface DatedPrice {
  date: string;
  price: number;
}

export const enum upsertResponse {
  NewProduct,
  PriceChanged,
  InfoChanged,
  AlreadyUpToDate,
  Failed,
}
