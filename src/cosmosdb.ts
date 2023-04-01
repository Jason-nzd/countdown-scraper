// Used by index.ts for creating and accessing items stored in Azure CosmosDB
import { Container, CosmosClient, Database, FeedOptions, SqlQuerySpec } from '@azure/cosmos';
import * as dotenv from 'dotenv';
import { logError, log, colour, validCategories } from './utilities.js';
import { DatedPrice, Product, UpsertResponse, ProductResponse } from './typings';
dotenv.config();

const cosmosDatabaseName = 'supermarket-prices';
const cosmosContainerName = 'products';
const partitionKey = ['/name'];

// Get CosmosDB connection string stored in .env
const COSMOS_CONSTRING = process.env.COSMOS_CONSTRING;
if (!COSMOS_CONSTRING) {
  throw Error('CosmosDB connection string COSMOS_CONSTRING not found in .env');
}

// Establish CosmosDB connection
let cosmosClient: CosmosClient;
let database: Database;
let container: Container;
try {
  cosmosClient = new CosmosClient(COSMOS_CONSTRING);
  const databaseResponse = await cosmosClient.databases.createIfNotExists({
    id: cosmosDatabaseName,
  });
  database = databaseResponse.database;
  const containerResponse = await database.containers.createIfNotExists({
    id: cosmosContainerName,
    partitionKey: { paths: partitionKey },
  });
  container = containerResponse.container;
} catch (error) {
  logError('Invalid CosmosDB connection - check for valid connection string');
}

// upsertProductToCosmosDB()
// -------------------------
// Inserts or updates a product object to CosmosDB,
//  returns an UpsertResponse based on if and how the Product was updated

export async function upsertProductToCosmosDB(scrapedProduct: Product): Promise<UpsertResponse> {
  try {
    // Check CosmosDB for any existing item using id and name as the partition key
    const cosmosResponse = await container
      .item(scrapedProduct.id as string, scrapedProduct.name)
      .read();

    // If an existing item was found in CosmosDB, check for update values before uploading
    if (cosmosResponse.statusCode === 200) {
      const dbProduct = (await cosmosResponse.resource) as Product;
      const response = buildUpdatedProduct(scrapedProduct, dbProduct);

      // Send updated product to CosmosDB
      await container.items.upsert(response.product);
      return response.upsertType;
    }

    // If product doesn't yet exist in CosmosDB, upsert as-is
    else if (cosmosResponse.statusCode === 404) {
      await container.items.create(scrapedProduct);

      console.log(
        `  New Product: ${scrapedProduct.name.slice(0, 47).padEnd(47)}` +
          ` | $${scrapedProduct.currentPrice}`
      );

      return UpsertResponse.NewProduct;
    }
    // Manage any failed cosmos updates
    else if (cosmosResponse.statusCode === 409) {
      logError(`Conflicting ID found for product ${scrapedProduct.name}`);
      return UpsertResponse.Failed;
    } else {
      // If CosmoDB returns a status code other than 200 or 404, manage other errors here
      logError(`CosmosDB returned status code: ${cosmosResponse.statusCode}`);
      return UpsertResponse.Failed;
    }
  } catch (e: any) {
    logError(e);
    return UpsertResponse.Failed;
  }
}

// buildUpdatedProduct()
// ---------------------
// This takes a freshly scraped product and compares it with a found database product.
//  It returns an updated product with data from both product versions

function buildUpdatedProduct(scrapedProduct: Product, dbProduct: Product): ProductResponse {
  // Date objects pulled from CosmosDB need to re-parsed as strings in format yyyy-mm-dd
  let dbDay = dbProduct.lastUpdated.toString();
  dbDay = dbDay.slice(0, 10);
  let scrapedDay = scrapedProduct.lastUpdated.toISOString().slice(0, 10);

  // If price has changed, and not on the same day
  if (dbProduct.currentPrice != scrapedProduct.currentPrice && dbDay != scrapedDay) {
    // Push scraped priceHistory into existing priceHistory array
    dbProduct.priceHistory.push(scrapedProduct.priceHistory[0]);

    // Set the scrapedProduct to use the updated priceHistory
    scrapedProduct.priceHistory = dbProduct.priceHistory;

    // Return completed Product ready for uploading
    logPriceChange(dbProduct, scrapedProduct.currentPrice);
    return {
      upsertType: UpsertResponse.PriceChanged,
      product: scrapedProduct,
    };
  }

  // If any db categories are not included within the list of valid ones, update to scraped ones
  else if (
    !dbProduct.category.every((category) => {
      const isValid = validCategories.includes(category);
      return isValid;
    }) ||
    dbProduct.category === null
  ) {
    console.log(
      `  Categories Changed: ${scrapedProduct.name.padEnd(40).substring(0, 40)}` +
        ` - ${dbProduct.category.join(' ')} > ${scrapedProduct.category.join(' ')}`
    );

    // Update everything but priceHistory and lastUpdated
    scrapedProduct.priceHistory = dbProduct.priceHistory;
    scrapedProduct.lastUpdated = dbProduct.lastUpdated;

    // Return completed Product ready for uploading
    return {
      upsertType: UpsertResponse.InfoChanged,
      product: scrapedProduct,
    };
  }

  // If only unitPrice, size or sourceSite have changed, update Product
  else if (
    dbProduct.sourceSite !== scrapedProduct.sourceSite ||
    dbProduct.size !== scrapedProduct.size ||
    dbProduct.unitPrice !== scrapedProduct.unitPrice
  ) {
    // Update everything but priceHistory and lastUpdated
    scrapedProduct.priceHistory = dbProduct.priceHistory;
    scrapedProduct.lastUpdated = dbProduct.lastUpdated;

    // Return completed Product ready for uploading
    return {
      upsertType: UpsertResponse.InfoChanged,
      product: scrapedProduct,
    };
  } else {
    // Nothing has changed, only update lastChecked
    dbProduct.lastChecked = scrapedProduct.lastChecked;
    return {
      upsertType: UpsertResponse.AlreadyUpToDate,
      product: dbProduct,
    };
  }
}

// logPriceChange()
// ----------------
// Log a per product price change message,
//  coloured green for price reduction, red for price increase

export function logPriceChange(product: Product, newPrice: number) {
  const priceIncreased = newPrice > product.currentPrice;
  log(
    priceIncreased ? colour.red : colour.green,
    '  Price ' +
      (priceIncreased ? 'Up   : ' : 'Down : ') +
      product.name.slice(0, 47).padEnd(47) +
      ' | $' +
      product.currentPrice.toString().padStart(4) +
      ' > $' +
      newPrice
  );
}

// customQuery()
// -------------
// Function for running custom DB queries - used primarily for debugging

export async function customQuery(): Promise<void> {
  const options: FeedOptions = {
    maxItemCount: 10,
  };
  const secondsDelayBetweenBatches = 3;
  const querySpec: SqlQuerySpec = {
    query: "SELECT * FROM products p where contains(p.name, '  ', false)",
  };

  log(colour.yellow, querySpec.query);

  const response = await container.items.query(querySpec, options);

  let batchCount = 0;
  const maxBatchCount = 100;
  let continueFetching = true;

  await (async () => {
    while (response.hasMoreResults() && continueFetching) {
      await delayedBatchFetch();
    }
  })();

  console.log('Custom Query Complete');
  return;

  function delayedBatchFetch() {
    return new Promise<void>((resolve) =>
      setTimeout(async () => {
        const batch = await response.fetchNext();
        const products = batch.resources as Product[];
        const items = batch.resources;

        items.forEach(async (item) => {
          console.log(item.name);

          // item.name = item.name.replace('  ', ' ').trim();
          // let p: Product = item as Product;

          const res = await container.item(item.id, item.name).delete();
          console.log('delete ' + res.statusCode);

          // const uploadRes = await container.items.upsert(p);
          // console.log('upload ' + uploadRes.statusCode);
        });

        if (batchCount++ === maxBatchCount) continueFetching = false;

        resolve();
      }, secondsDelayBetweenBatches * 1000)
    );
  }
}
