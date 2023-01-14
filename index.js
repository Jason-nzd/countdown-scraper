import playwright from 'playwright';
import * as cheerio from 'cheerio';
import _ from 'lodash';
import uploadImageToAzureStorage from './azure-storage.js';
import { upsertProductToCosmosDB } from './azure-cosmosdb.js';
import * as dotenv from 'dotenv';
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

// Logging 0 = minimum, 1 = standard, 2 = verbose
const loggingLevel = 1;
process.env.LOGGING = 1;

// Create a playwright browser using webkit
if (loggingLevel >= 1) console.log(`--- Launching Headless Browser..`);
const browser = await playwright.webkit.launch({
  headless: true,
});
const page = await browser.newPage();

// Open url
const url = 'https://www.countdown.co.nz/shop/browse/beer-wine';
if (loggingLevel >= 0) console.log('--- Loading Webpage.. ' + url);
await page.goto(url);

// Load all dynamic html into Cheerio for easy DOM selection
const html = await page.evaluate(() => document.body.innerHTML);
const $ = cheerio.load(html);
if (loggingLevel >= 1) console.log('--- Page Loaded with Length:' + html.length + '\n');

// Count number of items that are already up-to-date, for logging purposes
let alreadyUpToDateCount = 0;
let updatedCount = 0;

// Print formatted table header to console
// console.log(
//   '\n  ID '.padEnd(7) +
//     ' | ' +
//     'Product Name'.padEnd(50) +
//     ' | ' +
//     'Price' +
//     ' |' +
//     '\n--------------------------------------------------------------------'
// );

// Loop through each product card and build a product object with the desired data fields
$('cdx-card a.product-entry').each((index, productCard) => {
  // Init empty product object
  let product = {};

  // Extract ID from h3 tag and remove non-numbers
  product.id = $(productCard).find('h3').first().attr('id').replace(/\D/g, '');

  // Original title is all lower-case and needs to be made into start-case
  product.name = _.startCase($(productCard).find('h3').first().text().trim());

  // The price is originally displayed with dollars in an <em>, cents in a <span>,
  // and potentially a kg unit name inside the <span> for some meat products.
  // The 2 numbers are joined, parsed, and non-number chars are removed.
  product.currentPrice = Number(
    $(productCard).find('div.product-meta product-price h3 em').text().trim() +
      '.' +
      $(productCard).find('div.product-meta product-price h3 span').text().trim().replace(/\D/g, '')
  );

  // Product size may be blank
  product.size = $(productCard).find('div.product-meta p span.size').text().trim();

  product.sourceSite = 'countdown.co.nz';

  // Log completed product object into a formatted table row
  // console.log(
  //   product.id.padEnd(6) +
  //     ' | ' +
  //     product.name
  //       .slice(0, 40)
  //       .concat(' - ' + product.size)
  //       .padEnd(50) +
  //     ' | ' +
  //     product.currentPrice.toString().padStart(3).padEnd(4) +
  //     ' |'
  // );

  // FIX
  // Insert or update item into azure cosmosdb, use return value to update counters for logging
  upsertProductToCosmosDB(product, loggingLevel) ? updatedCount++ : alreadyUpToDateCount++;

  // Get image url, request hi-res 900px version, and then upload image to azure storage
  const originalImageUrl = $(productCard)
    .find('a.product-entry div.productImage-container figure picture img')
    .attr('src');
  const hiresImageUrl = originalImageUrl.replace('&w=200&h=200', '&w=900&h=900');
  uploadImageToAzureStorage(product.id, hiresImageUrl, originalImageUrl, loggingLevel);
});

// After scraping every item is complete, check how many products were already up-to-date in cosmosdb
setTimeout(() => {
  if (loggingLevel >= 1)
    console.log(
      `\n${updatedCount} new or updated products  \t - \t ${alreadyUpToDateCount} products already up-to-date \n`
    );
}, 3000);

// Close playwright headless browser
await browser.close();
