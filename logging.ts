import { Product } from './typings';

export const colour = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  crimson: '\x1b[38m',
  grey: '\x1b[90m',
  orange: '\x1b[38;5;214m',
};

// Console log with specified colour, then clear colour with \x1b[0m
export function log(colour: string, text: string) {
  console.log(`${colour}%s\x1b[0m`, text);
}

// Log a specific price change message,
//  coloured green for price reduction, red for price increase
export function logPriceChange(product: Product, newPrice: Number) {
  let c = colour.white;
  if (newPrice > product.currentPrice) c = colour.red;
  else c = colour.green;
  log(
    c,
    'Price Updated: ' +
      product.name.slice(0, 40).padEnd(40, ' ') +
      ' - from $' +
      product.currentPrice +
      ' to $' +
      newPrice
  );
}
