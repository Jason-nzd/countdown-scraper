const playwright = require('playwright');
const cheerio = require('cheerio');
const _ = require('lodash');

// Countdown Scraper
// -----------------
// Scrapes pricing and other info from Countdown's website
//
// Countdown sample search results DOM (as of Jan-2023)
// ----------------------------------------------------
//   <container div>
//     a.product-entry
//         ...
//     a.product-entry
//         h3                 {title}
//         div.product-meta
//             product-price
//                 h3
//                     em     {price dollar section}
//                     span   {price cents section}
//             p
//                 span.size  {size eg. 400g}
//         div.productImage-container
//             figure
//                 picture
//                     img    {img}
//     a.product-entry
//         ...
//   </container div>

(async () => {
  // Create a playwright browser using webkit
  const browser = await playwright.webkit.launch({
    headless: true,
  });
  const page = await browser.newPage();

  // Open url
  await page.goto('https://www.countdown.co.nz/shop/browse/fridge-deli');

  // Array of products to be pushed into
  const products = [];

  // Load all dynamic html into Cheerio for easy DOM selection
  const html = await page.evaluate(() => document.body.innerHTML);
  const $ = cheerio.load(html);

  // Select all product cards
  const productCards = $('a.product-entry');

  // Loop through each product card and build a product object with the desired data fields
  productCards.each((productCard) => {
    const product = {};

    // Original title is all lower-case and needs to be made into start-case
    product.name = _.startCase($(productCard).find('h3').first().text().trim());

    // The price is originally displayed with dollars in an <em>, cents in a <span>,
    // and potentially a kg unit name inside the <span> for some meat products.
    // The 2 numbers are joined, parsed, and non-number chars are removed.
    product.price = Number(
      $(productCard).find('div.product-meta product-price h3 em').text().trim() +
        '.' +
        $(productCard)
          .find('div.product-meta product-price h3 span')
          .text()
          .trim()
          .replace(/\D/g, '')
    );

    // Product size may be blank
    product.size = $(productCard).find('div.product-meta p span.size').text().trim();

    product.image = $(productCard)
      .find('a.product-entry div.productImage-container figure picture img')
      .attr('src');

    product.lastUpdated = new Date().toDateString();

    product.sourceSite = 'Countdown';

    // Push the completed product into the products array
    products.push(product);
  });

  console.log(products);

  // Close playwright headless browser
  await browser.close();
})();
