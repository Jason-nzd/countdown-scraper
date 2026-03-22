import * as cheerio from "cheerio";
import _ from "lodash";
import { Product } from "./typings.js";
import { productOverrides } from "./product-overrides.js";
import { logError, toTitleCase } from "./utilities.js";

// playwrightElementToProduct()
// ----------------------------
// Takes a playwright html element for 'a.product-entry', builds and returns a Product

export function playwrightElementToProduct(
  element: any,
  category: string
): Product | undefined {
  const $ = cheerio.load(element);

  // Find the <h3> tag with an id containing "-title"
  // This holds the product ID, name and size
  let idNameSizeH3 = $(element).find("h3").filter((i, element) => {
    if ($(element).attr("id")?.includes("-title")) {
      return true
    } else return false;
  });

  let product: Product = {

    // ID
    // -------
    // Extract product ID from h3 id attribute, and remove non-numbers
    id: idNameSizeH3.attr("id")?.replace(/\D/g, "") as string,

    // Category
    category: category,  // already obtained from url/text file

    // These values will later be overwritten
    name: "",
    currentPrice: 0,
  };

  // Name & Size
  // ------------
  // Try to extract combined name and size from h3 tag inner text
  let rawNameAndSize = idNameSizeH3.text().trim();

  // Clean unnecessary words from titles
  rawNameAndSize = rawNameAndSize
    .toLowerCase()
    .replace("   ", " ")
    .replace("  ", " ")
    .replace("fresh fruit", "")
    .replace("fresh vegetable", "")
    .trim()
    ;

  // Try to regex match a size section such as:
  // 100g, 150ml, 16pack, 0.5-1.5kg, tray 1kg, etc
  let tryMatchSize =
    rawNameAndSize.match(/(tray\s\d+)|(\d+(\.\d+)?(\-\d+\.\d+)?\s?(g|kg|l|ml|pack))\b/g);

  if (!tryMatchSize) {
    // Capitalise and set name
    product.name = toTitleCase(rawNameAndSize);

    // No size was found in name, size can be derived from unit price later
    product.size = "";
  } else {
    // If a size was found, get the index to split the string into name and size
    let indexOfSizeSection = rawNameAndSize.indexOf(tryMatchSize[0]);

    // Capitalise and set name
    product.name = toTitleCase(rawNameAndSize.slice(0, indexOfSizeSection)).trim();

    // Clean up and set size
    let cleanedSize = rawNameAndSize.slice(indexOfSizeSection).trim();
    if (cleanedSize.match(/\d+l\b/)) {
      // Capitalise L for litres
      cleanedSize = cleanedSize.replace("l", "L");
    }
    cleanedSize.replace("tray", "Tray");
    product.size = cleanedSize;
  }

  // Price
  // ------
  // Is originally displayed with dollars in an <em>, cents in a <span>,
  // and potentially a kg unit name inside the <span> for some meat products.
  // The 2 numbers are joined, parsed, and non-number chars are removed.
  const dollarString: string = $(element)
    .find("product-price div h3 em")
    .text()
    .trim();
  let centString: string = $(element)
    .find("product-price div h3 span")
    .text()
    .trim();
  if (centString.includes("kg")) product.size = "per kg";
  centString = centString.replace(/\D/g, "");
  product.currentPrice = Number(dollarString + "." + centString);

  // Unit Price
  // -----------
  // Try to extract from span.cupPrice, ex: $2.52 / 100mL
  const rawUnitPrice = $(element).find("span.cupPrice").text().trim();

  if (rawUnitPrice) {
    // Extract and parse unit price, ex: 2.52
    const unitPriceString = rawUnitPrice.split("/")[0].replace("$", "").trim();
    let unitPrice = Number.parseFloat(unitPriceString);

    // Extract amount and unit, ex: 100mL
    const amountAndUnit = rawUnitPrice.split("/")[1].trim();

    // Parse amount, ex: 100
    let amount = Number.parseInt(amountAndUnit.match(/\d+/g)?.[0] || "");

    // Extract unit, ex: mL
    let unit = amountAndUnit.match(/\w+/g)?.[0] || ""

    // Normalize units to kg or L
    if (amountAndUnit == "100g") {
      amount = amount * 10;
      unitPrice = unitPrice * 10;
      unit = "kg";
    }
    else if (amountAndUnit == "100mL") {
      amount = amount * 10;
      unitPrice = unitPrice * 10;
      unit = "L";
    }

    // Cleanup 1kg to just kg
    unit = unit.replace("1kg", "kg");
    unit = unit.replace("1L", "L");

    // Set finalised unit price
    product.unitPrice = unitPrice + "/" + unit;
  }

  // Overrides
  // ----------
  // Check .ts file for manually overridden product data
  productOverrides.forEach((override) => {
    // First check if product ID has any overrides
    if (override.id === product.id) {
      // Check for size override
      if (override.size !== undefined) {
        product.size = override.size;
      }

      // Check for category override
      if (override.category !== undefined) {
        product.category = override.category;
      }
    }
  });

  // If product values pass validation, return product
  let validProduct = true;
  try {
    if (product.name.match(/\$\s\d+/)) validProduct = false;
    if (product.name.length < 4 || product.name.length > 100) validProduct = false;
    if (product.id.length < 2 || product.id.length > 20) validProduct = false;
    if (
      product.currentPrice <= 0 ||
      product.currentPrice === null ||
      product.currentPrice === undefined ||
      Number.isNaN(product.currentPrice) ||
      product.currentPrice > 999
    ) {
      validProduct = false;
    }
  } catch (error) {
    validProduct = false;
  }
  if (validProduct) return product
  else {
    logError(
      `  Unable to Scrape: ${product.id.padStart(6)} | ${product.name} | ` +
      `$${product.currentPrice}`
    );
    return undefined;
  }
}
