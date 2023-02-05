// Used by index.js for creating and accessing items stored in Azure CosmosDB
import { Container, CosmosClient, Database } from '@azure/cosmos';
import * as dotenv from 'dotenv';
import { DatedPrice, Product, upsertResponse } from './typings';
dotenv.config();

const cosmosDatabaseName = 'supermarket-prices';
const cosmosContainerName = 'products';
const partitionKey = ['/name'];

// Get CosmosDB connection string stored in .env
console.log(`--- Connecting to CosmosDB..`);
const COSMOS_CONSTRING = process.env.COSMOS_CONSTRING;
if (!COSMOS_CONSTRING) {
  throw Error('CosmosDB Connection string COSMOS_CONSTRING not found in .env');
}

// Create CosmosDB clients
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
  console.log('Invalid CosmosDB connection');
}

// Function for insert/updating a product object to CosmosDB, returns a upsertReponse
export async function upsertProductToCosmosDB(scrapedProduct: Product): Promise<upsertResponse> {
  let response: upsertResponse | undefined = undefined;

  // Check CosmosDB for any existing item using id and name as the partition key
  const cosmosResponse = await container
    .item(scrapedProduct.id as string, scrapedProduct.name)
    .read();

  // If an existing item was found in CosmosDB, run various checks before updating
  if (cosmosResponse.statusCode === 200) {
    let existingProduct = (await cosmosResponse.resource) as Product;

    // Create a DatedPrice object, which may be added into the product
    const newDatedPrice: DatedPrice = {
      date: new Date().toDateString(),
      price: scrapedProduct.currentPrice,
    };

    // If price has changed
    if (existingProduct.currentPrice != scrapedProduct.currentPrice) {
      console.log(
        '- Price Updated: ' +
          scrapedProduct.name.slice(0, 40).padEnd(40, ' ') +
          ' - from $' +
          existingProduct.currentPrice +
          ' to $' +
          scrapedProduct.currentPrice
      );

      // Push into priceHistory array, and update currentPrice
      existingProduct.priceHistory.push(newDatedPrice);
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

    // If a response has been set, something has changed and is now ready to send to cosmosdb
    if (response != undefined) {
      await container.items.upsert(existingProduct);
      return response;

      // Nothing has changed, no upsert is required
    } else {
      return upsertResponse.AlreadyUpToDate;
    }

    // If product doesn't exist in CosmosDB,
  } else if (cosmosResponse.statusCode === 404) {
    // Create the initial DatedPrice and set it as the first priceHistory entry
    const initialDatedPrice: DatedPrice = {
      date: new Date().toDateString(),
      price: scrapedProduct.currentPrice as number,
    };
    scrapedProduct.priceHistory = [initialDatedPrice];

    console.log(
      `- New Product: ${scrapedProduct.name.slice(0, 40).padEnd(40, ' ')} \t - $${
        scrapedProduct.currentPrice
      }`
    );

    // Send completed product object to cosmosdb
    await container.items.create(scrapedProduct);
    return upsertResponse.NewProductAdded;
  } else if (cosmosResponse.statusCode === 409) {
    console.log(`Conflicting ID found for product ${scrapedProduct.name}`);
    return upsertResponse.Failed;
  } else {
    // If cosmos returns a status code other than 200 or 404, manage other errors here
    console.log(`CosmosDB returned status code: ${cosmosResponse.statusCode}`);
    return upsertResponse.Failed;
  }
}

export async function cosmosQuery(query: string) {
  let eq = 'SELECT * FROM products p WHERE CONTAINS(p.name, milk)';

  const cosmosResponse = await await container.items.query(eq).fetchNext();
  const results = cosmosResponse.resources as Product[];

  results.forEach((product) => {
    console.log(product.name);
  });
}
