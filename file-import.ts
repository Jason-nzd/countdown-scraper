import { readFileSync } from 'fs';
import { colour, log } from './logging.js';

// Try to read file urls.txt for a list of URLs, one per line
// If the file is missing or returns empty, use the 2 sampleURLs instead
export const urlsFromFile = await readURLsFromOptionalFile();
const sampleURLs = [
  'https://www.countdown.co.nz/shop/browse/pantry/eggs',
  'https://www.countdown.co.nz/shop/browse/fish-seafood/salmon',
];
export const importedURLs = urlsFromFile.length > 0 ? urlsFromFile : sampleURLs;

// Tries to read from file urls.txt containing many urls with one url per line
async function readURLsFromOptionalFile() {
  let arrayOfUrls: string[] = [];

  try {
    const file = readFileSync('urls.txt', 'utf-8');
    const fileLines = file.split(/\r?\n/);

    fileLines.forEach((line) => {
      if (line.includes('.co.nz/')) arrayOfUrls.push(line);
    });

    return arrayOfUrls;
  } catch (error) {
    log(colour.yellow, 'urls.txt not found, scraping 2 sample URLs instead');
    return [];
  }
}

export function deriveCategoryFromUrl(url: string): string {
  // Derives category names from url, if any categories are available
  // www.domain.com/shop/browse/frozen/ice-cream-sorbet/tubs
  // returns 'frozen'

  // If url doesn't contain /browse/, return no category
  if (url.indexOf('/browse/') < 0) return '';

  const categoriesStartIndex = url.indexOf('/browse/');
  const categoriesEndIndex = url.lastIndexOf('/');
  const categoriesString = url.substring(categoriesStartIndex, categoriesEndIndex);

  const splitCategories = categoriesString.split('/').slice(2);

  return splitCategories[0];
}

export function setUrlOptions(url: string): string {
  let processedUrl = url;

  // Remove existing query options from url
  if (url.includes('?')) url.slice(0, url.indexOf('?') + 1);
  // www.domain.com/shop/browse/fish-seafood/salmon?search=&page=1&size=24&...
  // becomes
  // www.domain.com/shop/browse/fish-seafood/salmon

  // Add recommend query options, size=48 shows upto 48 products per page
  return processedUrl + '?page=1&size=48&inStockProductsOnly=true';
}
