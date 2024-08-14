import * as dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: `.env.local`, override: true });

import playwright from "playwright";
import * as cheerio from "cheerio";
import _ from "lodash";
import { setTimeout } from "timers/promises";

import { establishCosmosDB, upsertProductToCosmosDB } from "./cosmosdb.js";
import { productOverrides } from "./product-overrides.js";
import { CategorisedUrl, DatedPrice, Product, UpsertResponse } from "./typings";
import {
  log, colour, logProductRow, logError, readLinesFromTextFile, getTimeElapsedSince,
  addUnitPriceToProduct, logTableHeader,
} from "./utilities.js";

// Woolworths / Countdown Scraper
// ------------------------------
// Scrapes pricing and other info from Woolworths NZ's website.

// Set a reasonable delay between each page load to reduce load on the server.
const pageLoadDelaySeconds = 7;

// Set a delay when logging each product per page to the console.
const productLogDelayMilliSeconds = 20;

// Record start time, for logging purposes
const startTime = Date.now();

// Load URLs from text file
let categorisedUrls = loadUrlsFile();

// Handle command-line arguments
export let databaseMode = false;
export let uploadImagesMode = false;
let headlessMode = true;
categorisedUrls = await handleArguments(categorisedUrls);

// Establish CosmosDB if being used
if (databaseMode) establishCosmosDB();

// Establish playwright browser
let browser: playwright.Browser;
let page: playwright.Page;
browser = await establishPlaywrightPage(headlessMode);

// Select store location
await selectStoreByLocationName();

// Main Loop - Scrape through each page
await scrapeAllPageURLs();

// Program End and Cleanup
browser.close();
log(
  colour.sky,
  `\nAll Pages Completed = Total Time Elapsed ${getTimeElapsedSince(startTime)} \n`
);
// -----------------------


// loadUrlsFile
// ------------
// Loads and validates URLs from a txt file to be scraped.

function loadUrlsFile(filePath: string = "src/urls.txt"): CategorisedUrl[] {
  // Try to read file urls.txt or other file for a list of URLs
  const rawLinesFromFile: string[] = readLinesFromTextFile(filePath);

  // Parse and optimise URLs
  let categorisedUrls: CategorisedUrl[] = [];
  rawLinesFromFile.map((line) => {
    let parsedUrls = parseAndCategoriseURL(line);
    if (parsedUrls !== undefined) {
      categorisedUrls = [...categorisedUrls, ...parsedUrls];
    }
  });

  // Return as an array of CategorisedUrl objects
  return categorisedUrls;
}

// scrapeAllPageURLs
// ---------------
// Loops through each page URL and scrapes pricing and other info.
// This is the main function that calls the other functions.

async function scrapeAllPageURLs() {

  // Log loop start
  log(
    colour.yellow,
    `${categorisedUrls.length} pages to be scraped`.padEnd(32) +
    `${pageLoadDelaySeconds}s delay between scrapes`.padEnd(32) +
    (databaseMode ? "(Database Mode)" : "(Dry Run Mode)")
  );

  // Loop through each page URL to scrape
  for (let i = 0; i < categorisedUrls.length; i++) {
    const categorisedUrl = categorisedUrls[i];
    const url = categorisedUrl.url;

    // Log current scrape sequence and the total number of pages to scrape
    const shortUrl = url.replace("https://", "").split("&")[0];
    log(
      colour.yellow,
      `\n[${i + 1}/${categorisedUrls.length}] ${shortUrl}`
    );

    try {
      // Open page with url options now set
      await page.goto(url);

      // Wait and page down multiple times to further trigger any lazy loads
      for (let pageDown = 0; pageDown < 5; pageDown++) {
        // create a random number between 500 and 1500
        const timeBetweenPgDowns = Math.random() * 1000 + 500;
        await page.waitForTimeout(timeBetweenPgDowns);
        await page.keyboard.press("PageDown");
      }

      // Set page timeout to 15 seconds
      await page.setDefaultTimeout(15000);

      // Wait for product-price h3 html element to dynamically load in,
      //  this is required to see product data
      await page.waitForSelector("product-price h3");

      // Load html into Cheerio for DOM selection
      const html = await page.innerHTML("product-grid");
      const $ = cheerio.load(html);
      const productEntries = $("cdx-card product-stamp-grid div.product-entry");

      // Log the number of products found, time elapsed, category
      log(
        colour.yellow,
        `${productEntries.length} product entries found`.padEnd(32) +
        `Time Elapsed: ${getTimeElapsedSince(startTime)}`.padEnd(32) +
        `Category: ${_.startCase(categorisedUrl.categories.join(" - "))}`
      );

      // Log table header
      if (!databaseMode) logTableHeader();

      // Store number of items processed for logging purposes
      let perPageLogStats = {
        newProducts: 0,
        priceChanged: 0,
        infoUpdated: 0,
        alreadyUpToDate: 0,
      }

      // Start nested loop which loops through each product entry
      perPageLogStats = await processFoundProductEntries(categorisedUrl, productEntries, perPageLogStats);

      // After scraping every item is complete, log how many products were scraped
      if (databaseMode) {
        log(
          colour.blue,
          `CosmosDB: ${perPageLogStats.newProducts} new products, ` +
          `${perPageLogStats.priceChanged} updated prices, ` +
          `${perPageLogStats.infoUpdated} updated info, ` +
          `${perPageLogStats.alreadyUpToDate} already up-to-date`
        );
      }

      // Delay between each page load
      await setTimeout(pageLoadDelaySeconds * 1000);

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
    }
  }
}

// processFoundProductEntries
// --------------------------
// Loops through each product entry and scrapes pricing and other info.
// This function is called by scrapeAllPageURLs.

async function processFoundProductEntries
  (
    categorisedUrl: CategorisedUrl,
    productEntries: cheerio.Cheerio<cheerio.Element>,
    perPageLogStats: {
      newProducts: number;
      priceChanged: number;
      infoUpdated: number;
      alreadyUpToDate: number;
    }) {

  // Loop through each product entry
  for (let i = 0; i < productEntries.length; i++) {
    const productEntryElement = productEntries[i];

    const product = playwrightElementToProduct(
      productEntryElement,
      categorisedUrl.categories
    );

    if (databaseMode && product !== undefined) {
      // Insert or update item into azure cosmosdb
      const response = await upsertProductToCosmosDB(product);

      // Use response to update logging counters
      switch (response) {
        case UpsertResponse.AlreadyUpToDate:
          perPageLogStats.alreadyUpToDate++;
          break;
        case UpsertResponse.InfoChanged:
          perPageLogStats.infoUpdated++;
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
        // Get image url using provided base url, product ID, and hi-res query parameters
        const imageUrlBase =
          "https://assets.woolworths.com.au/images/2010/";
        const imageUrlExtensionAndQueryParams =
          ".jpg?impolicy=wowcdxwbjbx&w=900&h=900";
        const imageUrl =
          imageUrlBase + product.id + imageUrlExtensionAndQueryParams;

        await uploadImageRestAPI(imageUrl!, product);
      }
    } else if (!databaseMode && product !== undefined) {
      // When doing a dry run, log product name - size - price in table format
      logProductRow(product!);
    }

    // Add a tiny delay between each product loop.
    // This makes printing the log more readable
    await setTimeout(productLogDelayMilliSeconds);
  }

  // Return log stats for completed page
  return perPageLogStats;
}

// uploadImageRestAPI()
// --------------------
// Send image url to an Azure Function API

async function uploadImageRestAPI(
  imgUrl: string,
  product: Product
): Promise<boolean> {
  // Check if passed in url is valid, return if not
  if (imgUrl === undefined || !imgUrl.includes("http") || product.id.length < 4) {
    log(colour.grey, `  Image ${product.id} has invalid url: ${imgUrl}`);
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
    log(
      colour.grey,
      `  New Image  : ${(product.id + ".webp").padEnd(11)} | ` +
      `${product.name.padEnd(40).slice(0, 40)}`
    );
  } else if (responseMsg.includes("already exists")) {
    // Do not log for existing images
  } else if (responseMsg.includes("Unable to download:")) {
    // Log for missing images
    log(colour.grey, `  Image ${product.id} unavailable to be downloaded`);
  } else if (responseMsg.includes("unable to be processed")) {
    log(colour.grey, `  Image ${product.id} unable to be processed`);
  } else {
    // Log any other errors that may have occurred
    console.log(responseMsg);
  }
  return true;
}

// handleArguments()
// -----------------
// Handle command line arguments. Can be reverse mode, dry-run-mode, custom url, or categories

function handleArguments(categorisedUrls): CategorisedUrl[] {
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
      // else if (arg === "custom") {
      //   categorisedUrls = [];
      //   await customQuery();
      //   process.exit();
      // }
    });

    // Try to parse the potential new url
    const parsedUrl = parseAndCategoriseURL(potentialUrl);
    if (parsedUrl !== undefined) categorisedUrls = [parsedUrl];
  }
  return categorisedUrls;
}

// establishPlaywrightPage()
// -------------------------
// Create a playwright browser

async function establishPlaywrightPage(headless = true) {
  log(
    colour.yellow,
    "Launching Browser.. " +
    (process.argv.length > 2
      ? "(" + (process.argv.length - 2) + " arguments found)"
      : "")
  );
  browser = await playwright.firefox.launch({
    headless: headless,
  });
  page = await browser.newPage();

  // Reject unnecessary ad/tracking urls
  await routePlaywrightExclusions();

  return browser;
}

// selectStoreByLocationName()
// ---------------------------
// Selects a store location by typing in the specified location address

async function selectStoreByLocationName(locationName: string = "") {
  // If no location was passed in, also check .env for STORE_NAME
  if (locationName === "") {
    if (process.env.STORE_NAME) locationName = process.env.STORE_NAME;
    // If STORE_NAME is also not present, skip store location selection
    else return;
  }

  log(colour.yellow, "Selecting Store Location..");

  // Open store selection page
  try {
    await page.setDefaultTimeout(12000);
    await page.goto("https://www.woolworths.co.nz/bookatimeslot", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("fieldset div div p button");
  } catch (error) {
    logError("Location selection page timed out - Using default location instead");
    return;
  }

  const oldLocation = await page
    .locator("fieldset div div p strong")
    .innerText();

  // Click change address modal
  await page.locator("fieldset div div p button").click();
  await page.waitForSelector("form-suburb-autocomplete form-input input");
  try {
    // Type in address, wait 1.5s for auto-complete to populate entries
    await page
      .locator("form-suburb-autocomplete form-input input")
      .type(locationName);
    await page.waitForTimeout(1500);

    // Select first matched entry, wait for validation
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);

    // Click save location button
    await page.getByText("Save and Continue Shopping").click();
    log(
      colour.yellow,
      "Changed Location from " + oldLocation + " to " + locationName + "\n"
    );

    // Ensure location is saved before moving on
    await page.waitForTimeout(2000);
  } catch {
    // Catch timeout if no locations are found using the provided env value.
    logError(
      `Store Location:${locationName} not found. Using default instead.`
    );
  }
}

// playwrightElementToProduct()
// ----------------------------
// Takes a playwright html element for 'a.product-entry', builds and returns a Product

export function playwrightElementToProduct(
  element: cheerio.Element,
  categories: string[]
): Product | undefined {
  const $ = cheerio.load(element);

  let product: Product = {
    // Extract ID from h3 tag and remove non-numbers
    id: $(element).find("h3").first().attr("id")?.replace(/\D/g, "") as string,

    // Original title is all lower-case and needs to be made into start-case
    name: _.startCase(
      $(element)
        .find("h3")
        .first()
        .text()

        // Clean unnecessary words from titles
        .replace("fresh fruit", "")
        .replace("fresh vegetable", "")

        // Clean variable weights from meat products, such 'Pork Loin Chops 0.4-0.9kg 3-4pcs'
        .replace(/(\d\.\d-\d\.\d)kg (\d-\d)pcs/, "")

        // Clean excess whitespace
        .replace("  ", " ")
        .trim()
    ),

    // Product size may be blank
    size: $(element).find("div.product-meta p span.size").text().trim(),

    // Store where the source of information came from
    sourceSite: "countdown.co.nz",

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
    .find("div.product-meta product-price h3 em")
    .text()
    .trim();
  let centString: string = $(element)
    .find("div.product-meta product-price h3 span")
    .text()
    .trim();
  if (centString.includes("kg")) product.size = "per kg";
  centString = centString.replace(/\D/g, "");

  product.currentPrice = Number(dollarString + "." + centString);

  // Create a date object for now, but with minutes and seconds set to 0
  const today = new Date();
  today.setMinutes(0);
  today.setSeconds(0);

  // Create a DatedPrice object, which may be added into the product if needed
  const todaysDatedPrice: DatedPrice = {
    date: today,
    price: product.currentPrice,
  };
  product.priceHistory = [todaysDatedPrice];

  // Check for manually overridden product data
  productOverrides.forEach((override) => {
    // First check if product ID has any overrides
    if (override.id === product.id) {
      // Check for size override
      if (override.size !== undefined) {
        // console.log(`${product.name} - overriding size from ${product.size} to ${override.size}`);
        product.size = override.size;
      }

      // Check for category override
      if (override.category !== undefined) {
        // console.log(
        //   `${product.name} - overriding category from ${product.category} to ${override.category}`
        // );
        product.category = [override.category];
      }
    }
  });

  // Try add unit price and unit name to product
  product = addUnitPriceToProduct(product);

  // If product values pass validation, return product
  if (validateProduct(product)) return product;

  // Log if out of stock or other errors
  const outOfStock = $(element)
    .find("product-add-to-trolley button")
    .text()
    .trim();
  if (
    outOfStock.includes("Out of stock") ||
    outOfStock.includes("Unavailable")
  ) {
    return undefined;
  } else {
    logError(
      `  Unable to Scrape: ${product.id.padStart(6)} | ${product.name} | ` +
      `$${product.currentPrice}`
    );
    return undefined;
  }
}

// validateProduct()
// -----------------
// Checks scraped product values are within reasonable ranges

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
// -----------------------
// Parses a URL string, an optional category, optional number of pages to scrape
//  from a single line of text.
// Returns undefined if not a valid URL
// Example Input:
//    woolworths.co.nz/shop/browse/frozen/ice-cream-sorbet/tubs category=ice-cream pages=2
// Example Return:
//  [
//    {
//        url: "https://woolworths.co.nz/shop/browse/frozen/ice-cream-sorbet/tubs?page=1&inStockProductsOnly=true"
//        category: "ice-cream"
//    },
//    {
//        url: "https://woolworths.co.nz/shop/browse/frozen/ice-cream-sorbet/tubs?page=2&inStockProductsOnly=true"
//        category: "ice-cream"
//    }
//  ]

export function parseAndCategoriseURL(
  line: string
): CategorisedUrl[] | undefined {
  let baseCategorisedURL: CategorisedUrl = { url: "", categories: [] };
  let parsedUrls: CategorisedUrl[] = [];
  let numPagesPerURL = 1;

  // If line doesn't contain desired url section, return undefined
  if (!line.includes("woolworths.co.nz")) {
    return undefined;
  } else {
    // Split line by empty space, look for url, optional page amount & category
    line.split(" ").forEach((section) => {

      // Parse URL
      if (section.includes("woolworths.co.nz")) {
        baseCategorisedURL.url = section;

        // Ensure URL has http:// or https://
        if (!baseCategorisedURL.url.startsWith("http"))
          baseCategorisedURL.url = "https://" + section;

        // If url contains ? it has query options already set
        if (section.includes("?")) {
          // Strip any existing query options off of URL
          baseCategorisedURL.url = line.substring(0, line.indexOf("?"));
        }
        // Replace query parameters with optimised ones,
        //  such as limiting to in-stock only,
        baseCategorisedURL.url += '?page=1&inStockProductsOnly=true';


        // Parse Category
      } else if (section.startsWith("categories=")) {
        let splitCategories = [section.replace("categories=", "")];
        if (section.includes(","))
          splitCategories = section.replace("categories=", "").split(",");
        baseCategorisedURL.categories = splitCategories;

        // If no category was specified, derive one from the last url /section/
        if (baseCategorisedURL.categories.length === 0) {
          // Extract /slashSections/ from url, while excluding content after '?'
          const baseUrl = baseCategorisedURL.url.split("?")[0];
          let slashSections = baseUrl.split("/");

          // Set category to last url /section/
          baseCategorisedURL.categories = [slashSections[slashSections.length - 1]];
        }

        // Parse number of pages
      } else if (section.startsWith("pages=")) {
        numPagesPerURL = Number.parseInt(section.split("=")[1]);
      }
    });

    // For multiple pages, duplicate the url and edit the ?page=1 query parameter
    for (let i = 1; i <= numPagesPerURL; i++) {
      let pagedUrl = {
        url: baseCategorisedURL.url.replace("page=1", "page=" + i),
        categories: baseCategorisedURL.categories,
      }
      parsedUrls.push(pagedUrl);
    }
  }


  return parsedUrls;
}

// routePlaywrightExclusions()
// ---------------------------
// Excludes ads, tracking, and bandwidth intensive resources from being downloaded by Playwright

async function routePlaywrightExclusions() {
  let typeExclusions = ["image", "media", "font"];
  let urlExclusions = [
    "googleoptimize.com",
    "gtm.js",
    "visitoridentification.js",
    "js-agent.newrelic.com",
    "cquotient.com",
    "googletagmanager.com",
    "cloudflareinsights.com",
    "dwanalytics",
    "facebook.net",
    "chatWidget",
    "edge.adobedc.net",
    "​/Content/Banners/",
    "algolia.io",
    "algoliaradar.com",
    "go-mpulse.net"
  ];

  // Route with exclusions processed
  await page.route("**/*", async (route) => {
    const req = route.request();
    let excludeThisRequest = false;
    //let trimmedUrl = req.url().length > 120 ? req.url().substring(0, 120) + '...' : req.url();

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
