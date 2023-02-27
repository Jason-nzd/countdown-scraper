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

// Console log with specified colour, then clear colour
export function log(colour: string, text: string) {
  const clear = '\x1b[0m';
  console.log(`${colour}%s${clear}`, text);
}

// Log a single product in a one line row
export function logProductRow(product: Product) {
  console.log(`
    ${product.id.padStart(6)} | ${product.name.slice(0, 50).padEnd(50)} | ${product.size
    ?.slice(0, 16)
    .padEnd(16)} | $ ${product.currentPrice}
  `);
}

// Log a specific price change message,
//  coloured green for price reduction, red for price increase
export function logPriceChange(product: Product, newPrice: Number) {
  const priceIncreased = newPrice > product.currentPrice;
  log(
    priceIncreased ? colour.red : colour.green,
    'Price ' +
      (priceIncreased ? 'Increased: ' : 'Decreased: ') +
      product.name.slice(0, 47).padEnd(47) +
      ' - from $' +
      product.currentPrice +
      ' to $' +
      newPrice
  );
}
