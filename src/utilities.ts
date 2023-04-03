import { Product } from './typings';
import { readFileSync } from 'fs';

export const colour = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[38;5;117m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  crimson: '\x1b[38m',
  grey: '\x1b[90m',
  orange: '\x1b[38;5;214m',
  sky: '\x1b[38;5;153m',
};

// log()
// -----
// Console log with specified colour

export function log(colour: string, text: string) {
  const clear = '\x1b[0m';
  console.log(`${colour}%s${clear}`, text);
}

// logError()
// ----------
// Shorthand function for logging with red colour

export function logError(text: string) {
  log(colour.red, text);
}

// logProductRow()
// ---------------
// Log a single product in one row, using alternating colours for readability.

export function logProductRow(product: Product) {
  const categories = product.category != undefined ? product.category?.join(', ') : '';
  const unitPriceString = product.unitPrice ? `$${product.unitPrice}/${product.unitName}` : ``;
  log(
    getAlternatingRowColour(colour.sky, colour.white),
    `${product.id.padStart(6)} | ${product.name.slice(0, 50).padEnd(50)} | ` +
      `${product.size?.slice(0, 16).padEnd(16)} | ` +
      `$ ${product.currentPrice.toString().padStart(4).padEnd(5)} | ` +
      unitPriceString
  );
}

// getAlternatingRowColour()
// -------------------------
// Takes 2 colours and flip-flops between them on each function call.
// Is used for printing tables with better readability.

let alternatingRowColour = false;
function getAlternatingRowColour(colourA: string, colourB: string) {
  alternatingRowColour = alternatingRowColour ? false : true;
  return alternatingRowColour ? colourA : colourB;
}

// readLinesFromTextFile()
// -----------------------
// Read from local text file containing one url per line, return as string array.

export function readLinesFromTextFile(filename: string): string[] {
  try {
    const file = readFileSync(filename, 'utf-8');
    const result = file.split(/\r?\n/).filter((line) => {
      if (line.trim().length > 0) return true;
      else return false;
    });
    return result;
  } catch (error) {
    throw 'Error reading ' + filename;
  }
}

// getTimeElapsedSince()
// ---------------------
// Get time difference in between startTime and now. Returns in 58s or 12:32 format.

export function getTimeElapsedSince(startTime: number): string {
  let elapsedTimeSeconds: number = (Date.now() - startTime) / 1000;
  let elapsedTimeString: string = Math.floor(elapsedTimeSeconds).toString();

  // If over 60 secs, print as 00:23 minute:seconds format
  if (elapsedTimeSeconds >= 60)
    elapsedTimeString =
      Math.floor(elapsedTimeSeconds / 60) +
      ':' +
      Math.floor(elapsedTimeSeconds % 60)
        .toString()
        .padStart(2, '0');

  return elapsedTimeString;
}

// addUnitPriceToProduct()
// -----------------------
// Derives unit quantity, unit name, and price per unit of a product,
// Returns an updated product

export function addUnitPriceToProduct(product: Product): Product {
  // Quantity will later be derived from product name or size, such as 450ml = 450
  let quantity: number | undefined = undefined;

  // MatchedUnit will be derived from product name or size, 450ml = ml
  let matchedUnit: string = '';

  // Build an array of size, name, and split size sections
  let sectionsToMatch = product.size?.split(/(\s+)/);
  sectionsToMatch!.push(product.size as string);
  sectionsToMatch!.push(product.name);

  // Regex each section of the array to try match known units
  let i = 0;
  while (i < sectionsToMatch!.length) {
    const section = sectionsToMatch![i++];
    const tryMatchUnit = section
      .toLowerCase()
      .match(/\g$|kg$|l$|ml$/g)
      ?.join('');

    const tryMatchDigits = section.match(/\d|\./g)?.join('');

    // If a match is found, break out of the while loop
    if (tryMatchUnit && tryMatchDigits) {
      matchedUnit = tryMatchUnit;
      quantity = parseFloat(tryMatchDigits);
      // console.log('  (' + section + ') = quantity(' + quantity + ') ' + matchedUnit);
      break;
    }
  }

  if (matchedUnit && quantity) {
    // Handle edge case where size contains a 'multiplier x sub-unit' - eg. 4 x 107mL
    let matchMultipliedSizeString = product.size?.match(/\d+\sx\s\d+$/g)?.join('');
    if (matchMultipliedSizeString) {
      const splitMultipliedSize = matchMultipliedSizeString.split('x');
      const multiplier = parseInt(splitMultipliedSize[0].trim());
      const subUnitSize = parseInt(splitMultipliedSize[1].trim());
      quantity = multiplier * subUnitSize;
    }

    // Handle edge case for format '85g pouches 12pack'
    let numPack = product.size?.match(/\d+pack/g)?.toString();
    let packSize = product.size?.match(/\d+g/g)?.toString();
    if (numPack && packSize) {
      let numPackInt = Number.parseInt(numPack.replace('pack', ''));
      let packSizeInt = Number.parseInt(packSize.replace('g', ''));
      quantity = numPackInt * packSizeInt;
      matchedUnit = 'g';
    }

    // Store original unit quantity before it is normalized to 1kg / 1L
    product.originalUnitQuantity = quantity;

    // If size is simply 'kg', process it as 1kg
    if (product.size === 'kg' || product.size === 'per kg') {
      quantity = 1;
      matchedUnit = 'kg';
    }

    // If units are in grams, convert to /kg
    if (quantity && matchedUnit === 'g') {
      quantity = quantity / 1000;
      matchedUnit = 'kg';
    }

    // If units are in mL, convert to /L
    if (quantity && matchedUnit === 'ml') {
      quantity = quantity / 1000;
      matchedUnit = 'L';
    }

    // Capitalize L for Litres
    if (quantity && matchedUnit === 'l') matchedUnit = 'L';

    // Parse to int and check is within reasonable range
    if (quantity && quantity > 0 && quantity < 999) {
      // Set per unit price, rounded to 2 decimal points
      product.unitPrice = Math.round((product.currentPrice / quantity) * 100) / 100;

      // Set unitName, such as 500g = g
      product.unitName = matchedUnit;
    }
  }

  // Return product whether unitPrice and unitName were set or not
  return product;
}

// List of valid category names that scraped products should be a part of
export const validCategories: string[] = [
  'frozen',
  'ice-cream',
  'pies-sausage-rolls',
  'frozen-pizza',
  'spring-rolls-other-savouries',
  'frozen-vegetables',
  'frozen-chips',
  'hash-browns',
  'frozen-meat',
  'frozen-meat-alternatives',
  'frozen-seafood',
  'frozen-fruit-drink',
  'milk',
  'standard-milk',
  'trim-milk',
  'enriched-milk',
  'flavoured-milk',
  'alternative-milk',
  'sour-cream',
  'cream',
  'long-life-milk',
  'butter-spreads',
  'cheese',
  'pizza',
  'yoghurt',
  'ham',
  'bacon',
  'salami',
  'deli-meats',
  'juice-drinks',
  'vegan-vegetarian',
  'heat-and-eat-meals',
  'soup-risotto',
  'dips-hummus-nibbles',
  'beef-lamb',
  'chicken',
  'pork',
  'mince-patties',
  'sausages',
  'fresh-fruit',
  'fresh-vegetables',
  'eggs',
  'chips',
  'corn-chips',
  'chocolate',
  'biscuits',
  'rice',
  'seafood',
  'salmon',
  'cat-food',
  'dry-cat-food',
  'wet-cat-food',
  'cat-treats',
];
