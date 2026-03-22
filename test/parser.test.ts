import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as cheerio from 'cheerio';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { playwrightElementToProduct } from '../src/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the stripped sample page HTML
const samplePageHtml = fs.readFileSync(path.join(__dirname, 'sample-page-22-03-2026.html'), 'utf-8');

describe('playwrightElementToProduct - Real Page HTML', () => {
  it('should parse Boss Iced Coffee with special price and unit price', () => {
    const $ = cheerio.load(samplePageHtml);
    const element = $('#product-239021-title').closest('.product-entry').get(0);
    const product = playwrightElementToProduct(element, 'iced-coffee');

    expect(product).toBeDefined();
    expect(product!.id).toBe('239021');
    expect(product!.name).toBe('Boss Iced Coffee Caramel Latte Can');
    expect(product!.size).toBe('237ml');
    expect(product!.currentPrice).toBe(3.00);
    expect(product!.unitPrice).toBe('12.66/L');
    expect(product!.category).toBe('iced-coffee');
  });

  it('should parse So Good Oat Milk with special price', () => {
    const $ = cheerio.load(samplePageHtml);
    const element = $('#product-83273-title').closest('.product-entry').get(0);
    const product = playwrightElementToProduct(element, 'milk');

    expect(product).toBeDefined();
    expect(product!.id).toBe('83273');
    expect(product!.name).toBe('So Good Oat Milk Barista Edition Uht Carton');
    expect(product!.size).toBe('1L');
    expect(product!.currentPrice).toBe(3.50);
    expect(product!.unitPrice).toBe('3.5/L');
    expect(product!.category).toBe('milk');
  });

  it('should parse Bananas Yellow Loose with per kg pricing', () => {
    const $ = cheerio.load(samplePageHtml);
    const element = $('#product-133211-title').closest('.product-entry').get(0);
    const product = playwrightElementToProduct(element, 'fruit');

    expect(product).toBeDefined();
    expect(product!.id).toBe('133211');
    expect(product!.name).toBe('Bananas Yellow Loose');
    expect(product!.size).toBe('');
    expect(product!.currentPrice).toBe(3.50);
    expect(product!.unitPrice).toBe('3.5/kg');
    expect(product!.category).toBe('fruit');
  });

  it('should parse all products from the sample page', () => {
    const $ = cheerio.load(samplePageHtml);
    const productEntries = $('.product-entry').toArray();

    const products = productEntries.map((element) =>
      playwrightElementToProduct(element, 'test-category')
    ).filter((p): p is NonNullable<typeof p> => p !== undefined);

    expect(products).toHaveLength(3);

    // Verify all products have required fields
    products.forEach((product) => {
      expect(product.id).toBeDefined();
      expect(product.name).toBeDefined();
      expect(product.currentPrice).toBeDefined();
      expect(product.currentPrice).toBeGreaterThan(0);
      expect(product.category).toBe('test-category');
    });

    // Verify specific products were found
    const productIds = products.map((p) => p.id);
    expect(productIds).toContain('239021'); // Boss Iced Coffee
    expect(productIds).toContain('83273');  // So Good Oat Milk
    expect(productIds).toContain('133211'); // Bananas
  });

  it('should extract product with Was/Save pricing correctly', () => {
    const $ = cheerio.load(samplePageHtml);
    const element = $('#product-239021-title').closest('.product-entry').get(0);
    const product = playwrightElementToProduct(element, 'test');

    // Should use current price, not the "Was" price
    expect(product!.currentPrice).toBe(3.00);
    expect(product!.name).toContain('Boss');
  });
});
