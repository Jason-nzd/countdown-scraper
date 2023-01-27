import playwright from 'playwright';
import * as cheerio from 'cheerio';
import _ from 'lodash';
import uploadImageToAzureStorage from './azure-storage.js';
import { upsertProductToCosmosDB } from './azure-cosmosdb.js';
import * as dotenv from 'dotenv';
import { CategorisedUrl, Product } from './typings.js';
import { defaultUrls } from './urlsToScrape.js';
dotenv.config();

// Countdown Scraper
// -----------------
// Scrapes pricing and other info from Countdown's website
//
// Countdown sample search results DOM (as of Jan-2023)
// ----------------------------------------------------
//   <container div>
//      cdx-card
//        a.product-entry
//            ...
//      cdx-card
//        a.product-entry
//            h3                 {title}
//            div.product-meta
//                product-price
//                     h3
//                         em     {price dollar section}
//                         span   {price cents section}
//                 p
//                    span.size  {size eg. 400g}
//            div.productImage-container
//                 figure
//                     picture
//                         img    {img}
//      cdx-card
//         a.product-entry
//             ...
//   </container div>

// Get default urls to be scraped from file urlsToScrape.ts
//  Is an array of CategorisedUrl objects, which contain both a url and product category
let categorisedUrls = defaultUrls;

// Define the delay between each page scrape. This helps spread the database write load,
//  and makes the scraper appear less bot-like.
const secondsBetweenEachPageScrape: number = 11;

// Query options to add to every url, size=48 shows upto 48 products per page
const urlQueryOptions = '?page=1&size=48&inStockProductsOnly=true';

// If an argument is provided, use this as a url instead of the default urls
// The first 2 arguments are irrelevant and must be excluded
if (process.argv.length > 2) {
  const urlfromArguments: CategorisedUrl = {
    url: process.argv[2],
    category: '',
  };
  categorisedUrls = [urlfromArguments];
}

// Create a playwright browser using webkit
console.log(`--- Launching Headless Browser..`);
const browser = await playwright.webkit.launch({
  headless: true,
});
const page = await browser.newPage();

// Counter and promise to help with looping through all the scrape URLs
let pagesScrapedCount = 1;
let promise = Promise.resolve();

// Loop through each URL to scrape
categorisedUrls.forEach((categorisedUrl) => {
  const url = categorisedUrl.url;
  const category = categorisedUrl.category;

  // Use promises to ensure a delay betwen each scrape
  promise = promise.then(async () => {
    let response = await scrapeLoadedWebpage(url + urlQueryOptions, category);

    // Log the reponse after the scrape has completed
    console.log(response);

    // If all scrapes have completed, close the playwright browser
    if (pagesScrapedCount++ >= categorisedUrls.length) {
      browser.close();
      console.log('--- All scraping has been completed \n');
    }

    // Add a delay of 11 seconds between each scrape
    return new Promise((resolve) => {
      setTimeout(resolve, secondsBetweenEachPageScrape * 1000);
    });
  });
});

async function scrapeLoadedWebpage(url: string, category: string): Promise<string> {
  // Open page and log url plus the stage of scraping this is
  console.log(`--- [${pagesScrapedCount}/${categorisedUrls.length}] Scraping Page.. ${url}`);
  await page.goto(url);

  // Wait for <cdx-card> which is dynamically loaded in
  await page.waitForSelector('cdx-card');

  // Load all html into Cheerio for easy DOM selection
  const html = await page.evaluate(() => document.body.innerHTML);
  const $ = cheerio.load(html);
  const productEntries = $('cdx-card a.product-entry');

  console.log('--- ' + productEntries.length + ' product entries found');

  // Count number of items processed for logging purposes
  let alreadyUpToDateCount = 0;
  let updatedCount = 0;

  // Loop through each product entry, and add desired data to a Product object
  let promises = productEntries.map(async (index, productCard) => {
    let product: Product = {
      // Extract ID from h3 tag and remove non-numbers
      id: $(productCard).find('h3').first().attr('id')?.replace(/\D/g, '') as string,

      // Original title is all lower-case and needs to be made into start-case
      name: _.startCase($(productCard).find('h3').first().text().trim()),

      // Product size may be blank
      size: $(productCard).find('div.product-meta p span.size').text().trim(),

      // Store where the source of information came from
      sourceSite: url,

      // Category is passed in from function
      category: category,

      // These values will later be overwritten
      priceHistory: [],
      currentPrice: 0,
    };

    // The price is originally displayed with dollars in an <em>, cents in a <span>,
    // and potentially a kg unit name inside the <span> for some meat products.
    // The 2 numbers are joined, parsed, and non-number chars are removed.
    const dollarString: string = $(productCard)
      .find('div.product-meta product-price h3 em')
      .text()
      .trim();
    const centString: string = $(productCard)
      .find('div.product-meta product-price h3 span')
      .text()
      .trim()
      .replace(/\D/g, '');
    product.currentPrice = Number(dollarString + '.' + centString);

    // Insert or update item into azure cosmosdb, use return value to update logging counters
    (await upsertProductToCosmosDB(product)) ? updatedCount++ : alreadyUpToDateCount++;

    // Get image url, request hi-res 900px version, and then upload image to azure storage
    const originalImageUrl: string | undefined = $(productCard)
      .find('a.product-entry div.productImage-container figure picture img')
      .attr('src');

    const hiresImageUrl = originalImageUrl?.replace('&w=200&h=200', '&w=900&h=900');

    await uploadImageToAzureStorage(
      product.id as string,
      hiresImageUrl as string,
      originalImageUrl as string
    );
  });

  // Wait for entire map to finish
  await Promise.all(promises);

  // After scraping every item is complete, log how many products were scraped
  return `--- ${updatedCount} new or updated products, ${alreadyUpToDateCount} already up-to-date \n`;
}
