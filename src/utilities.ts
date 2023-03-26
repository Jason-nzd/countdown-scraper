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

// Console log with specified colour, then clear colour
export function log(colour: string, text: string) {
  const clear = '\x1b[0m';
  console.log(`${colour}%s${clear}`, text);
}

// Shorthand function for logging with red colour
export function logError(text: string) {
  log(colour.red, text);
}

// Takes 2 colours and flip-flops between them on each function call
//  is used for printing tables with better readability
let alternatingRowColour = false;
function getAlternatingRowColour(colourA: string, colourB: string) {
  if (alternatingRowColour) alternatingRowColour = false;
  else if (!alternatingRowColour) alternatingRowColour = true;

  return alternatingRowColour ? colourA : colourB;
}

// Log a single product in one row, using alternating colours for readability
export function logProductRow(product: Product) {
  const categories = product.category != undefined ? product.category?.join(', ') : '';
  log(
    getAlternatingRowColour(colour.sky, colour.white),
    `${product.id.padStart(6)} | ${product.name.slice(0, 50).padEnd(50)} | ` +
      `${product.size?.slice(0, 16).padEnd(16)} | ` +
      `$ ${product.currentPrice.toString().padStart(4).padEnd(4)}`
  );
}

// readLinesFromTextFile()
// =======================
// Read from local text file containing one url per line
// Return as string array
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

export function getTimeElapsedSince(startTime: number): string {
  // Get time difference in between startTime and now in seconds
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
