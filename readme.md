# Countdown Scraper

This project scrapes product info from Countdown's NZ website and places the data into Azure CosmosDB and Azure Storage.

A history of price changes is stored within each product's database entry.

Image files can also be scraped and placed into an Azure Blob Container.

## Setup

An Azure CosmosDB read-write connection string and Azure Storage connection string are required as environment variables in a .env file.

.env format

```shell
COSMOS_CONSTRING=
AZURE_STORAGE_CONSTRING=
```

* CosmosDB database, container, and partition key names can be set in `azure-cosmosdb.ts`.
* Azure storage container name can be set in `azure-storage.ts`.
* A list of URLs to scrape are set in `urls.ts`.

## Usage

`npm run dev` - will scrape through all of the URLs in urls.ts

`npm run dev https://sampleurl` - a single url can be used as an argument. This will be scraped instead of the default URLs

## Output

This is a sample of a single product stored in CosmosDB.

```json
{
    "id": "123456",
    "name": "Sausages Precooked Chinese Honey",
    "currentPrice": 12.9,
    "size": "Prepacked 1kg pack",
    "priceHistory": [
        {
            "date": "Sat Jan 14 2023",
            "price": 10
        },
        {
            "date": "Thu Jan 26 2023",
            "price": 12.9
        }
    ],
}
```
