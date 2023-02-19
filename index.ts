import playwright from 'playwright';
import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';
import _ from 'lodash';
import * as dotenv from 'dotenv';
import uploadImageToAzureStorage from './azure-storage.js';
import { upsertProductToCosmosDB } from './azure-cosmosdb.js';
import { DatedPrice, Product, upsertResponse } from './typings.js';
import { log, colour } from './logging.js';
dotenv.config();

// Countdown Scraper
// -----------------
// Scrapes pricing and other info from Countdown's website

// Try to read file urls.txt for a list of URLs, one per line
const urlsFromFile = await readURLsFromOptionalFile('urls.txt');
const sampleURLs = [
  'https://www.countdown.co.nz/shop/browse/pantry/eggs',
  'https://www.countdown.co.nz/shop/browse/fish-seafood/salmon',
];
// If the file is missing or returns empty, use the 2 sampleURLs instead
let urlsToScrape = urlsFromFile.length > 0 ? urlsFromFile : sampleURLs;

// Set dryRunMode to true to only log results to console
// Set false to make use of CosmosDB and Azure Storage.
let dryRunMode = false;

// Handle arguments, can potentially be nothing, dry-run-mode, or custom urls to scrape
if (process.argv.length > 2) {
  // Slice out the first 2 arguments, as they are not user-provided
  const userArgs = process.argv.slice(2, process.argv.length);

  if (userArgs.length === 1 && userArgs[0] === 'dry-run-mode') {
    dryRunMode = true;
  } else {
    // Iterate through all user args, filtering out args not recognised as URLs
    urlsToScrape = userArgs.filter((arg) => {
      if (arg.includes('dry-run-mode')) {
        dryRunMode = true;
        return false;
      } else if (arg.includes('.co.nz')) {
        // If a url is provided, scrape this url instead of the default urls
        return true;
      } else {
        log(colour.red, 'Unknown argument provided: ' + arg);
        return false;
      }
    });
  }
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

// Define unnecessary types and ad/tracking urls to reject
let typeExclusions = ['image', 'stylesheet', 'media', 'font', 'other'];
let urlExclusions = [
  'googleoptimize.com',
  'gtm.js',
  'visitoridentification.js',
  'js-agent.newrelic.com',
  'cquotient.com',
  'googletagmanager.com',
  'cloudflareinsights.com',
  'dwanalytics',
  'edge.adobedc.net',
];

// Route with exclusions processed
await page.route('**/*', async (route) => {
  const req = route.request();
  let excludeThisRequest = false;
  let trimmedUrl = req.url().length > 120 ? req.url().substring(0, 120) + '...' : req.url();

  urlExclusions.forEach((excludedURL) => {
    if (req.url().includes(excludedURL)) excludeThisRequest = true;
  });

  typeExclusions.forEach((excludedType) => {
    if (req.resourceType() === excludedType) excludeThisRequest = true;
  });

  if (excludeThisRequest) {
    //log(colour.red, `${req.method()} ${req.resourceType()} - ${trimmedUrl}`);
    await route.abort();
  } else {
    //log(colour.white, `${req.method()} ${req.resourceType()} - ${trimmedUrl}`);
    await route.continue();
  }
});

// Counter and promise to help with looping through each of the scrape URLs
let pagesScrapedCount = 1;
let promise = Promise.resolve();

// Loop through each URL to scrape
urlsToScrape.forEach((url) => {
  // Use promises to ensure a delay between each scrape
  promise = promise.then(async () => {
    // Log status
    log(
      colour.yellow,
      `[${pagesScrapedCount}/${urlsToScrape.length}] Scraping Page.. ${url}` +
        (dryRunMode ? ' (Dry Run Mode On)' : '')
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

    log(colour.yellow, productEntries.length + ' product entries found');

    // Count number of items processed for logging purposes
    let alreadyUpToDateCount = 0;
    let priceChangedCount = 0;
    let categoryUpdatedCount = 0;
    let newProductsCount = 0;

    // Loop through each product entry, and add desired data into a Product object
    let promises = productEntries.map(async (index, productEntryElement) => {
      const product = playwrightElementToProductObject(productEntryElement, url);

      if (!dryRunMode) {
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
    if (!dryRunMode) {
      log(
        colour.blue,
        `CosmosDB Updated: ${newProductsCount} new products, ${priceChangedCount} updated prices, ` +
          `${categoryUpdatedCount} updated categories, ${alreadyUpToDateCount} already up-to-date`
      );
    }

    // If all scrapes have completed, close the playwright browser
    if (pagesScrapedCount++ === urlsToScrape.length) {
      browser.close();
      log(colour.cyan, 'All Scraping Completed \n');
      return;
    } else {
      log(colour.blue, `Waiting ${secondsBetweenEachPageScrape} seconds until next scrape.. \n`);
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
  // Sample DOM for each product (as of Jan-2023)
  // ----------------------------------------------------
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

  // Create a DatedPrice object, which may be added into the product if needed
  const todaysDatedPrice: DatedPrice = {
    date: new Date().toDateString(),
    price: product.currentPrice,
  };
  product.priceHistory = [todaysDatedPrice];

  return product;
}

// Tries to read from file urls.txt containing many urls with one url per line
async function readURLsFromOptionalFile(filename: string) {
  let arrayOfUrls: string[] = [];

  try {
    const file = readFileSync(filename, 'utf-8');
    const fileLines = file.split(/\r?\n/);

    fileLines.forEach((line) => {
      if (line.includes('.co.nz/')) arrayOfUrls.push(line);
    });

    return arrayOfUrls;
  } catch (error) {
    log(colour.yellow, 'urls.txt not found, scraping 2 sample URLs instead');
    return [];
  }
}

export function deriveCategoryFromUrl(url: string): string {
  // Derives category names from url, if any categories are available
  // www.domain.com/shop/browse/frozen/ice-cream-sorbet/tubs
  // returns 'frozen'

  // If url doesn't contain /browse/, return no category
  if (url.indexOf('/browse/') < 0) return '';

  const categoriesStartIndex = url.indexOf('/browse/');
  const categoriesEndIndex = url.lastIndexOf('/');
  const categoriesString = url.substring(categoriesStartIndex, categoriesEndIndex);

  const splitCategories = categoriesString.split('/').slice(2);

  return splitCategories[0];
}

function setUrlOptions(url: string): string {
  let processedUrl = url;

  // Remove existing query options from url
  if (url.includes('?')) url.slice(0, url.indexOf('?') + 1);

  // Add recommend query options, size=48 shows upto 48 products per page
  return processedUrl + '?page=1&size=48&inStockProductsOnly=true';
}
