import 'jest';
// jest.useFakeTimers();
import * as cheerio from 'cheerio';
import { playwrightElementToProduct } from '../src/index';
import { CategorisedUrl, Product } from '../src/typings';
import { addUnitPriceToProduct } from '../src/utilities';

// Sample input
const html = `
  <h3 id="prod123">Product Name fresh fruit</h3>
  <div class="product-meta">
    <p><span class="size">Large</p>
  `;

// Sample product
const juiceProduct: Product = {
  id: '12345',
  name: 'Orange Juice',
  size: '250ml',
  currentPrice: 4,
  lastUpdated: new Date('01-20-2023'),
  lastChecked: new Date('01-20-2023'),
  priceHistory: [],
  sourceSite: 'countdown.co.nz',
  category: ['juice'],
};

const $ = cheerio.load(html);
const productEntries = $('cdx-card a.product-entry');

describe('scraping', () => {
  // it('extract normal product titles', async () => {
  //   const result = playwrightElementToProduct(productEntries[0], ['test']);
  //   expect(result!.name).toBe('yes');
  // });

  it('per unit price is derived from quantity and size', async () => {
    const result = addUnitPriceToProduct(juiceProduct);
    expect(result.unitName).toBe('L');
    expect(result.unitPrice).toBe(16);
    expect(result.originalUnitQuantity).toBe(250);
  });
});
