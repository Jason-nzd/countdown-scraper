import { describe, it, expect } from 'vitest';
import { parseAndCategoriseURL } from '../src/url-loader.js';

describe('parseAndCategoriseURL', () => {
  it('should return undefined for non-woolworths URLs', () => {
    expect(parseAndCategoriseURL('https://countdown.co.nz/shop/fruit')).toBeUndefined();
    expect(parseAndCategoriseURL('random text')).toBeUndefined();
    expect(parseAndCategoriseURL('')).toBeUndefined();
  });

  it('should parse regular browse URLs and add query parameters', () => {
    const result = parseAndCategoriseURL('woolworths.co.nz/shop/browse/fruit-veg/fruit');

    expect(result).toHaveLength(1);
    expect(result![0].url).toBe('https://woolworths.co.nz/shop/browse/fruit-veg/fruit?page=1&inStockProductsOnly=true');
    expect(result![0].category).toBe('fruit?page=1&inStockProductsOnly=true');
  });

  it('should parse URLs with https:// prefix', () => {
    const result = parseAndCategoriseURL('https://woolworths.co.nz/shop/browse/dairy/cheese');

    expect(result).toHaveLength(1);
    expect(result![0].url).toBe('https://woolworths.co.nz/shop/browse/dairy/cheese?page=1&inStockProductsOnly=true');
    expect(result![0].category).toBe('cheese?page=1&inStockProductsOnly=true');
  });

  it('should strip existing query parameters and add optimized ones', () => {
    const result = parseAndCategoriseURL('woolworths.co.nz/shop/browse/bakery/bread?sort=price');

    expect(result![0].url).toBe('woolworths.co.nz/shop/browse/bakery/bread?page=1&inStockProductsOnly=true');
  });

  it('should parse search URLs', () => {
    const result = parseAndCategoriseURL('woolworths.co.nz/shop/search?search=chocolate');

    expect(result).toHaveLength(1);
    expect(result![0].url).toContain('?search=chocolate');
    expect(result![0].url).toContain('&page=1&inStockProductsOnly=true');
    expect(result![0].category).toBe('=chocolat');
  });

  it('should override category when category= is specified', () => {
    const result = parseAndCategoriseURL('woolworths.co.nz/shop/browse/frozen/ice-cream category=ice-cream');

    expect(result![0].category).toBe('ice-cream');
  });

  it('should override category when categories= is specified', () => {
    const result = parseAndCategoriseURL('woolworths.co.nz/shop/browse/frozen/ice-cream categories=frozen-desserts');

    expect(result![0].category).toBe('frozen-desserts');
  });

  it('should duplicate URLs for pages= parameter', () => {
    const result = parseAndCategoriseURL('woolworths.co.nz/shop/browse/fruit-veg/fruit pages=3');

    expect(result).toHaveLength(3);
    expect(result![0].url).toContain('page=1');
    expect(result![1].url).toContain('page=2');
    expect(result![2].url).toContain('page=3');
    // Note: category is derived before page duplication, so all are the same
    expect(result![0].category).toBe('fruit?page=1&inStockProductsOnly=true');
    expect(result![1].category).toBe('fruit?page=1&inStockProductsOnly=true');
    expect(result![2].category).toBe('fruit?page=1&inStockProductsOnly=true');
  });

  it('should handle full URL with pages parameter', () => {
    const result = parseAndCategoriseURL('https://woolworths.co.nz/shop/browse/dairy/yogurt pages=2');

    expect(result).toHaveLength(2);
    expect(result![0].url).toBe('https://woolworths.co.nz/shop/browse/dairy/yogurt?page=1&inStockProductsOnly=true');
    expect(result![1].url).toBe('https://woolworths.co.nz/shop/browse/dairy/yogurt?page=2&inStockProductsOnly=true');
  });

  it('should handle search URL with pages parameter', () => {
    const result = parseAndCategoriseURL('woolworths.co.nz/shop/search?search=organic pages=2');

    expect(result).toHaveLength(2);
    expect(result![0].url).toContain('?search=organic');
    expect(result![0].url).toContain('&page=1');
    expect(result![1].url).toContain('&page=2');
  });

  it('should derive category from last URL section', () => {
    const result = parseAndCategoriseURL('woolworths.co.nz/shop/browse/meat-seafood/beef-lamb/beef-mince');

    expect(result![0].category).toBe('beef-mince?page=1&inStockProductsOnly=true');
  });

  it('should handle multiple arguments in one line', () => {
    const result = parseAndCategoriseURL('woolworths.co.nz/shop/browse/pantry/pasta-sauces category=pasta pages=4');

    expect(result).toHaveLength(4);
    expect(result![0].category).toBe('pasta');
    expect(result![0].url).toContain('page=1');
    expect(result![3].url).toContain('page=4');
  });
});
