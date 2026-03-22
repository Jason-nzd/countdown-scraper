import * as dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: `.env.local`, override: true });
import playwright from "playwright";
import * as cheerio from "cheerio";
import _ from "lodash";
import { establishCosmosDB, upsertProductToCosmosDB } from "./cosmosdb.js";
import { CategorisedUrl, Product, UpsertResponse } from "./typings";
import {
  log, colour, logProductRow, logError, logWarn, getTimeElapsedSince,
  logTableHeader, delay, withRetry,
} from "./utilities.js";
import { establishPlaywrightPage, selectStoreByLocationName } from "./browser.js";
import { playwrightElementToProduct } from "./parser.js";
import { loadUrlsFile, parseAndCategoriseURL } from "./url-loader.js";


// Woolworths / Countdown Scraper
// ------------------------------
// Scrapes pricing and other info from Woolworths NZ's website.

// Set a reasonable delay between each page load to reduce load on the server.
const pageLoadDelaySeconds = 7;

// Load URLs from text file 'urls.txt'
let categorisedUrls: CategorisedUrl[] = loadUrlsFile();

// Handle command-line arguments, ex: 'db', 'images', or single urls
export let databaseMode = false;
export let uploadImagesMode = false;
let headlessMode = true;
categorisedUrls = await handleArguments(categorisedUrls);

// Establish CosmosDB connection if being used
if (databaseMode) establishCosmosDB();

// Establish playwright browser
const { browser, page } = await establishPlaywrightPage(headlessMode);

// Select store location
await selectStoreByLocationName(page);

// Record start time for logging
const startTime = Date.now();

// Main Loop - Loop and process every page
await processAllPageUrls();

// Program End and Cleanup
browser.close();
log(`\nAll Pages Complete - Total Time Elapsed ${getTimeElapsedSince(startTime)} \n`);
// -----------------------


// processAllPageUrls
// ------------------
// Loops through each page URL scraping pricing and other info.

async function processAllPageUrls() {

  // Log loop start
  log(
    colour.yellow,
    `${categorisedUrls.length} pages to be scraped`.padEnd(35) +
    `${pageLoadDelaySeconds}s delay between scrapes`.padEnd(35) +
    (databaseMode ? "(Database Mode)" : "(Dry Run Mode)")
  );

  // Loop through each page URL to scrape
  for (let i = 0; i < categorisedUrls.length; i++) {
    const categorisedUrl: CategorisedUrl = categorisedUrls[i];

    try {
      const result = await scrapePage(page, categorisedUrl, databaseMode, uploadImagesMode);

      if (result.skipped) {
        await delay(pageLoadDelaySeconds * 1000);
        continue;
      }

      // Delay between each page load (not after the last one)
      if (i < categorisedUrls.length - 1) {
        await delay(pageLoadDelaySeconds * 1000);
      }

    } catch (error: unknown) {
      if (typeof error === 'string') {
        if (error.includes("NS_ERROR_CONNECTION_REFUSED")) {
          logError("Connection Failed - Check Firewall\n" + error);
          return;
        }
      }
      logError(
        "Page Timeout after 15 seconds - Skipping this page\n" + error
      );
      // Delay before continuing to next URL
      await delay(pageLoadDelaySeconds * 1000);
    }
  }
}


// scrapePage()
// ------------
// Scrapes a single page URL and processes all products found.
// Returns statistics about what was scraped/updated.

interface PageScrapeResult {
  success: boolean;
  productCount: number;
  newProducts: number;
  priceChanged: number;
  infoUpdated: number;
  alreadyUpToDate: number;
  skipped: boolean;
}

async function scrapePage(
  page: playwright.Page,
  categorisedUrl: CategorisedUrl,
  databaseMode: boolean,
  uploadImagesMode: boolean
): Promise<PageScrapeResult> {
  const url = categorisedUrl.url;
  const shortUrl = url.replace("https://", "");

  logWarn(`\n${shortUrl}`);

  // Navigate to page with retry logic
  await withRetry(
    async () => {
      await page.goto(url);
      await page.setDefaultTimeout(8000);
      await page.waitForSelector("product-price h3");
    },
    { maxRetries: 3, delay: 2000, label: `Page load for ${shortUrl}` }
  );

  // Page down multiple times to trigger any lazy loads
  for (let pageDown = 0; pageDown < 5; pageDown++) {
    const timeBetweenPgDowns = Math.random() * 1000 + 500;
    await page.waitForTimeout(timeBetweenPgDowns);
    await page.keyboard.press("PageDown");
  }

  // If url has page= query parameter, check to see that page is available
  let desiredPageNumber = 1;
  let numPagesAvailable = 1;
  if (categorisedUrl.url.includes("page=")) {
    const currentPageMatch = categorisedUrl.url.match(/page=(\d+)/);
    if (currentPageMatch) {
      desiredPageNumber = parseInt(currentPageMatch[1]);

      try {
        const paginationUL = await page.innerHTML("ul.pagination");
        const $$ = cheerio.load(paginationUL);
        numPagesAvailable = $$("li").length - 2;
      } catch {
        numPagesAvailable = 1;
      }

      if (desiredPageNumber > numPagesAvailable) {
        logWarn(`Page ${desiredPageNumber} does not exist, only ${numPagesAvailable} pages available. Skipping..`);
        return { success: false, productCount: 0, newProducts: 0, priceChanged: 0, infoUpdated: 0, alreadyUpToDate: 0, skipped: true };
      }
    }
  }

  // Load html into Cheerio for DOM selection
  const html = await page.innerHTML("product-grid");
  const $ = cheerio.load(html);

  // Find all product entries
  const allProductEntries = $("cdx-card product-stamp-grid div.product-entry");

  // Find advertisement product entries not normally part of this product category
  const advertisementEntries = $("div.carousel-track div cdx-card product-stamp-grid div.product-entry");
  const adHrefs: string[] = advertisementEntries.map((index, element) => {
    return $(element).find("a").first().attr("href");
  }).toArray();

  // Filter out product entries that match the found advertisements
  const productEntries = allProductEntries.filter((index, element) => {
    const productHref = $(element).find("a").first().attr("href");
    return !adHrefs.includes(productHref!);
  });

  // Log the number of products found, time elapsed, category, pages
  logWarn(
    `${productEntries.length} product entries found`.padEnd(38) +
    `Time Elapsed: ${getTimeElapsedSince(startTime)}`.padEnd(35) +
    `Category: ${_.startCase(categorisedUrl.category).padEnd(20)}` +
    `Page: ${desiredPageNumber}/${numPagesAvailable}`
  );

  // Log table header
  if (!databaseMode) logTableHeader();

  // Process each product entry
  let perPageLogStats = {
    newProducts: 0,
    priceChanged: 0,
    infoUpdated: 0,
    alreadyUpToDate: 0,
  };

  perPageLogStats = await processFoundProductEntries(
    categorisedUrl,
    productEntries,
    perPageLogStats,
    databaseMode,
    uploadImagesMode
  );

  // Log summary for database mode
  if (databaseMode) {
    log(
      `CosmosDB: ${perPageLogStats.newProducts} new products, ` +
      `${perPageLogStats.priceChanged} updated prices, ` +
      `${perPageLogStats.infoUpdated} updated info, ` +
      `${perPageLogStats.alreadyUpToDate} already up-to-date`
    );
  }

  return {
    success: true,
    productCount: productEntries.length,
    ...perPageLogStats,
    skipped: false,
  };
}

// processFoundProductEntries
// --------------------------
// Loops through each product entry and scrapes pricing and other info.
// This function is called by scrapePage.
async function processFoundProductEntries(
  categorisedUrl: CategorisedUrl,
  productEntries: cheerio.Cheerio<any>,
  perPageLogStats: {
    newProducts: number;
    priceChanged: number;
    infoUpdated: number;
    alreadyUpToDate: number;
  },
  databaseMode: boolean,
  uploadImagesMode: boolean
) {

  // Loop through each product entry
  for (let i = 0; i < productEntries.length; i++) {
    const productEntryElement = productEntries[i];

    const product = playwrightElementToProduct(
      productEntryElement,
      categorisedUrl.category
    );

    if (databaseMode && product !== undefined) {
      // Insert or update item into azure cosmosdb
      const response = await upsertProductToCosmosDB(product);

      // Use response to update logging counters
      switch (response) {
        case UpsertResponse.AlreadyUpToDate:
          perPageLogStats.alreadyUpToDate++;
          break;
        case UpsertResponse.NewProduct:
          perPageLogStats.newProducts++;
          break;
        case UpsertResponse.PriceChanged:
          perPageLogStats.priceChanged++;
          break;
        default:
          break;
      }

      // Upload image to Azure Function
      if (uploadImagesMode) {
        const imageUrl = getImageUrl(product.id);
        await uploadImageToRestAPI(imageUrl, product);
      }
    } else if (!databaseMode && product !== undefined) {
      logProductRow(product!);
    }

    // Add a tiny delay between each product loop.
    // This makes printing the log more readable
    await delay(20);
  }

  // Return log stats for completed page
  return perPageLogStats;
}

// getImageUrl()
// -------------
// Build image URL from product ID

function getImageUrl(productId: string): string {
  const imageUrlBase = "https://assets.woolworths.com.au/images/2010/";
  const imageUrlExtensionAndQueryParams = ".jpg?impolicy=wowcdxwbjbx&w=900&h=900";
  return imageUrlBase + productId + imageUrlExtensionAndQueryParams;
}

// uploadImageToRestAPI()
// --------------------
// Send image url to an Azure Function API

async function uploadImageToRestAPI(
  imgUrl: string,
  product: Product
): Promise<boolean> {
  // Check if passed in url is valid, return if not
  if (imgUrl === undefined || !imgUrl.includes("http") || product.id.length < 4) {
    log(`  Image ${product.id} has invalid url: ${imgUrl}`);
    return false;
  }

  // Get IMAGE_UPLOAD_FUNC_URL from env
  // Example format:
  // https://<func-app>.azurewebsites.net/api/ImageToS3?code=<auth-code>
  const funcBaseUrl = process.env.IMAGE_UPLOAD_FUNC_URL;

  // Check funcBaseUrl is valid
  if (!funcBaseUrl?.includes("http")) {
    throw Error(
      "\nIMAGE_UPLOAD_FUNC_URL in .env is invalid. Should be in .env :\n\n" +
      "IMAGE_UPLOAD_FUNC_URL=https://<func-app>.azurewebsites.net/api/ImageToS3?code=<auth-code>\n\n"
    );
  }
  const restUrl = `${funcBaseUrl}${product.id}&source=${imgUrl}`;

  // Perform http get
  var res = await fetch(new URL(restUrl), { method: "GET" });
  var responseMsg = await (await res.blob()).text();

  if (responseMsg.includes("S3 Upload of Full-Size")) {
    // Log for successful upload
    log(`  New Image  : ${(product.id + ".webp").padEnd(11)} | ` +
      `${product.name.padEnd(40).slice(0, 40)}`
    );
  } else if (responseMsg.includes("already exists")) {
    // Do not log for existing images
  } else if (responseMsg.includes("Unable to download:")) {
    // Log for missing images
    log(`  Image ${product.id} unavailable to be downloaded`);
  } else if (responseMsg.includes("unable to be processed")) {
    log(`  Image ${product.id} unable to be processed`);
  } else {
    // Log any other errors that may have occurred
    console.log(responseMsg);
  }
  return true;
}

// handleArguments()
// -----------------
// Handle command line arguments. Can be reverse mode, dry-run-mode, custom url, or categories

function handleArguments(categorisedUrls: CategorisedUrl[]): CategorisedUrl[] {
  if (process.argv.length > 2) {
    // Slice out the first 2 arguments, as they are not user-provided
    const userArgs = process.argv.slice(2, process.argv.length);

    // Loop through all args and find any matching keywords
    let potentialUrl = "";
    userArgs.forEach(async (arg) => {
      if (arg === "db") databaseMode = true;
      else if (arg === "images") uploadImagesMode = true;
      else if (arg === "headless") headlessMode = true // is already default
      else if (arg === "headed") headlessMode = false

      // Any arg containing .co.nz will replaced the URLs text file to be scraped.
      else if (arg.includes(".co.nz")) potentialUrl += arg;

      // Reverse the order of the URLs to be scraped, starting from the bottom
      else if (arg === "reverse") categorisedUrls = categorisedUrls.reverse();

    });

    // Try to parse the potential new url
    const parsedUrl = parseAndCategoriseURL(potentialUrl);
    if (parsedUrl !== undefined) categorisedUrls = parsedUrl;
  }
  return categorisedUrls;
}
