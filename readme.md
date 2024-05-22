# Countdown Scraper

This project scrapes product info from Countdown's NZ website and optionally places the data into Azure CosmosDB.

A history of price changes is stored within each product's database entry.

Image files can also be scraped and placed into an Azure Storage Blob Container.

## Basic Setup

With `NodeJS` installed, clone this repository, then run `npm install` to install dependencies.

Playwright must also be installed when running for the first time with `npx playwright install`.

The program can now be tested in dry run mode without any further setup using `npm run dev`.

## Optional Setup

The `.env` file has variables that can be filled for more functionality.

```js
STORE_NAME=             Optional supermarket location name
COSMOS_CONSTRING=       Read-write CosmosDB connection string
COSMOS_DB_NAME=         CosmosDB Name
COSMOS_CONTAINER=       CosmosDB Container Name, eg. products
COSMOS_PARTITION_KEY=   CosmosDB Partition Key, eg. /name
IMAGE_UPLOAD_FUNC_URL=  Optional image upload REST API URL
```

- The CosmosDB read-write connection string can be obtained from the `Azure Portal > CosmosDB > Settings > Keys`.
- A list of URLs to scrape can be put in file `urls.txt`, with one url per line.

## Usage

`npm run dev` - will use dry-run mode, no azure connection is required and the results will log to console.

`npm run db` - will scrape through the URLs and store the results into CosmosDB.

`npm run db https://sampleurl` - a single url can be used as an argument. This will be scraped instead of the URLs text file.

## Other Command-Line Arguments

`images` - will also upload images.

`headed` - will run the browser in a window instead of a headless.

## Output

Sample log output when running in dry run mode:

```cmd
    ID | Name                              | Size           | Price  | Unit Price
----------------------------------------------------------------------------------
762844 | Ocean Blue Smoked Salmon Slices   | 100g           | $    9 | $90 /kg
697201 | Clearly Premium Smoked Salmon     | 200g           | $ 13.5 | $67.5 /kg
830035 | Ocean Blue Smoked Salmon Slices   | 180g           | $   12 | $67.7 /kg
```

This is a sample of a single product stored in CosmosDB. It was re-run at multiple dates to store changing prices:

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
  ]
}
```
