// Used by index.js for creating and accessing items stored in Azure CosmosDB
import { CosmosClient } from '@azure/cosmos';
import * as dotenv from 'dotenv';
import { DatedPrice, Product } from './typings';
dotenv.config();

// Create Cosmos client using connection string stored in .env
console.log(`--- Connecting to CosmosDB..`);
const COSMOS_CONSTRING = process.env.COSMOS_CONSTRING;
if (!COSMOS_CONSTRING) {
  throw Error('Azure CosmosDB Connection string not found');
}
const cosmosClient = new CosmosClient(COSMOS_CONSTRING);

// Set CosmosDB Database and Container names
const databaseName = 'supermarket-prices';
const containerName = 'products';
const partitionKey = ['/name'];

// Connect to price database
const { database } = await cosmosClient.databases.createIfNotExists({ id: databaseName });

// Connect to products container
const { container } = await database.containers.createIfNotExists({
  id: containerName,
  partitionKey: { paths: partitionKey },
});

// Function for insert/updating a product object to cosmosdb, returns true if updated, false if already up-to-date
export async function upsertProductToCosmosDB(currentProduct: Product): Promise<boolean> {
  // Check cosmosdb for any existing item using id and name as the partition key
  const cosmosResponse = await container
    .item(currentProduct.id as string, currentProduct.name)
    .read();

  // If an existing item was found in cosmosdb
  if ((await cosmosResponse.statusCode) === 200) {
    let existingProduct = cosmosResponse.resource as Product;
    // If price has changed
    if ((await existingProduct.currentPrice) != currentProduct.currentPrice) {
      console.log(
        `Price updated: ${currentProduct.name.slice(25)} updated from $${
          existingProduct.currentPrice
        } 
        to $${currentProduct.currentPrice}`
      );

      // Create a DatedPrice object and push into priceHistory array
      const newDatedPrice: DatedPrice = {
        date: new Date().toDateString(),
        price: currentProduct.currentPrice,
      };

      // Update existing product
      // const newPriceHistory: DatedPrice[] = existingProduct.priceHistory as DatedPrice[];
      // newPriceHistory.push(newDatedPrice);
      // existingProduct.priceHistory = newPriceHistory;
      existingProduct.priceHistory.push(newDatedPrice);
      existingProduct.currentPrice = currentProduct.currentPrice;

      // Upsert back to cosmosdb
      container.items.upsert(existingProduct);
      return true;
    } else {
      // Price hasn't changed
      // console.log(
      //   `Product ${currentProduct.id} exists with same price of ${currentProduct.currentPrice}`
      // );
      return false;
    }

    // If product doesn't exist in DB, create a new priceHistory array and push the first datedPricing into it
  } else if (cosmosResponse.statusCode === 404) {
    const priceHistory: DatedPrice[] = [];
    const initialDatedPrice: DatedPrice = {
      date: new Date().toDateString(),
      price: currentProduct.currentPrice as number,
    };
    priceHistory.push(initialDatedPrice);
    currentProduct.priceHistory = priceHistory;

    console.log(`Product added: ${currentProduct.name.slice(30)}`);

    // Send completed product object to cosmosdb
    await container.items.create(currentProduct);

    // If cosmos returns a status code other than 200 or 404, manage other errors here
    return true;
  } else {
    console.log(`CosmosDB returned status code: ${cosmosResponse.statusCode}`);
    return false;
  }
}
