// Array of default urls to scrape.
export const defaultUrls = [
  // 'https://www.countdown.co.nz/shop/browse/frozen',
  // 'https://www.countdown.co.nz/shop/browse/frozen/ice-cream-sorbet/tubs',
  // 'https://www.countdown.co.nz/shop/browse/frozen/frozen-meals-snacks/spring-rolls-toppers-savouries',
  // 'https://www.countdown.co.nz/shop/browse/frozen/frozen-meals-snacks/dumplings-wontons-steam-buns',
  // 'https://www.countdown.co.nz/shop/browse/fridge-deli',
  // 'https://www.countdown.co.nz/shop/browse/meat-poultry',
  // 'https://www.countdown.co.nz/shop/browse/fruit-veg',
  // 'https://www.countdown.co.nz/shop/browse/pantry',
  // 'https://www.countdown.co.nz/shop/specials',
  // 'https://www.countdown.co.nz/shop/browse/pantry/snacks-sweets/chocolate-bars-blocks',
  // 'https://www.countdown.co.nz/shop/browse/fish-seafood/salmon',
  'https://www.countdown.co.nz/shop/browse/fridge-deli/milk-cream',
];

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
