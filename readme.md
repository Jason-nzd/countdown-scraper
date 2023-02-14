# Countdown Scraper

This project scrapes product info from Countdown's NZ website and optionally places the data into Azure CosmosDB and Azure Storage.

A history of price changes is stored within each product's database entry.

Image files can also be scraped and placed into an Azure Storage Blob Container.

## Setup

After cloning this repository, run `npm install` to install dependencies.

The program can now be tested in dry run mode without any further setup using `npm run dry`.

To optionally store data in Azure, a CosmosDB read-write connection string and Azure Storage connection string are required as environment variables in a .env file.

.env

```shell
COSMOS_CONSTRING=
AZURE_STORAGE_CONSTRING=
```

* CosmosDB Database, Container, and Partition Key names can be changed from their defaults in `azure-cosmosdb.ts`.
* Azure Storage Container name can be changed in `azure-storage.ts`.
* A list of URLs to scrape can be put in file `urls.txt`, with one url per line in plain text format.
* If `urls.txt` is not present, 2 sample URLs will be used instead.

## Usage

`npm run dry` - will use dry-run mode, no azure connection is required and the results will log to console.

`npm run dev` - will scrape through all the URLs, then results will be stored in Azure as well logged to the console.

`npm run dev https://sampleurl` - a single url can be used as an argument. This will be scraped instead of the stored URLs

## Output

This is a log output sample when running in dry run mode:

```cmd
123567 | Essentials Baby Wipes Fragrance Free               | 80pack           | $2.7
543789 | Thick Baby Wipes Fragrance Free                    | Refill 240pack   | $15
567234 | Antiseptic Soothing Cream                          | Tube 50g         | $9.5
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
    ],
}
```
