import 'jest';
import { deriveCategoriesFromUrl } from '../src/index';

describe('Scraper', () => {
  it('deriveCategoriesFromUrl_correct_categories', async () => {
    const result = deriveCategoriesFromUrl(
      'https://www.countdown.co.nz/shop/browse/pantry/snacks-sweets/corn-chips-salsa'
    );
    expect(result).toBe(['snacks-sweets', 'corn-chips-salsa']);
  });
});
