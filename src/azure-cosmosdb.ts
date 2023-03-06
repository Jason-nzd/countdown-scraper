// Used by index.ts for creating and accessing items stored in Azure CosmosDB
import { Container, CosmosClient, Database, FeedOptions, SqlQuerySpec } from '@azure/cosmos';
import * as dotenv from 'dotenv';
import { logPriceChange, logError, log, colour } from './logging.js';
import { Product, upsertResponse } from './typings';
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

// Function for insert/updating a product object to CosmosDB,
//  returns an upsertResponse based on if and how the Product was updated
export async function upsertProductToCosmosDB(scrapedProduct: Product): Promise<upsertResponse> {
  try {
    // Check CosmosDB for any existing item using id and name as the partition key
    const cosmosResponse = await container
      .item(scrapedProduct.id as string, scrapedProduct.name)
      .read();

    // If an existing item was found in CosmosDB, check for update values before uploading
    if (cosmosResponse.statusCode === 200) {
      const dbProduct = (await cosmosResponse.resource) as Product;
      const updatedProduct = buildUpdatedProduct(scrapedProduct, dbProduct);

      if (updatedProduct === undefined) return upsertResponse.AlreadyUpToDate;
      else {
        // Send updated product to CosmosDB
        await container.items.upsert(updatedProduct);

        // UpsertResponse based on price or info changed
        if (dbProduct.currentPrice != updatedProduct.currentPrice) {
          return upsertResponse.PriceChanged;
        } else {
          return upsertResponse.InfoChanged;
        }
      }
    } else if (cosmosResponse.statusCode === 404) {
      // If product doesn't yet exist in CosmosDB, upsert as-is
      await container.items.create(scrapedProduct);

      console.log(
        `New Product: ${scrapedProduct.name.slice(0, 47).padEnd(47)}` +
          ` - $${scrapedProduct.currentPrice}`
      );

      return upsertResponse.NewProduct;
    } else if (cosmosResponse.statusCode === 409) {
      logError(`Conflicting ID found for product ${scrapedProduct.name}`);
      return upsertResponse.Failed;
    } else {
      // If CosmoDB returns a status code other than 200 or 404, manage other errors here
      logError(`CosmosDB returned status code: ${cosmosResponse.statusCode}`);
      return upsertResponse.Failed;
    }
  } catch (error) {
    return upsertResponse.Failed;
  }
}

function buildUpdatedProduct(scrapedProduct: Product, dbProduct: Product): Product | undefined {
  // If price has changed, and not on the same day
  if (
    dbProduct.currentPrice != scrapedProduct.currentPrice &&
    dbProduct.lastUpdated.toDateString() != scrapedProduct.lastUpdated.toDateString()
  ) {
    // Push scraped priceHistory into existing priceHistory array
    dbProduct.priceHistory.push(scrapedProduct.priceHistory[0]);

    // Set the scrapedProduct to use the updated priceHistory
    scrapedProduct.priceHistory = dbProduct.priceHistory;

    // Return completed Product ready for uploading
    logPriceChange(dbProduct, scrapedProduct.currentPrice);
    return scrapedProduct;
  }

  // If category has changed and is not Uncategorised, update Product
  else if (
    dbProduct.category.join(' ') !== scrapedProduct.category.join(' ') &&
    scrapedProduct.category[0] !== 'Uncategorised'
  ) {
    // Update category
    dbProduct.category = scrapedProduct.category;

    // Also set size and sourceSite
    dbProduct.sourceSite = scrapedProduct.sourceSite;
    dbProduct.size = scrapedProduct.size;

    // Return completed Product ready for uploading
    return dbProduct;

    // If only size or sourceSite have changed, update Product
  } else if (
    dbProduct.sourceSite !== scrapedProduct.sourceSite ||
    dbProduct.size !== scrapedProduct.size
  ) {
    console.log(
      dbProduct.name.padEnd(60) +
        'source/size changed:\t' +
        dbProduct.sourceSite +
        ' / ' +
        scrapedProduct.sourceSite +
        '\t' +
        dbProduct.name.padEnd(60) +
        'changed:\t' +
        dbProduct.size +
        ' / ' +
        scrapedProduct.size
    );

    // Set size and sourceSite
    dbProduct.sourceSite = scrapedProduct.sourceSite;
    dbProduct.size = scrapedProduct.size;

    // Return completed Product ready for uploading
    return dbProduct;
  } else {
    // Nothing has changed, no upsert is required
    return undefined;
  }
}

// Function for running custom queries - used primarily for debugging
export async function customQuery(): Promise<void> {
  // Establish CosmosDB connection
  const containerResponse = await database.containers.createIfNotExists({
    id: 'products-temp',
    partitionKey: { paths: partitionKey },
  });
  let container2 = containerResponse.container;

  const options: FeedOptions = {
    maxItemCount: 20,
  };
  const secondsDelayBetweenBatches = 30;
  const querySpec: SqlQuerySpec = {
    query: "SELECT * FROM products p where p.name='Countdown NZ Beef Mince 18 Fat Grass Fed'",
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

        log(colour.green, 'Batch: ' + batchCount + ' - Items: ' + products.length);

        products.forEach(async (product) => {
          console.log('Duplicating: ' + product.name);

          var item = await container.item(product.id, product.name);

          //let dbProduct: Product = (await item.read()).resource;
          let dbItem = (await item.read()).resource;

          let oldDateString = dbItem.lastUpdated;
          let utcDate = new Date(oldDateString);
          dbItem.lastUpdated = utcDate;
          dbItem.id = 'delete' + batchCount;

          var response = await container2.items.upsert(dbItem);

          //dbProduct.lastUpdated = dbProduct.priceHistory[dbProduct.priceHistory.length - 1].date;

          //dbProduct.sourceSite = 'countdown.co.nz';

          //var response = await container.items.upsert(dbProduct);
          console.log(response.statusCode);
        });

        if (batchCount++ === maxBatchCount) continueFetching = false;

        resolve();
      }, secondsDelayBetweenBatches * 1000)
    );
  }
}
