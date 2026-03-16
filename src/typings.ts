export interface Product {
  id: string;
  name: string;
  size?: string;
  currentPrice: number;
  category: string;
  unitPrice?: string;
}

// Sample CosmosDB Document:
// {
//     "id": "123456",
//     "name": "Flying Sriracha Sauce Black",
//     "category": "sauces",
//     "size": "455mL",
//     "sourceSite": "countdown.co.nz",
//     "lastChecked": "2023-05-22",
//     "priceHistory": [
//         {
//             "date": "2023-01-13",
//             "price": 5.99
//         },
//         {
//             "date": "2023-01-14",
//             "price": 7.5
//         }
//     ],
//     "unitPrice": "16.48/L",
// }
export interface DBProduct {
  id: string;
  name: string;
  size?: string;
  lastChecked: string;
  priceHistory: DatedPrice[];
  sourceSite: string;
  category: string;
  unitPrice?: string;
}
export interface DatedPrice {
  date: string;
  price: number;
}

// Response interface and enum for cosmosdb queries
export interface ProductResponse {
  upsertType: UpsertResponse;
  dbProduct: DBProduct;
}
export const enum UpsertResponse {
  NewProduct,
  PriceChanged,
  AlreadyUpToDate,
  Failed,
}

// Urls to scrape should have an associated category
export interface CategorisedUrl {
  url: string;
  category: string;
}
