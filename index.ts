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

// Create a playwright browser using webkit
console.log(`--- Launching Headless Browser..`);
const browser = await playwright.webkit.launch({
  headless: true,
});
const page = await browser.newPage();

// Open url
const url = 'https://www.countdown.co.nz/shop/browse/drinks';
console.log('--- Loading Webpage.. ' + url);
await page.goto(url);

// Load all dynamic html into Cheerio for easy DOM selection
const html = await page.evaluate(() => document.body.innerHTML);
const $ = cheerio.load(html);
console.log('--- Page Loaded with Length:' + html.length + '\n');

// Count number of items that are already up-to-date, for logging purposes
let alreadyUpToDateCount = 0;
let updatedCount = 0;

// Loop through each product entry
$('cdx-card a.product-entry').map(async (index, productCard) => {
  let product: Product = {
    // Extract ID from h3 tag and remove non-numbers
    id: $(productCard).find('h3').first().attr('id')?.replace(/\D/g, ''),

    // Original title is all lower-case and needs to be made into start-case
    name: _.startCase($(productCard).find('h3').first().text().trim()),

    // Product size may be blank
    size: $(productCard).find('div.product-meta p span.size').text().trim(),

    // Store where the source of information came from
    sourceSite: 'countdown.co.nz',
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

  // Insert or update item into azure cosmosdb, use return value to update counters for logging
  (await upsertProductToCosmosDB(product)) ? updatedCount++ : alreadyUpToDateCount++;

  // Get image url, request hi-res 900px version, and then upload image to azure storage
  const originalImageUrl: string | undefined = $(productCard)
    .find('a.product-entry div.productImage-container figure picture img')
    .attr('src');

  const hiresImageUrl = originalImageUrl?.replace('&w=200&h=200', '&w=900&h=900');
  uploadImageToAzureStorage(
    product.id as string,
    hiresImageUrl as string,
    originalImageUrl as string
  );
});

// After scraping every item is complete, check how many products were already up-to-date in cosmosdb
setTimeout(() => {
  console.log(
    `\n${updatedCount} new or updated products  \t - \t ${alreadyUpToDateCount} products already up-to-date \n`
  );
}, 2000);

// Close playwright headless browser
await browser.close();
