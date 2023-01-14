// Used by index.js for creating and accessing items stored in Azure CosmosDB
import { CosmosClient } from '@azure/cosmos';
import * as dotenv from 'dotenv';
dotenv.config();

// Create Cosmos client using connection string stored in .env
console.log(`--- Connecting to CosmosDB..`);
const COSMOS_CONSTRING = process.env.COSMOS_CONSTRING;
if (!COSMOS_CONSTRING) {
  throw Error('Azure CosmosDB Connection string not found');
}
const cosmosClient = new CosmosClient(process.env.COSMOS_CONSTRING);

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

// interface Product {
//   id: String,
//   name: String,
//   currentPrice: Number,
//   priceHistory: DatedPrice[],
//   source: string
// }

// interface DatedPrice {
//   date: Date,
//   price: number
// }

// Function for insert/updating a product object to cosmosdb, returns true if updated, false if already up-to-date
export async function upsertProductToCosmosDB(currentProduct) {
  // Check cosmosdb for any existing item using id and name as the partition key
  let existingProduct = await container.item(currentProduct.id, currentProduct.name).read();

  // If an item was found in cosmosdb
  if ((await existingProduct.statusCode) == '200') {
    // If price has changed
    if ((await existingProduct.resource.currentPrice) != currentProduct.currentPrice) {
      console.log(
        `Product Price updated: ${currentProduct.name} updated from $${existingProduct.resource.currentPrice} 
        to $${currentProduct.currentPrice}`
      );

      // Create a datedPricing object and push into priceHistory array
      const datedPricing = {
        date: new Date().toDateString(),
        price: currentProduct.currentPrice,
      };

      // Update existing product
      const priceHistory = existingProduct.resource.priceHistory;
      priceHistory.push(datedPricing);
      existingProduct.resource.priceHistory = priceHistory;
      existingProduct.resource.currentPrice = currentProduct.currentPrice;

      // Upsert back to cosmosdb
      container.items.upsert(existingProduct);
      return true;
    } else {
      // Price hasn't changed
      console.log(
        `Product ${currentProduct.id} exists with same price of ${currentProduct.currentPrice}`
      );
      return false;
    }

    // If product doesn't exist in DB, create a new priceHistory array and push the first datedPricing into it
  } else if (existingProduct.statusCode == '404') {
    const priceHistory = [];
    const datedPricing = {
      date: new Date().toDateString(),
      price: currentProduct.currentPrice,
    };
    priceHistory.push(datedPricing);
    currentProduct.priceHistory = priceHistory;

    console.log(`Product added: ${currentProduct.name}`);

    // Send completed product object to cosmosdb
    await container.items.create(currentProduct);

    // If cosmos returns a status code other than 200 or 404, manage other errors here
    return true;
  } else {
    console.log(`CosmosDB returned status code: ${existingProduct.statusCode}`);
    return false;
  }
}

// Sample SQL query, kept here for future reference
// async function queryAzureCosmos(sqlQuery) {}
// // Query by SQL - more expensive `find`
// // find all items with same categoryName (partitionKey)
// const querySpec = {
//   query: 'select * from products p where p.categoryName=@categoryName',
//   parameters: [
//     {
//       name: '@categoryName',
//       value: items[2].categoryName,
//     },
//   ],
// };
// const { resources } = await c.items.query(querySpec).fetchAll();

// for (const item of resources) {
//   console.log(`${item.id}: ${item.name}, ${item.sku}`);
// }
