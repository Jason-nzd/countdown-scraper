import { Product } from './typings';
import { readFileSync } from 'fs';

// Set widths for table log output
const tableIDWidth = 7
const tableNameWidth = 60;
const tableSizeWidth = 17;

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
    `${product.id.padStart(tableIDWidth)} | ` +
    `${product.name.slice(0, tableNameWidth).padEnd(tableNameWidth)} | ` +
    `${product.size?.slice(0, tableSizeWidth).padEnd(tableSizeWidth)} | ` +
    `$ ${product.currentPrice.toFixed(2).padStart(4).padEnd(5)} | ` +
    unitPriceString
  );
}

// logTableHeader()
// ----------------

export function logTableHeader() {
  log(
    colour.yellow,
    `${'ID'.padStart(tableIDWidth)} | ${'Name'.padEnd(tableNameWidth)} | ` +
    `${'Size'.padEnd(tableSizeWidth)} | ` +
    `${'Price'.padEnd(7)} | Unit Price`
  );

  let headerLine = ""
  for (let i = 0; i < 113; i++) {
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

// List of valid category names that scraped products should be put in
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

// toTitleCase()
// -------------
// Convert a string to title case

export function toTitleCase(str: string) {
  return str.replace(/\w\S*/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase();
  });
}