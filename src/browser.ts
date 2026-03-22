import playwright from "playwright";
import { Page } from "playwright";
import { log, logError, colour, delay, logWarn } from "./utilities.js";

// establishPlaywrightPage()
// -------------------------
// Create a playwright browser

export async function establishPlaywrightPage(headless = true) {
  log(
    "Launching Browser.. " +
    (process.argv.length > 2
      ? "(" + (process.argv.length - 2) + " arguments found)"
      : "")
  );
  const browser = await playwright.firefox.launch({
    headless: headless,
  });
  const page = await browser.newPage();

  // Reject unnecessary ad/tracking urls
  await routePlaywrightExclusions(page);

  return { browser, page };
}

// selectStoreByLocationName()
// ---------------------------
// Selects a store location by typing in the specified location address

export async function selectStoreByLocationName(
  page: Page,
  locationName: string = ""
) {
  // If no location was passed in, also check .env for STORE_NAME
  if (locationName === "") {
    if (process.env.STORE_NAME) locationName = process.env.STORE_NAME;
    // If STORE_NAME is also not present, skip store location selection
    else return;
  }

  logWarn("Selecting Store Location..");

  // Retry logic with 4 retries and 5 second cooldowns
  const maxRetries = 4;
  const retryDelay = 5000; // 5 seconds

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Open store selection page
      await page.setDefaultTimeout(12000);
      await page.goto("https://www.woolworths.co.nz/bookatimeslot", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector("fieldset div div p button");

      const oldLocation = await page
        .locator("fieldset div div p strong")
        .innerText();

      // Click change address modal
      await page.locator("fieldset div div p button").click();
      await page.waitForSelector("form-suburb-autocomplete form-input input");

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
        "Changed Location from " + oldLocation + " to " + locationName + "\n", colour.green
      );

      // Ensure location is saved before moving on
      await page.waitForTimeout(2000);

      // Success - exit the retry loop
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        // All retries exhausted
        logError("Location selection failed after all retries - Using default location instead");
        return;
      }
      logWarn(`Store location selection failed, retry ${attempt + 1}/${maxRetries} in 5s..`);
      await delay(retryDelay);
    }
  }
}


// routePlaywrightExclusions()
// ---------------------------
// Excludes ads, tracking, and bandwidth intensive resources from being downloaded by Playwright

export async function routePlaywrightExclusions(page: Page) {
  const typeExclusions = ["image", "media", "font"];
  const urlExclusions = [
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

    urlExclusions.forEach((excludedURL) => {
      if (req.url().includes(excludedURL)) excludeThisRequest = true;
    });

    typeExclusions.forEach((excludedType) => {
      if (req.resourceType() === excludedType) excludeThisRequest = true;
    });

    if (excludeThisRequest) {
      await route.abort();
    } else {
      await route.continue();
    }
  });
}