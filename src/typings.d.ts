export interface Product {
  id: string;
  name: string;
  size?: string;
  currentPrice: number;
  lastUpdated: Date;
  priceHistory: DatedPrice[];
  sourceSite: string;
  category: string[];
}

export interface DatedPrice {
  date: Date;
  price: number;
}

export const enum upsertResponse {
  NewProduct,
  PriceChanged,
  InfoChanged,
  AlreadyUpToDate,
  Failed,
}
