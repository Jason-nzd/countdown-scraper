import 'jest';
import { parseAndCategoriseURL } from '../src/index';

describe('Scraper', () => {
  it('parseAndCategoriseURL_correct_categories', async () => {
    const result = parseAndCategoriseURL(
      'https://www.countdown.co.nz/shop/browse/pantry/snacks-sweets/corn-chips-salsa'
    );
    expect(result).toBe(['snacks-sweets', 'corn-chips-salsa']);
  });
});
