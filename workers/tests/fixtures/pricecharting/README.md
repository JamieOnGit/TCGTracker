# PriceCharting fixtures (SYNTHETIC)

Shapes follow https://www.pricecharting.com/api-documentation (docs/research/07 §D):
CSV columns are the API key names, CSV prices are USD decimals, API prices are
integer US cents, ids are strings. The ids, console and product names come from
`docs/research/sample-20-cards.json`. **Every price is made up.** PriceCharting
data is licensed for internal use only, so no real values are stored here.

| File | Shape |
|---|---|
| `price-guide-pokemon-cards.csv` | Daily CSV for `category=pokemon-cards` (includes a Chinese console, a sealed product with no `#number`, an empty price and a `$1,234.00` formatted price) |
| `price-guide-one-piece-cards.csv` | Daily CSV for `category=one-piece-cards` (includes a Carddass console, which must be excluded) |
| `api-product-6235917.json` | `/api/product?id=6235917` |
| `api-products-search.json` | `/api/products?q=...` (up to 20 rows) |
