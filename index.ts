import playwright from 'playwright';
import * as cheerio from 'cheerio';
import _ from 'lodash';
import * as dotenv from 'dotenv';
import uploadImageToAzureStorage from './azure-storage.js';
import { upsertProductToCosmosDB } from './azure-cosmosdb.js';
import { Product, upsertResponse } from './typings.js';
import { defaultUrls, deriveCategoryFromUrl, setUrlOptions } from './urls.js';
import { log, colour } from './logging.js';
dotenv.config();

// Countdown Scraper
// -----------------
// Scrapes pricing and other info from Countdown's website
//
// Sample DOM for each product (as of Jan-2023)
// ----------------------------------------------------
//      cdx-card
//        a.product-entry
//            h3                 {title}
//            div.product-meta
//                product-price
//                     h3
//                         em     {price dollar section}
//                         span   {price cents section}
//                 p
//                     span.size  {size eg. 400g}
//            div.productImage-container
//                 figure
//                     picture
//                         img    {img}

// Array of urls to scrape is imported from urls.ts
let urlsToScrape: string[] = defaultUrls;

// Set dryRunLogOnly to true to disable use of CosmosDB and Azure Storage,
//  will only log results instead.
const dryRunLogOnly = true;

// If an argument is provided, scrape this url instead of the default urls
// The first 2 arguments are irrelevant and are ignored
if (process.argv.length > 2) {
  const singleUrlfromArguments = process.argv[2];
  urlsToScrape = [singleUrlfromArguments];
}

// Define the delay between each page scrape. This helps spread the database write load,
//  and makes the scraper appear less bot-like.
const secondsBetweenEachPageScrape: number = 31;

// Create a playwright headless browser using webkit
log(colour.yellow, 'Launching Headless Browser..');
const browser = await playwright.webkit.launch({
  headless: true,
});
const page = await browser.newPage();

// Counter and promise to help with looping through each of the scrape URLs
let pagesScrapedCount = 1;
let promise = Promise.resolve();

// Loop through each URL to scrape
urlsToScrape.forEach((url) => {
  // Use promises to ensure a delay betwen each scrape
  promise = promise.then(async () => {
    // Log status
    log(
      colour.yellow,
      `[${pagesScrapedCount}/${urlsToScrape.length}] Scraping Page.. ${url}` +
        (dryRunLogOnly && ' (Dry Run Mode On)')
    );

    // Add query options to url
    url = setUrlOptions(url);

    // Open page with url options now set
    await page.goto(url);

    // Wait for <cdx-card> html element to dynamically load in,
    //  this is required to see product data
    await page.waitForSelector('cdx-card');

    // Load all html into Cheerio for easy DOM selection
    const html = await page.evaluate(() => document.body.innerHTML);
    const $ = cheerio.load(html);
    const productEntries = $('cdx-card a.product-entry');

    console.log('--- ' + productEntries.length + ' product entries found');

    // Count number of items processed for logging purposes
    let alreadyUpToDateCount = 0;
    let priceChangedCount = 0;
    let categoryUpdatedCount = 0;
    let newProductsCount = 0;

    // Loop through each product entry, and add desired data into a Product object
    let promises = productEntries.map(async (index, productEntryElement) => {
      const product = playwrightElementToProductObject(productEntryElement, url);

      if (!dryRunLogOnly) {
        // Insert or update item into azure cosmosdb
        const response = await upsertProductToCosmosDB(product);

        // Use response to update logging counters
        switch (response) {
          case upsertResponse.AlreadyUpToDate:
            alreadyUpToDateCount++;
            break;
          case upsertResponse.CategoryChanged:
            categoryUpdatedCount++;
            break;
          case upsertResponse.NewProductAdded:
            newProductsCount++;
            break;
          case upsertResponse.PriceChanged:
            priceChangedCount++;
            break;
          default:
            break;
        }

        // Get image url, request hi-res 900px version, and then upload image to azure storage
        const originalImageUrl: string | undefined = $(productEntryElement)
          .find('a.product-entry div.productImage-container figure picture img')
          .attr('src');
        const hiresImageUrl = originalImageUrl?.replace('&w=200&h=200', '&w=900&h=900');

        await uploadImageToAzureStorage(product, hiresImageUrl as string);
      } else {
        // When doing a dry run, log product name - size - price in table format
        console.log(
          product.id.padStart(6) +
            ' | ' +
            product.name.slice(0, 50).padEnd(50) +
            ' | ' +
            product.size?.slice(0, 16).padEnd(16) +
            ' | ' +
            '$' +
            product.currentPrice
        );
      }
    });

    // Wait for entire map of product entries to finish
    await Promise.all(promises);

    // After scraping every item is complete, log how many products were scraped
    if (!dryRunLogOnly) {
      console.log(
        `--- ${newProductsCount} new products, ${priceChangedCount} updated prices, ` +
          `${categoryUpdatedCount} updated categories, ${alreadyUpToDateCount} already up-to-date`
      );
    }

    // If all scrapes have completed, close the playwright browser
    if (pagesScrapedCount++ === urlsToScrape.length) {
      browser.close();
      log(colour.cyan, 'All scraping complete \n');
      return;
    } else {
      console.log(`Waiting for ${secondsBetweenEachPageScrape} seconds until next scrape.. \n`);
    }

    // Add a delay between each scrape loop
    return new Promise((resolve) => {
      setTimeout(resolve, secondsBetweenEachPageScrape * 1000);
    });
  });
});

// Function takes a single playwright element for 'a.product-entry',
//   then builds and returns a single Product object with desired data
function playwrightElementToProductObject(element: cheerio.Element, url: string): Product {
  const $ = cheerio.load(element);

  let product: Product = {
    // Extract ID from h3 tag and remove non-numbers
    id: $(element).find('h3').first().attr('id')?.replace(/\D/g, '') as string,

    // Original title is all lower-case and needs to be made into start-case
    name: _.startCase($(element).find('h3').first().text().trim()),

    // Product size may be blank
    size: $(element).find('div.product-meta p span.size').text().trim(),

    // Store where the source of information came from
    sourceSite: url,

    // Category is derived from url
    category: deriveCategoryFromUrl(url),

    // These values will later be overwritten
    priceHistory: [],
    currentPrice: 0,
  };

  // The price is originally displayed with dollars in an <em>, cents in a <span>,
  // and potentially a kg unit name inside the <span> for some meat products.
  // The 2 numbers are joined, parsed, and non-number chars are removed.
  const dollarString: string = $(element)
    .find('div.product-meta product-price h3 em')
    .text()
    .trim();
  const centString: string = $(element)
    .find('div.product-meta product-price h3 span')
    .text()
    .trim()
    .replace(/\D/g, '');
  product.currentPrice = Number(dollarString + '.' + centString);

  return product;
}
