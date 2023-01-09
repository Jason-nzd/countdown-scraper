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

// Function for insert/updating a product object to cosmosdb
export default function upsertToAzureCosmos(productObject) {
  container.items.upsert(productObject);
}

// Read item by id and partitionKey - least expensive `find`
// async function readFromAzureCosmos(id, partitionKey) {
//   const { resource } = await container.item(id, partitionKey).read();
//   console.log(`${resource.name} read`);
// }

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
