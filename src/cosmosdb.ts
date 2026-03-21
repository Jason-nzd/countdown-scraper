import * as dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: `.env.local`, override: true });

import { CosmosClient, Container } from "@azure/cosmos";
import { logError, log, colour } from "./utilities";
import { Product, UpsertResponse, ProductResponse, DBProduct, DatedPrice } from "./typings";

let cosmosClient: CosmosClient;
let container: Container;
let partitionKey: string;

const today = new Date().toISOString().split('T')[0];

export async function establishCosmosDB() {
  // Get CosmosDB connection string stored in .env
  const COSMOS_CONSTRING = process.env.COSMOS_CONSTRING;
  if (!COSMOS_CONSTRING) {
    throw Error(
      "CosmosDB connection string COSMOS_CONSTRING not found in .env"
    );
  }

  // Ensure partition key is in correct format
  partitionKey = process.env.COSMOS_PARTITION_KEY || "";
  if (partitionKey.charAt(0) != "/") partitionKey = "/" + partitionKey;

  // Establish CosmosDB Client, Database, Container
  try {
    cosmosClient = new CosmosClient(COSMOS_CONSTRING);

    // Connect to database & container
    const database = await cosmosClient.database(process.env.COSMOS_DB_NAME!);
    container = await database.container(process.env.COSMOS_CONTAINER!);

    // Test container connection and log container name
    const containerDef = await container.read();
    console.log(`Connected to CosmosDB Container:${containerDef.resource!.id} PK:${partitionKey} `);

  } catch (error) {
    throw Error(error + "\n\nInvalid CosmosDB connection - check for valid connection string");
  }

  // Test that some products can be read and parsed as DBProducts
  try {
    const testDocuments = await container.items.query(
      { query: "SELECT TOP 5 * FROM c" }
    ).fetchAll();

    // Test 5 products were found
    const products = testDocuments.resources as DBProduct[];
    if (products.length < 5) throw new Error()

    // Test that data fields can be read
    products.map((p) => {
      if (p.name.length < 3) throw new Error();
    });

  } catch (error: any) {
    logError(`Error reading from and parsing DB products: ${error.message}`);
    process.exit(1);
  }
}

// upsertProductToCosmosDB()
// -------------------------
// Inserts or updates a product object to CosmosDB,
//  returns an UpsertResponse based on if and how the Product was updated

export async function upsertProductToCosmosDB(
  scrapedProduct: Product
): Promise<UpsertResponse> {
  try {
    // Check CosmosDB for any existing item using id and partition key
    let partitionQuery = await container
      .item(scrapedProduct.id, scrapedProduct.category)
      .read();
    let statusCode = partitionQuery.statusCode;
    let resource = partitionQuery.resource;

    // If unable to find with partition key, try searching by id across all partitions
    if (statusCode != 200) {
      const crossPartitionQuery = await container.items
        .query({
          query: "SELECT * FROM c WHERE c.id = @id",
          parameters: [{ name: "@id", value: scrapedProduct.id }]
        })
        .fetchAll();

      if (crossPartitionQuery.resources && crossPartitionQuery.resources.length > 0) {
        resource = crossPartitionQuery.resources[0];
        statusCode = 200;
      }
    }

    if (statusCode === 200) {
      // If an existing item was found in CosmosDB, check for updated values before uploading
      const dbProduct = (await resource) as DBProduct;
      const response = buildUpdatedDBProduct(scrapedProduct, dbProduct);

      // Send updated product to CosmosDB
      await container.items.upsert(response.dbProduct);

      // Return response type for logging
      return response.upsertType;
    }

    else if (statusCode === 404) {
      // If product with ID doesn't yet exist, create new cosmos document
      const dbProduct = transformToDBProduct(scrapedProduct);
      await container.items.create(dbProduct);

      console.log(
        `  New Product: ${scrapedProduct.name.slice(0, 47).padEnd(47)}` +
        ` | $ ${scrapedProduct.currentPrice}`
      );

      return UpsertResponse.NewProduct;
    } else {
      // If CosmoDB returns a status code other than 200 or 404, manage other errors here
      logError(`CosmosDB returned status code: ${statusCode}`);
      return UpsertResponse.Failed;
    }
  } catch (e: any) {
    logError(e);
    return UpsertResponse.Failed;
  }
}

// buildUpdatedDBProduct()
// ---------------------
// This takes a freshly scraped product and compares it with a found database product.
// It returns an updated product with data from both product versions
function buildUpdatedDBProduct(
  scrapedProduct: Product,
  dbProduct: DBProduct
): ProductResponse {
  try {
    // Set dbProduct's lastChecked to today to signify it is up to date
    dbProduct.lastChecked = today

    // Measure the price difference between scraped and db product
    const dbLastPrice = dbProduct.priceHistory[dbProduct.priceHistory.length - 1].price;
    const priceDifference = Math.abs(
      dbLastPrice - scrapedProduct.currentPrice
    );

    // If price has changed by more than $0.05,
    // and doesn't already have a price entry for today
    const dbLastUpdated = dbProduct.priceHistory[dbProduct.priceHistory.length - 1].date;
    if (priceDifference > 0.05 && dbLastUpdated != today) {
      // Push scraped priceHistory into existing priceHistory array
      const newDatedPrice = {
        date: today,
        price: scrapedProduct.currentPrice
      }
      dbProduct.priceHistory.push(newDatedPrice);

      logPriceChange(dbProduct);

      // Return completed dbProduct ready for uploading
      return {
        upsertType: UpsertResponse.PriceChanged,
        dbProduct: dbProduct,
      };
    }
    else {
      // Else return dbProduct with only .lastChecked being updated
      return {
        upsertType: UpsertResponse.AlreadyUpToDate,
        dbProduct: dbProduct,
      };
    }
  }
  catch (error: any) {
    logError("Error building updated DBproduct: " + error.message)
    process.exit(1);
  }

}

// transformToDBProduct
// --------------------
// Transform a raw scraped product into one compatible with the cosmosdb model
function transformToDBProduct(p: Product): DBProduct {
  const firstDatedPrice: DatedPrice = {
    date: today,
    price: p.currentPrice
  }
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    size: p.size,
    priceHistory: [firstDatedPrice],
    lastChecked: today,
    sourceSite: "countdown.co.nz",
    unitPrice: p.unitPrice
  }
}

// logPriceChange()
// ----------------
// Log per product price change
export function logPriceChange(p: DBProduct) {
  const newPrice = p.priceHistory[p.priceHistory.length - 1].price;
  const oldPrice = p.priceHistory[p.priceHistory.length - 2].price;

  const priceIncreased = newPrice > oldPrice;
  log(
    priceIncreased ? colour.red : colour.green,
    "  Price " + (priceIncreased ? "Up   : " : "Down : ") +
    `${p.name.slice(0, 47).padEnd(47)} | $ ${oldPrice.toFixed(2)} > $${newPrice.toFixed(2)}`
  );
}