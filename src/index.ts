import playwright from 'playwright';
import * as cheerio from 'cheerio';
import _ from 'lodash';
import * as dotenv from 'dotenv';
import { upsertProductToCosmosDB } from './cosmosdb.js';
import { DatedPrice, Product, UpsertResponse } from './typings';
import {
  log,
  colour,
  logProductRow,
  logError,
  parseAndOptimiseURL,
  readLinesFromTextFile,
} from './utilities.js';
dotenv.config();

// Countdown Scraper
// Scrapes pricing and other info from Countdown NZ's website.

const secondsDelayBetweenPageScrapes = 22;
const uploadImagesToAzureFunc = true;

// Playwright variables
let browser: playwright.Browser;
let page: playwright.Page;

// Try to read file urls.txt for a list of URLs
let rawLinesFromFile: string[] = readLinesFromTextFile('src/urls.txt');

// Parse and optimise urls
let urlsToScrape: string[] = [];
rawLinesFromFile.map((line) => {
  let parsedLine = parseAndOptimiseURL(
    line,
    'countdown.co.nz',
    '?page=1&size=48&inStockProductsOnly=true'
  );
  if (parsedLine != undefined) urlsToScrape.push(parsedLine);
});

// Can change dryRunMode to true to only log results to console
let dryRunMode = false;

// Handle command-line arguments
handleArguments();

// Establish playwright browser
await establishPlaywrightPage();

// Counter and promise to help with delayed looping of each page load
let pagesScrapedCount = 1;
let promise = Promise.resolve();

// Loop through each URL to scrape
urlsToScrape.forEach((url) => {
  // Use promises to ensure a delay between each scrape
  promise = promise.then(async () => {
    // Log status
    log(
      colour.yellow,
      `[${pagesScrapedCount}/${urlsToScrape.length}] ` +
        `Scraping Page.. ${url.substring(12, url.length - 17)}` +
        (dryRunMode ? ' (Dry Run Mode On)' : '')
    );

    let pageLoadValid = false;
    try {
      // Open page with url options now set
      await page.goto(url);

      // Wait for <cdx-card> html element to dynamically load in,
      //  this is required to see product data
      await page.waitForSelector('cdx-card');

      pageLoadValid = true;
    } catch (error) {
      logError('Page Timeout after 30 seconds - Skipping this page');
    }

    // Count number of items processed for logging purposes
    let alreadyUpToDateCount = 0;
    let priceChangedCount = 0;
    let infoUpdatedCount = 0;
    let newProductsCount = 0;
    let failedCount = 0;

    // If page load is valid, load html into Cheerio for easy DOM selection
    if (pageLoadValid) {
      const html = await page.evaluate(() => document.body.innerHTML);
      const $ = cheerio.load(html);
      const productEntries = $('cdx-card a.product-entry');
      log(
        colour.yellow,
        productEntries.length +
          ' product entries found with categories: [' +
          deriveCategoriesFromUrl(url).join(', ') +
          ']'
      );

      // Loop through each product entry, add desired data into a Product object
      let promises = productEntries.map(async (index, productEntryElement) => {
        const product = playwrightElementToProduct(productEntryElement, url);

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
            case UpsertResponse.Failed:
            default:
              failedCount++;
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
        } else {
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
          `${alreadyUpToDateCount} already up-to-date, ` +
          `${failedCount} failed updates`
      );
    }

    // If all scrapes have completed, close the playwright browser
    if (pagesScrapedCount++ === urlsToScrape.length) {
      browser.close();
      log(colour.cyan, 'All Scraping Completed \n');
      return;
    } else {
      log(colour.grey, `Waiting ${secondsDelayBetweenPageScrapes}s until next scrape..\n`);
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
      `  New Image: ${cdnCheckUrlBase}200/${product.id}.webp | ` +
        `${product.name.padEnd(30).slice(0, 30)}`
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
  // Handle arguments, can be reverse mode, dry-run-mode, or custom url
  if (process.argv.length > 2) {
    // Slice out the first 2 arguments, as they are not user-provided
    const userArgs = process.argv.slice(2, process.argv.length);

    // Loop through all args and find any matching keywords
    userArgs.forEach((arg) => {
      if (arg === 'dry-run-mode') dryRunMode = true;
      else if (arg.includes('.co.nz')) {
        const parsedUrl = parseAndOptimiseURL(
          arg,
          'countdown.co.nz',
          '?page=1&size=48&inStockProductsOnly=true'
        );
        if (parsedUrl !== undefined) urlsToScrape = [parsedUrl];
        else throw 'URL invalid: ' + arg;
      } else if (arg === 'reverse') {
        urlsToScrape = urlsToScrape.reverse();
      }
    });
  }
}

async function establishPlaywrightPage() {
  // Create a playwright headless browser using webkit
  log(colour.yellow, 'Launching Headless Browser..');
  browser = await playwright.webkit.launch({
    headless: true,
  });
  page = await browser.newPage();

  // Define unnecessary types and ad/tracking urls to reject
  await routePlaywrightExclusions();
}

// Function takes a single playwright element for 'a.product-entry',
//   then builds and returns a Product object with desired data
function playwrightElementToProduct(element: cheerio.Element, url: string): Product | undefined {
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

    // Categories are derived from url
    category: deriveCategoriesFromUrl(url),

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
  const centString: string = $(element)
    .find('div.product-meta product-price h3 span')
    .text()
    .trim()
    .replace(/\D/g, '');
  product.currentPrice = Number(dollarString + '.' + centString);

  // Create a DatedPrice object, which may be added into the product if needed
  const todaysDatedPrice: DatedPrice = {
    date: new Date(),
    price: product.currentPrice,
  };
  product.priceHistory = [todaysDatedPrice];

  if (validateProduct(product)) return product;
  else {
    logError('Product Scrape Invalid: ' + product.name);
    return undefined;
  }
}

// Derives category names from url, if any categories are available
// www.domain.com/shop/browse/frozen/ice-cream-sorbet/tubs
// returns '[ice-cream-sorbet]'
export function deriveCategoriesFromUrl(url: string): string[] {
  // If url doesn't contain /browse/, return no category
  if (url.indexOf('/browse/') > 0) {
    const categoriesStartIndex = url.indexOf('/browse/');
    const categoriesEndIndex = url.indexOf('?') > 0 ? url.indexOf('?') : url.length;
    const categoriesString = url.substring(categoriesStartIndex, categoriesEndIndex);
    //console.log(categoriesString);

    // Rename categories to normalised category names
    categoriesString.replace('/ice-cream-sorbet/tubs', '/ice-cream');

    // Exclude categories that are too broad or aren't useful
    const excludedCategories = [
      'browse',
      'biscuits-crackers',
      'snacks-sweets',
      'frozen-meals-snacks',
      'pantry',
      'frozen',
      'tubs',
      'fridge-deli',
      'other-frozen-vegetables',
    ];

    // Extract individual categories into array
    let splitCategories = categoriesString.split('/').filter((category) => {
      if (excludedCategories.includes(category)) return false;
      if (category === '') return false;
      if (category.length < 3) return false;
      else return true;
    });

    // Return categories if any,
    if (splitCategories.length > 0) return splitCategories;
  }
  // If no useful categories were found, return Uncategorised
  return ['Uncategorised'];
}

// Runs basic validation on scraped product
function validateProduct(product: Product): boolean {
  if (product.name.length === 0 || product.name.length > 100) return false;
  if (product.id.length === 0 || product.name.length > 100) return false;
  if (
    product.currentPrice === 0 ||
    product.currentPrice === null ||
    product.currentPrice === undefined ||
    product.currentPrice > 999
  ) {
    return false;
  }
  return true;
}

// Excludes ads, tracking, and bandwidth intensive resources from being downloaded by Playwright
async function routePlaywrightExclusions() {
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
      //logError(`${req.method()} ${req.resourceType()} - ${trimmedUrl}`);
      await route.abort();
    } else {
      //log(colour.white, `${req.method()} ${req.resourceType()} - ${trimmedUrl}`);
      await route.continue();
    }
  });

  return;
}
