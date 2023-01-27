import { CategorisedUrl } from './typings';

// Array of default urls to scrape.
// Category is optional and may not be applicable if the page returns products from many categories
// Query options other than search terms should be excluded

export const defaultUrls: CategorisedUrl[] = [
  { url: 'https://www.countdown.co.nz/shop/browse/frozen', category: 'frozen' },
  {
    url: 'https://www.countdown.co.nz/shop/browse/frozen/ice-cream-sorbet/tubs',
    category: 'frozen',
  },
  {
    url: 'https://www.countdown.co.nz/shop/browse/frozen/frozen-meals-snacks/spring-rolls-toppers-savouries',
    category: 'frozen',
  },
  {
    url: 'https://www.countdown.co.nz/shop/browse/frozen/frozen-meals-snacks/dumplings-wontons-steam-buns',
    category: 'frozen',
  },
  { url: 'https://www.countdown.co.nz/shop/browse/fridge-deli', category: 'fridge-deli' },
  { url: 'https://www.countdown.co.nz/shop/browse/meat-poultry', category: 'meat-poultry' },
  { url: 'https://www.countdown.co.nz/shop/browse/fruit-veg', category: 'fruit-veg' },
  { url: 'https://www.countdown.co.nz/shop/browse/pantry', category: 'pantry' },
  { url: 'https://www.countdown.co.nz/shop/specials', category: '' },
];
