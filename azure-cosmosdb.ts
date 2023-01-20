// Used by index.js for creating and accessing items stored in Azure CosmosDB
import { CosmosClient } from '@azure/cosmos';
import * as dotenv from 'dotenv';
import { DatedPrice, Product } from './typings';
dotenv.config();

// Create CosmosDB client using connection string stored in .env
console.log(`--- Connecting to CosmosDB..`);
const COSMOS_CONSTRING = process.env.COSMOS_CONSTRING;
if (!COSMOS_CONSTRING) {
  throw Error('CosmosDB Connection string COSMOS_CONSTRING not found in .env');
}
const cosmosClient = new CosmosClient(COSMOS_CONSTRING);

// Connect to supermarket-prices database
const { database } = await cosmosClient.databases.createIfNotExists({ id: 'supermarket-prices' });

// Set Partition Key
const partitionKey = ['/name'];

// Connect to products container
const { container } = await database.containers.createIfNotExists({
  id: 'products',
  partitionKey: { paths: partitionKey },
});

// Function for insert/updating a product object to CosmosDB
// returns true if a product is inserted/updated, false if already up-to-date
export async function upsertProductToCosmosDB(scrapedProduct: Product): Promise<boolean> {
  // Check CosmosDB for any existing item using id and name as the partition key
  const cosmosResponse = await container
    .item(scrapedProduct.id as string, scrapedProduct.name)
    .read();

  // If an existing item was found in CosmosDB
  if (cosmosResponse.statusCode === 200) {
    // Get the existing item as a Product object
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
          scrapedProduct.name.slice(0, 30) +
          ' - from $' +
          existingProduct.currentPrice +
          ' to $' +
          scrapedProduct.currentPrice
      );

      // Push into priceHistory array, and update currentPrice
      existingProduct.priceHistory.push(newDatedPrice);
      existingProduct.currentPrice = scrapedProduct.currentPrice;

      // Send completed product object to cosmosdb
      await container.items.upsert(existingProduct);
      return true;
    } else if (new Date().getDate() === 1) {
      // Always add a price history entry on the 1st of every month, even if no price change
      existingProduct.priceHistory.push(newDatedPrice);

      // Send completed product object to cosmosdb
      await container.items.upsert(existingProduct);

      // Return false as no price has actually changed
      return false;
    } else {
      // Price hasn't changed
      // console.log(
      //   `Product ${scrapedProduct.id} exists with same price of ${scrapedProduct.currentPrice}`
      // );
      return false;
    }

    // If product doesn't exist in CosmosDB,
  } else if (cosmosResponse.statusCode === 404) {
    // Create a new priceHistory array and push the initial DatedPrice into it
    const priceHistory: DatedPrice[] = [];
    const initialDatedPrice: DatedPrice = {
      date: new Date().toDateString(),
      price: scrapedProduct.currentPrice as number,
    };
    priceHistory.push(initialDatedPrice);
    scrapedProduct.priceHistory = priceHistory;

    console.log(`- Product Added: ${scrapedProduct.name.slice(0, 50)}`);

    // Send completed product object to cosmosdb
    await container.items.create(scrapedProduct);
    return true;
  } else {
    // If cosmos returns a status code other than 200 or 404, manage other errors here
    console.log(`CosmosDB returned status code: ${cosmosResponse.statusCode}`);
    return false;
  }
}
