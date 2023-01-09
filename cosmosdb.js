// CosmosDB reference
import { CosmosClient } from '@azure/cosmos';
import * as dotenv from 'dotenv';
dotenv.config();

// Set Database name and container name
const databaseName = 'supermarket-prices';
const containerName = 'products';
const partitionKeyPath = ['/categoryName'];

// Create cosmos client
const cosmosClient = new CosmosClient(process.env.COSMOS_CONSTRING);

// Connect to price database
const { database } = await cosmosClient.databases.createIfNotExists({ id: databaseName });
console.log(`${database.id} database ready`);

// Connect to products container
const { c } = await database.containers.createIfNotExists({
  id: containerName,
  partitionKey: { paths: partitionKeyPath },
});
console.log(`${c.id} container ready`);

// Create item
const { newItem } = await c.items.create(item);
console.log(`'${newItem.name}' inserted`);

// Read item by id and partitionKey - least expensive `find`
const { resource } = await c.item(items[0].id, items[0].categoryName).read();
console.log(`${resource.name} read`);

// Query by SQL - more expensive `find`
// find all items with same categoryName (partitionKey)
const querySpec = {
  query: 'select * from products p where p.categoryName=@categoryName',
  parameters: [
    {
      name: '@categoryName',
      value: items[2].categoryName,
    },
  ],
};

// Get items
const { resources } = await c.items.query(querySpec).fetchAll();

for (const item of resources) {
  console.log(`${item.id}: ${item.name}, ${item.sku}`);
}

// Delete item
const { statusCode } = await c.item(items[2].id, items[2].categoryName).delete();
console.log(`${items[2].id} ${statusCode == 204 ? `Item deleted` : `Item not deleted`}`);
