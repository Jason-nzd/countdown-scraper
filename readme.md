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
ID     | Name                                               | Size             | Price  | Categories
--------------------------------------------------------------------------------------------------------------
762844 | Ocean Blue Smoked Salmon Slices                    | 100g             | $    9 | fish-seafood, salmon
697201 | Clearly Premium Smoked Salmon Superior Sliced      | 200g             | $ 13.5 | fish-seafood, salmon
830035 | Ocean Blue Smoked Salmon Slices                    | 180g             | $   12 | fish-seafood, salmon
 76719 | Fresh NZ Salmon Fillet 1 2 Pack                    | Min order 400g   | $   51 | fish-seafood, salmon
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
