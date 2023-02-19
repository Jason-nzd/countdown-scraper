// Used by index.ts for creating and accessing items stored in Azure CosmosDB
import { Container, CosmosClient, Database, FeedOptions, SqlQuerySpec } from '@azure/cosmos';
import * as dotenv from 'dotenv';
import { log, colour } from './logging.js';
import { DatedPrice, Product, upsertResponse } from './typings';
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
  log(colour.red, 'Invalid CosmosDB connection - check for valid connection string');
}

// Function for insert/updating a product object to CosmosDB,
//  returns an upsertResponse based on if and how the Product was updated
export async function upsertProductToCosmosDB(scrapedProduct: Product): Promise<upsertResponse> {
  let response: upsertResponse | undefined = undefined;

  // Check CosmosDB for any existing item using id and name as the partition key
  const cosmosResponse = await container
    .item(scrapedProduct.id as string, scrapedProduct.name)
    .read();

  // If an existing item was found in CosmosDB, run various checks before updating
  if (cosmosResponse.statusCode === 200) {
    let existingProduct = (await cosmosResponse.resource) as Product;

    // If price has changed
    if (existingProduct.currentPrice != scrapedProduct.currentPrice) {
      logPriceChange(existingProduct, scrapedProduct.currentPrice);

      // Push scraped priceHistory into existing priceHistory array, and update currentPrice
      existingProduct.priceHistory.push(scrapedProduct.priceHistory[0]);
      existingProduct.currentPrice = scrapedProduct.currentPrice;
      response = response ?? upsertResponse.PriceChanged;

      // If scraped category is not null and has changed, update it
    } else if (
      scrapedProduct.category != '' &&
      scrapedProduct.category !== existingProduct.category
    ) {
      existingProduct.category = scrapedProduct.category;
      response = response ?? upsertResponse.CategoryChanged;
    }

    // If a response has been set using nullish coalescing, Product is now ready to send to CosmosDB
    if (response != undefined) {
      await container.items.upsert(existingProduct);
      return response;
    } else {
      // Nothing has changed, no upsert is required
      return upsertResponse.AlreadyUpToDate;
    }

    // If product doesn't yet exist in CosmosDB,
  } else if (cosmosResponse.statusCode === 404) {
    console.log(
      `    New Product: ${scrapedProduct.name.slice(0, 47).padEnd(47)} - $${
        scrapedProduct.currentPrice
      }`
    );

    // Send completed Product object to CosmosDB
    await container.items.create(scrapedProduct);
    return upsertResponse.NewProductAdded;
  } else if (cosmosResponse.statusCode === 409) {
    log(colour.red, `Conflicting ID found for product ${scrapedProduct.name}`);
    return upsertResponse.Failed;
  } else {
    // If CosmoDB returns a status code other than 200 or 404, manage other errors here
    log(colour.red, `CosmosDB returned status code: ${cosmosResponse.statusCode}`);
    return upsertResponse.Failed;
  }
}

// Function for running custom queries - used primarily for debugging
export async function cosmosQuery(): Promise<void> {
  const options: FeedOptions = {
    maxItemCount: 20,
  };
  const querySpec: SqlQuerySpec = {
    query: 'SELECT * FROM products p WHERE ARRAY_LENGTH(p.priceHistory)>3',
  };

  const response = await container.items.query(querySpec, options);

  let batchCount = 0;
  const maxBatchCount = 3;
  let continueFetching = true;

  await (async () => {
    while (response.hasMoreResults() && continueFetching) {
      await delayedBatchFetch();
    }
  })();

  function delayedBatchFetch() {
    return new Promise<void>((resolve) =>
      setTimeout(async () => {
        const batch = await response.fetchNext();
        const products = batch.resources as Product[];

        products.forEach(async (product) => {
          console.log(product.name);
        });

        if (batchCount++ === maxBatchCount) continueFetching = false;

        resolve();
      }, 8000)
    );
  }
}

// Log a specific price change message,
//  coloured green for price reduction, red for price increase
function logPriceChange(product: Product, newPrice: Number) {
  const priceIncreased = newPrice > product.currentPrice;
  log(
    priceIncreased ? colour.red : colour.green,
    'Price ' +
      (priceIncreased ? 'Increased: ' : 'Decreased: ') +
      product.name.slice(0, 46).padEnd(46) +
      ' - from $' +
      product.currentPrice +
      ' to $' +
      newPrice
  );
}
