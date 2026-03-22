import _ from "lodash";
import { CategorisedUrl } from "./typings.js";
import { readLinesFromTextFile } from "./utilities.js";

// loadUrlsFile
// ------------
// Loads and validates URLs from a txt file to be scraped.

export function loadUrlsFile(filePath: string = "src/urls.txt"): CategorisedUrl[] {
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
  let baseCategorisedURL: CategorisedUrl = { url: "", category: "" };
  let parsedUrls: CategorisedUrl[] = [];
  let numPagesPerURL = 1;

  // If line doesn't contain desired url section, return undefined
  if (!line.includes("woolworths.co.nz")) {
    return undefined;

  } else {
    // Split line into sections
    line.split(" ").forEach((section) => {

      // If line is a search url
      if (section.includes("?search=")) {
        baseCategorisedURL.url = section;

        // Ensure URL has http:// or https://
        if (!baseCategorisedURL.url.startsWith("http"))
          baseCategorisedURL.url = "https://" + section;

        // Add optimised query parameters,
        baseCategorisedURL.url += '&page=1&inStockProductsOnly=true';

        // Derive category from search term (can still be overridden)
        const searchTerm = section.slice(section.indexOf("="), section.indexOf("&page="))
        baseCategorisedURL.category = searchTerm
      }

      // If not a search url but a regular url
      else if (section.includes("woolworths.co.nz")) {
        baseCategorisedURL.url = section;

        // Ensure URL has http:// or https://
        if (!baseCategorisedURL.url.startsWith("http"))
          baseCategorisedURL.url = "https://" + section;

        if (section.includes("?")) {
          // Strip any existing query options off of URL
          baseCategorisedURL.url = section.substring(0, section.indexOf("?"));
        }
        // Replace query parameters with optimised ones,
        //  such as limiting to in-stock only,
        baseCategorisedURL.url += '?page=1&inStockProductsOnly=true';

        // If not a search url or regular url, try parse category
      } else if (section.includes("categories=") || section.includes("category=")) {
        baseCategorisedURL.category = section.split("=")[1];

        // If not a search url, regular url, or category, try parse number of pages
      } else if (section.startsWith("pages=")) {
        numPagesPerURL = Number.parseInt(section.split("=")[1]);
      }

      // If no category was specified, derive one from the last url /section
      if (baseCategorisedURL.category == "") {
        // Get all /sections/ from url
        const slashSections = baseCategorisedURL.url.split("/");

        // Set category to last url /section/
        baseCategorisedURL.category = slashSections[slashSections.length - 1];
      }
    });

    // For multiple pages, duplicate the url and edit the ?page=1 query parameter
    for (let i = 1; i <= numPagesPerURL; i++) {
      let pagedUrl = {
        url: baseCategorisedURL.url.replace("page=1", "page=" + i),
        category: baseCategorisedURL.category,
      }
      parsedUrls.push(pagedUrl);
    }
  }

  return parsedUrls;
}
