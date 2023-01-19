import playwright from 'playwright';
import * as cheerio from 'cheerio';
import _ from 'lodash';
import uploadImageToAzureStorage from './azure-storage.js';
import { upsertProductToCosmosDB } from './azure-cosmosdb.js';
import * as dotenv from 'dotenv';
import { Product } from './typings.js';
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

let urlsToScrape: string[] = [
  'https://www.countdown.co.nz/shop/browse/fridge-deli',
  'https://www.countdown.co.nz/shop/browse/meat-poultry',
  'https://www.countdown.co.nz/shop/browse/fruit-veg',
  'https://www.countdown.co.nz/shop/browse/pantry',
];

// Create a playwright browser using webkit
console.log(`--- Launching Headless Browser..\n`);
const browser = await playwright.webkit.launch({
  headless: true,
});
const page = await browser.newPage();

// Counter and promise to help with looping through all the scrape URLs
let pagesScrapedCount = 1;
let promise = Promise.resolve();

// If node is supplied with arguments, use those as URLs instead
// The first 2 arguments are irrelevant and must be excluded
if (process.argv.length > 2) urlsToScrape = process.argv.splice(2);
console.log(urlsToScrape);

// Loop through each URL to scrape
urlsToScrape.forEach((url) => {
  // Use promises to ensure a delay betwen each scrape
  promise = promise.then(async () => {
    let response = await scrapeLoadedWebpage(url);

    // Log the reponse after the scrape has completed
    console.log(response);

    // If all scrapes have completed, close the playwright browser
    if (pagesScrapedCount++ >= urlsToScrape.length) closePlaywright();

    // Add a delay of 5 seconds between each scrape
    return new Promise((resolve) => {
      setTimeout(resolve, 5000);
    });
  });
});

async function scrapeLoadedWebpage(url: string): Promise<string> {
  // Open page and log url plus the stage of scraping this is
  console.log(`--- [${pagesScrapedCount}/${urlsToScrape.length}] Loading.. ${url}`);
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
  return `--- ${updatedCount} new or updated products\n--- ${alreadyUpToDateCount} products already up-to-date \n`;
}

function closePlaywright() {
  // Close playwright browser after all scrapes have completed
  // setTimeout(() => {
  browser.close();
  console.log('--- All scraping has been completed \n');
  // }, 1000);
}
