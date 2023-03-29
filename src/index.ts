import playwright from 'playwright';
import * as cheerio from 'cheerio';
import _ from 'lodash';
import * as dotenv from 'dotenv';
import { upsertProductToCosmosDB } from './cosmosdb.js';
import { CategorisedUrl, DatedPrice, Product, UpsertResponse } from './typings';
import {
  log,
  colour,
  logProductRow,
  logError,
  readLinesFromTextFile,
  getTimeElapsedSince,
} from './utilities.js';
dotenv.config();

// Countdown Scraper
// Scrapes pricing and other info from Countdown NZ's website.

const secondsDelayBetweenPageScrapes = 11;
const uploadImagesToAzureFunc = true;

// Playwright variables
let browser: playwright.Browser;
let page: playwright.Page;

// Record start time, for logging purposes
const startTime = Date.now();

// Try to read file urls.txt for a list of URLs
let rawLinesFromFile: string[] = readLinesFromTextFile('src/urls.txt');

// Parse and optimise urls
let categorisedUrls: CategorisedUrl[] = [];
rawLinesFromFile.map((line) => {
  let categorisedUrl = parseAndCategoriseURL(line);
  if (categorisedUrl !== undefined) categorisedUrls.push(categorisedUrl);
});

// Can change dryRunMode to true to only log results to console
let dryRunMode = false;

// Handle command-line arguments
handleArguments();

// Establish playwright browser
await establishPlaywrightPage();

// Select store location
await selectStoreByLocationName();

// Counter and promise to help with delayed looping of each page load
let pagesScrapedCount = 1;
let promise = Promise.resolve();

// Log loop start
log(
  colour.yellow,
  `${categorisedUrls.length} pages to be scraped \t` +
    `${secondsDelayBetweenPageScrapes}s delay between scrapes\t` +
    (dryRunMode ? ' (Dry Run Mode On) ' : '')
);

// Loop through each URL to scrape
categorisedUrls.forEach((categorisedUrl) => {
  const url = categorisedUrl.url;

  // Use promises to ensure a delay between each scrape
  promise = promise.then(async () => {
    // Log current scrape sequence, the total number of pages to scrape, and a shortened url
    log(
      colour.white,
      `[${pagesScrapedCount}/${categorisedUrls.length}] ` +
        `Scraping ${url
          .replace('https://www.', '')
          .replace('?page=1&size=48&inStockProductsOnly=true', '')}`
    );

    let pageLoadValid = false;
    try {
      // Open page with url options now set
      await page.goto(url);

      // Wait for product-price h3 em html element to dynamically load in,
      //  this is required to see product data
      await page.waitForSelector('product-price h3 em');

      pageLoadValid = true;
    } catch (error) {
      logError('Page Timeout after 30 seconds - Skipping this page\n');
    }

    // Count number of items processed for logging purposes
    let alreadyUpToDateCount = 0;
    let priceChangedCount = 0;
    let infoUpdatedCount = 0;
    let newProductsCount = 0;

    // If page load is valid, load html into Cheerio for easy DOM selection
    if (pageLoadValid) {
      const html = await page.innerHTML('product-grid');
      const $ = cheerio.load(html);
      const productEntries = $('cdx-card a.product-entry');

      // Log the number of products found, time elapsed in seconds or min:s, and found categories
      log(
        colour.yellow,
        `${productEntries.length} product entries found \t` +
          `Time Elapsed: ${getTimeElapsedSince(startTime)} \t` +
          `Categories: [${categorisedUrl.categories.join(' - ')}]`
      );

      // Loop through each product entry, add desired data into a Product object
      let promises = productEntries.map(async (index, productEntryElement) => {
        const product = playwrightElementToProduct(
          productEntryElement,
          url,
          categorisedUrl.categories
        );

        if (!dryRunMode && product !== undefined) {
          // Insert or update item into azure cosmosdb
          const response = await upsertProductToCosmosDB(product);

          // Use response to update logging counters
          switch (response) {
            case UpsertResponse.AlreadyUpToDate:
              alreadyUpToDateCount++;
              break;
            case UpsertResponse.InfoChanged:
              infoUpdatedCount++;
              break;
            case UpsertResponse.NewProduct:
              newProductsCount++;
              break;
            case UpsertResponse.PriceChanged:
              priceChangedCount++;
              break;
            default:
              break;
          }

          // Todo fix url scraping
          // const originalImageUrl = $(productEntryElement)
          //   .find('div.productImage-container figure img')
          //   .attr('src');

          const imageUrlBase = 'https://assets.woolworths.com.au/images/2010/';
          const imageUrlExtensionAndQueryParams = '.jpg?impolicy=wowcdxwbjbx&w=900&h=900';
          const imageUrl = imageUrlBase + product.id + imageUrlExtensionAndQueryParams;

          // Upload image to Azure Function
          if (uploadImagesToAzureFunc) await uploadImageRestAPI(imageUrl!, product);
        } else if (dryRunMode && product !== undefined) {
          // When doing a dry run, log product name - size - price in table format
          logProductRow(product!);
        }
      });
      // Wait for entire map of product entries to finish
      await Promise.all(promises);
    }

    // After scraping every item is complete, log how many products were scraped
    if (!dryRunMode && pageLoadValid) {
      log(
        colour.blue,
        `CosmosDB: ${newProductsCount} new products, ` +
          `${priceChangedCount} updated prices, ` +
          `${infoUpdatedCount} updated info, ` +
          `${alreadyUpToDateCount} already up-to-date\n`
      );
    }

    // If all scrapes have completed, close the playwright browser
    if (pagesScrapedCount++ === categorisedUrls.length) {
      browser.close();
      log(
        colour.sky,
        `All Pages Completed = Total Time Elapsed ${getTimeElapsedSince(startTime)} \n`
      );
      return;
    }

    // Add a delay between each scrape loop
    return new Promise((resolve) => {
      setTimeout(resolve, secondsDelayBetweenPageScrapes * 1000);
    });
  });
});

// Image URL - get product image url from page, then upload using an Azure Function
async function uploadImageRestAPI(imgUrl: string, product: Product): Promise<boolean> {
  // Check if passed in url is valid, return if not
  if (imgUrl === undefined || !imgUrl.includes('http')) {
    log(colour.grey, `   Image ${product.id} has invalid url: ${imgUrl}`);
    return false;
  }

  // Get AZURE_FUNC_URL from env
  // Example format:
  // https://<func-app>.azurewebsites.net/api/ImageToS3?code=<auth-code>
  const funcUrl = process.env.AZURE_FUNC_URL;

  // Check funcUrl is valid
  if (!funcUrl?.includes('http')) {
    throw Error(
      '\nAZURE_FUNC_URL in .env is invalid. Should be in .env :\n\n' +
        'AZURE_FUNC_URL=https://<func-app>.azurewebsites.net/api/ImageToS3?code=<auth-code>\n\n'
    );
  }
  const restUrl =
    funcUrl +
    '&destination=s3://supermarketimages/product-images/' +
    product.id +
    '&source=' +
    imgUrl;

  // Perform http get
  var res = await fetch(new URL(restUrl), { method: 'GET' });
  var responseMsg = await (await res.blob()).text();

  if (responseMsg.includes('S3 Upload of Full-Size')) {
    // Log new CDN URL for successful upload
    const cdnCheckUrlBase = process.env.CDN_CHECK_URL_BASE;
    log(
      colour.grey,
      `  New Image  : ${cdnCheckUrlBase}${(product.id + '.webp').padEnd(11)} | ` +
        `${product.name.padEnd(25).slice(0, 25)}`
    );
  } else if (responseMsg.includes('already exists')) {
    // Do not log for existing images
  } else if (responseMsg.includes('Unable to download:')) {
    // Log for missing images
    log(colour.grey, `  Image ${product.id} unavailable to be downloaded`);
  } else if (responseMsg.includes('unable to be processed')) {
    log(colour.grey, `  Image ${product.id} unable to be processed`);
  } else {
    // Log any other errors that may have occurred
    console.log(responseMsg);
  }
  return true;
}

function handleArguments() {
  // Handle arguments, can be reverse mode, dry-run-mode, custom url, or categories
  if (process.argv.length > 2) {
    // Slice out the first 2 arguments, as they are not user-provided
    const userArgs = process.argv.slice(2, process.argv.length);

    // Loop through all args and find any matching keywords
    let potentialUrl = '';
    userArgs.forEach((arg) => {
      if (arg === 'dry-run-mode') dryRunMode = true;
      else if (arg.includes('.co.nz')) potentialUrl += arg;
      else if (arg.includes('categories=')) potentialUrl += ' ' + arg;
      else if (arg === 'reverse') categorisedUrls = categorisedUrls.reverse();
    });

    // Try to parse any url + categories
    const parsedUrl = parseAndCategoriseURL(potentialUrl);
    if (parsedUrl !== undefined) categorisedUrls = [parsedUrl];
  }
}

async function establishPlaywrightPage() {
  // Create a playwright headless browser using webkit
  log(
    colour.yellow,
    'Launching Headless Browser.. ' +
      (process.argv.length > 2 ? '(' + (process.argv.length - 2) + ' arguments found)' : '')
  );
  browser = await playwright.webkit.launch({
    headless: true,
  });
  page = await browser.newPage();

  // Define unnecessary types and ad/tracking urls to reject
  await routePlaywrightExclusions();
}

// selectStoreByLocationName()
// Selects a store location by typing in the specified location address
async function selectStoreByLocationName(locationName: string = '') {
  // If no location was passed in, check .env for STORE_NAME
  if (locationName === '') {
    if (process.env.STORE_NAME) locationName = process.env.STORE_NAME;
    // If STORE_NAME is also not present, skip store location selection
    else return;
  }

  log(colour.yellow, 'Selecting Store Location..');
  await page.goto('https://www.countdown.co.nz/bookatimeslot');
  await page.waitForSelector('fieldset div div p button');
  await page.locator('fieldset div div p button').click({ button: 'left' });
  await page.waitForSelector('form-suburb-autocomplete form-input input');
  await page.locator('form-suburb-autocomplete form-input input').type(locationName);
  await page.waitForTimeout(1000);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  await page.getByText('Save and Continue Shopping').click();
  log(colour.yellow, 'Selected Location: ' + locationName + '\n');
  await page.waitForTimeout(2000);
}

// Function takes a single playwright element for 'a.product-entry',
//   then builds and returns a Product object with desired data
function playwrightElementToProduct(
  element: cheerio.Element,
  url: string,
  categories: string[]
): Product | undefined {
  const $ = cheerio.load(element);

  let product: Product = {
    // Extract ID from h3 tag and remove non-numbers
    id: $(element).find('h3').first().attr('id')?.replace(/\D/g, '') as string,

    // Original title is all lower-case and needs to be made into start-case
    name: _.startCase($(element).find('h3').first().text().trim()),

    // Product size may be blank
    size: $(element).find('div.product-meta p span.size').text().trim(),

    // Store where the source of information came from
    sourceSite: 'countdown.co.nz',

    // Categories
    category: categories,

    // Store today's date
    lastChecked: new Date(),
    lastUpdated: new Date(),

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
  let centString: string = $(element).find('div.product-meta product-price h3 span').text().trim();
  // if(centString.includes("kg")) product.size="per kg";
  centString = centString.replace(/\D/g, '');

  product.currentPrice = Number(dollarString + '.' + centString);

  // Create a DatedPrice object, which may be added into the product if needed
  const todaysDatedPrice: DatedPrice = {
    date: new Date(),
    price: product.currentPrice,
  };
  product.priceHistory = [todaysDatedPrice];

  // If product values pass validation, return product
  if (validateProduct(product)) return product;

  // Log if out of stock or other errors
  const outOfStock = $(element).find('product-add-to-trolley button').text().trim();
  if (outOfStock.includes('Out of stock')) {
    logError(
      `  Out of stock: ${product.id.padStart(6)} | ${product.name} | ` + `$${product.currentPrice}`
    );
    return undefined;
  } else {
    logError(
      `  Unable to Scrape: ${product.id.padStart(6)} | ${product.name} | ` +
        `$${product.currentPrice}`
    );
    return undefined;
  }
}

// Runs basic validation on scraped product
function validateProduct(product: Product): boolean {
  try {
    if (product.name.length < 4 || product.name.length > 100) return false;
    if (product.id.length < 2 || product.id.length > 20) return false;
    if (
      product.currentPrice <= 0 ||
      product.currentPrice === null ||
      product.currentPrice === undefined ||
      Number.isNaN(product.currentPrice) ||
      product.currentPrice > 999
    ) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

// parseAndCategoriseURL()
// =====================
// Parses a URL string and category from a line of text, also optimises query parameters
// Returns undefined if not a valid URL
// Example In/Out:
// countdown.co.nz/shop/browse/frozen/ice-cream-sorbet/tubs category=ice-cream
// {
//    url: "https://countdown.co.nz/shop/browse/frozen/ice-cream-sorbet/tubs?page=1&size=48&inStockProductsOnly=true"
//    category: "ice-cream"
// }
export function parseAndCategoriseURL(line: string): CategorisedUrl | undefined {
  let categorisedUrl: CategorisedUrl = { url: '', categories: [] };

  // If line doesn't contain desired url section, return undefined
  if (!line.includes('countdown.co.nz')) {
    return undefined;
  } else {
    // Split line by empty space, look for url and optional category
    line.split(' ').forEach((section) => {
      if (section.includes('countdown.co.nz')) {
        categorisedUrl.url = section;

        // Ensure URL has http:// or https://
        if (!categorisedUrl.url.startsWith('http'))
          categorisedUrl.url = 'https://' + categorisedUrl.url;

        // If url contains ? it has query options already set
        if (categorisedUrl.url.includes('?')) {
          // Strip any existing query options off of URL
          categorisedUrl.url = line.substring(0, line.indexOf('?'));
        }
        // Replace query parameters with optimised ones,
        //  such as limiting to certain sellers,
        //  or showing a higher number of products
        categorisedUrl.url += '?page=1&size=48&inStockProductsOnly=true';

        // Parse in 1 or more categories
      } else if (section.startsWith('categories=')) {
        let splitCategories = [section.replace('categories=', '')];
        if (section.includes(',')) splitCategories = section.replace('categories=', '').split(',');
        categorisedUrl.categories = splitCategories;
      }
    });
  }

  // If no category was specified, derive one from the last url /section/
  if (categorisedUrl.categories.length === 0) {
    // Extract /slashSections/ from url, while excluding content after '?'
    const baseUrl = categorisedUrl!.url.split('?')[0];
    let slashSections = baseUrl.split('/');

    // Set category to last url /section/
    categorisedUrl.categories = [slashSections[slashSections.length - 1]];
  }

  return categorisedUrl;
}

// Excludes ads, tracking, and bandwidth intensive resources from being downloaded by Playwright
async function routePlaywrightExclusions() {
  let typeExclusions = ['image', 'media', 'font'];
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
      // logError(`${req.method()} ${req.resourceType()} - ${trimmedUrl}`);
      await route.abort();
    } else {
      //log(colour.white, `${req.method()} ${req.resourceType()} - ${trimmedUrl}`);
      await route.continue();
    }
  });

  return;
}
