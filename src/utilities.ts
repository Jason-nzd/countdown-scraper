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
  const unitPriceString = product.unitPrice ? `$${product.unitPrice.toFixed(2)} /${product.unitName}` : ``;
  log(
    getAlternatingRowColour(colour.sky, colour.white),
    `${product.id.padStart(6)} | ${product.name.slice(0, 50).padEnd(50)} | ` +
    `${product.size?.slice(0, 17).padEnd(17)} | ` +
    `$ ${product.currentPrice.toFixed(2).padStart(4).padEnd(5)} | ` +
    unitPriceString
  );
}

// logTableHeader()
// ----------------

export function logTableHeader() {
  log(
    colour.yellow,
    `${'ID'.padStart(6)} | ${'Name'.padEnd(50)} | ` +
    `${'Size'.padEnd(17)} | ` +
    `${'Price'.padEnd(7)} | Unit Price`
  );

  let headerLine = ""
  for (let i = 0; i < 102; i++) {
    headerLine += "-"
  }
  log(colour.yellow, headerLine);

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

  // If over 60 secs, print as 1:23 format
  if (elapsedTimeSeconds >= 60) {
    return (
      Math.floor(elapsedTimeSeconds / 60) +
      ':' +
      Math.floor(elapsedTimeSeconds % 60)
        .toString()
        .padStart(2, '0')
    )
    // Else print in 40s format
  } else return elapsedTimeString + "s";
}

// addUnitPriceToProduct()
// -----------------------
// Derives unit quantity, unit name, and price per unit of a product,
// Returns an updated product

export function addUnitPriceToProduct(product: Product): Product {
  // Build an array of size and name split strings
  let nameAndSize: string[] = [product.name];
  const size = product.size?.toLowerCase();
  if (size) nameAndSize = nameAndSize.concat(size.split(' '));

  // Regex name and size to try match known units
  let foundUnits: string[] = [];
  nameAndSize!.forEach((section) => {
    // Try match digits \d , optional decimal \.\d+ , optional whitespace,
    //  and common unit names such as g kg l ml
    let tryMatchUnit = section.toLowerCase().match(/\d+(\.\d+)?\s?(g|kg|l|ml)\b/g);

    // If a new match is found, add to foundUnits array
    if (tryMatchUnit && !foundUnits.includes(tryMatchUnit[0])) {
      foundUnits.push(tryMatchUnit[0]);
    }
  });

  let quantity: number | undefined = undefined;
  let matchedUnit: string | undefined = undefined;

  // If size is simply 'kg' or includes 'per kg', process it as 1kg
  if (size === 'kg' || size?.includes('per kg')) {
    quantity = 1;
    matchedUnit = 'kg';
  } else if (foundUnits.length > 0) {
    // Quantity is derived from product name or size, 450ml = 450
    quantity = parseFloat(foundUnits[0].match(/\d|\./g)?.join('') as string);

    // MatchedUnit,  450ml = ml
    matchedUnit = foundUnits[0].match(/(g|kg|l|ml)/g)?.join('') as string;

    // If 2 units were matched, such as '4 x 12g packs 48g', use the greater 48g
    if (foundUnits.length === 2) {
      quantity = parseFloat(foundUnits[0].match(/\d|\./g)?.join('') as string);
      const secondQuantity = parseFloat(foundUnits[1].match(/\d|\./g)?.join('') as string);
      if (secondQuantity > quantity) {
        quantity = secondQuantity;
        matchedUnit = foundUnits[1].match(/\D/g)?.join('') as string;
      }
    } else {
      // Handle edge case where size contains a 'multiplier x sub-unit' - eg. 4 x 107mL
      const matchMultipliedSizeString = size?.match(/\d+\s?x\s?\d+/g)?.join('');
      if (matchMultipliedSizeString) {
        const splitMultipliedSize = matchMultipliedSizeString.split('x');
        const multiplier = parseInt(splitMultipliedSize[0].trim());
        const subUnitSize = parseInt(splitMultipliedSize[1].trim());
        quantity = multiplier * subUnitSize;
      }

      // Handle edge case for drink cans in format '330ml cans 30pack'
      const matchCanString = size?.match(/\d+(ml)\s?cans\s?\d+pack/g)?.join('');
      if (matchCanString) {
        const canSize = parseInt(matchCanString.match(/\d+(ml)/g)?.join() as string);
        const canQuantity = parseInt(matchCanString.match(/\d+(pack)/g)?.join() as string);
        quantity = canSize * canQuantity;
      }

      // Handle edge cases for format '500g 5pack', which are inconsistent
      const matchNoMultiplierString = size?.match(/\d+(g|ml)\s\d+pack/g)?.join('');
      if (matchNoMultiplierString) {
        const packSizeOnly = parseInt(
          matchNoMultiplierString.match(/\d+(g|ml)/g)?.join() as string
        );
        const multiplier = parseInt(matchNoMultiplierString.match(/\d+(pack)/g)?.join() as string);

        // The weight for small pack quantity is usually not multiplied
        //  - '100g 6pack' would usually have an actual weight of 100g
        if (multiplier <= 6) {
          quantity = packSizeOnly;
        } else {
          // The weight for large pack quantity is usually multiplied
          //  - '100g 20pack' would usually have an actual weight of 2000g
          quantity = packSizeOnly * multiplier;
        }
      }

      // Handle edge case for format '85g pouches 12pack'
      // let numPack = size?.match(/\d+\s?pack/g)?.toString();
      // let packSize = size?.match(/\d+(g|kg|ml|l)/g)?.toString();
      // if (numPack && packSize) {
      //   let numPackInt = Number.parseInt(numPack.replace('pack', ''));
      //   let packSizeInt = Number.parseInt(packSize.match(/\d/g)!.join(''));
      //   quantity = numPackInt * packSizeInt;
      //   matchedUnit = packSize.match(/\D/g)!.join('').trim();
      // }
    }
  }

  if (matchedUnit && quantity) {
    // Store original unit quantity before it is normalized to 1kg / 1L
    product.originalUnitQuantity = quantity;

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
    if (quantity && quantity > 0 && quantity < 9999) {
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
  // freshCategory
  'eggs',
  'fruit',
  'fresh-vegetables',
  'salads-coleslaw',
  'bread',
  'bread-rolls',
  'specialty-bread',
  'bakery-cakes',
  'bakery-desserts',
  // chilledCategory
  'milk',
  'long-life-milk',
  'sour-cream',
  'cream',
  'yoghurt',
  'butter',
  'cheese',
  'cheese-slices',
  'salami',
  'other-deli-foods',
  // meatCategory
  'beef-lamb',
  'chicken',
  'ham',
  'bacon',
  'pork',
  'patties-meatballs',
  'sausages',
  'deli-meats',
  'meat-alternatives',
  'seafood',
  'salmon',
  // frozenCategory
  'ice-cream',
  'ice-blocks',
  'pastries-cheesecake',
  'frozen-chips',
  'frozen-vegetables',
  'frozen-fruit',
  'frozen-seafood',
  'pies-sausage-rolls',
  'pizza',
  'other-savouries',
  // pantryCategory
  'rice',
  'noodles',
  'pasta',
  'beans-spaghetti',
  'canned-fish',
  'canned-meat',
  'soup',
  'cereal',
  'spreads',
  'baking',
  'sauces',
  'oils-vinegars',
  'world-foods',
  // snacksCategory
  'chocolate',
  'boxed-chocolate',
  'chips',
  'crackers',
  'biscuits',
  'muesli-bars',
  'nuts-bulk-mix',
  'sweets-lollies',
  'other-snacks',
  // drinksCategory
  'black-tea',
  'green-tea',
  'herbal-tea',
  'drinking-chocolate',
  'coffee',
  'soft-drinks',
  'energy-drinks',
  'juice',
  // petsCategory
  'cat-food',
  'cat-treats',
  'dog-food',
  'dog-treats',
];
