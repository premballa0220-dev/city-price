// server.js
import express from 'express';
import cors from 'cors';

const app = express();

// FIX: restrict CORS to your actual storefront instead of allowing all
// origins — an open cors() lets any website call your draft-order endpoint.
app.use(cors({ origin: 'https://masonmart.in' }));
app.use(express.json());

// ── Config ──────────────────────────────────────────────────────────────
// FIX: this MUST be the *.myshopify.com domain, never the custom storefront
// domain (masonmart.in) or the admin.shopify.com URL. Neither of those
// serve the Admin API.
function normalizeShopifyDomain(value) {
  let domain = String(value || '').trim();
  domain = domain.replace(/^https?:\/\//i, '').replace(/\/+$|\?.*$/, '');
  if (domain.includes('admin.shopify.com/store/')) {
    const storeHandle = domain.split('admin.shopify.com/store/')[1]?.split('/')[0];
    if (storeHandle) domain = `${storeHandle}.myshopify.com`;
  }
  return domain;
}

const SHOPIFY_STORE_DOMAIN = normalizeShopifyDomain(
  process.env.SHOPIFY_STORE_DOMAIN || 'vuprke-tx.myshopify.com'
);
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

if (!SHOPIFY_STORE_DOMAIN.endsWith('.myshopify.com')) {
  throw new Error('Invalid SHOPIFY_STORE_DOMAIN. Expected format: store-name.myshopify.com');
}

const ADMIN_GRAPHQL_URL = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

function getAdminHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
  };
}

async function shopifyGraphQL(query, variables) {
  const response = await fetch(ADMIN_GRAPHQL_URL, {
    method: 'POST',
    headers: getAdminHeaders(),
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`Non-JSON response from Shopify (status ${response.status}): ${text.slice(0, 500)}`);
  }
  return { ok: response.ok, status: response.status, json };
}

// ── Helpers ─────────────────────────────────────────────────────────────
function normalizeCity(city) {
  return String(city || '').trim().toLowerCase();
}

function toVariantGid(value) {
  if (!value) return null;
  const id = String(value).trim();
  if (id.startsWith('gid://')) return id;
  if (/^\d+$/.test(id)) return `gid://shopify/ProductVariant/${id}`;
  return id;
}

function toCustomerGid(value) {
  if (!value) return null;
  const id = String(value).trim();
  if (id.startsWith('gid://')) return id;
  if (/^\d+$/.test(id)) return `gid://shopify/Customer/${id}`;
  return id;
}

// FIX: parses YOUR actual metafield shape — a single JSON blob at
// custom.city_prices, e.g. {"mumbai":1000,"delhi":1100,"silvassa":950} —
// not a separate metafield per city.
function resolveCityPrice(node, city) {
  if (!node) return null;
  const metafieldValue = node?.metafield?.value;
  if (metafieldValue) {
    try {
      const parsed = JSON.parse(metafieldValue);
      const normalized = {};
      Object.entries(parsed || {}).forEach(([key, value]) => {
        normalized[String(key).trim().toLowerCase()] = value;
      });
      const rawPrice = normalized[city];
      if (typeof rawPrice === 'number') return rawPrice;
      if (typeof rawPrice === 'string' && rawPrice.trim() !== '') {
        const numeric = Number(rawPrice);
        if (!Number.isNaN(numeric)) return numeric;
      }
    } catch (err) {
      console.warn('Invalid custom.city_prices metafield JSON for variant', node.id, err);
    }
  }
  // Fall back to the variant's default price if no city-specific price is set
  const priceValue = node?.price;
  const defaultPrice = typeof priceValue === 'number' ? priceValue : Number(priceValue);
  return Number.isNaN(defaultPrice) ? null : defaultPrice;
}

// ── Routes ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.send('City price backend is running'));

// FIX: matches the ACTUAL payload your city-pricing.js sends:
//   { city, customerId, cart: [{ variantId, quantity }] }
// (not `cartItems` with plain numeric ids + a separate customer object —
// that shape was never being sent by your live frontend.)
app.post('/create-draft-order', async (req, res) => {
  const { city, customerId, cart } = req.body || {};
  const normalizedCity = normalizeCity(city);

  if (!normalizedCity || !Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ error: 'invalid_request', details: 'city and a non-empty cart array are required' });
  }

  if (!SHOPIFY_ADMIN_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'missing_shopify_credentials' });
  }

  const normalizedCart = cart.map((item) => ({
    variantId: toVariantGid(item?.variantId),
    quantity: Number(item?.quantity || 0),
  }));

  if (normalizedCart.some((item) => !item.variantId || item.quantity <= 0)) {
    return res.status(400).json({ error: 'invalid_cart_item', details: normalizedCart });
  }

  const uniqueVariantIds = [...new Set(normalizedCart.map((item) => item.variantId))];

  try {
    // 1. Look up each variant's city_prices metafield + default price
    const { ok, status, json: variantData } = await shopifyGraphQL(
      `
        query getVariantCityPrices($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              price
              metafield(namespace: "custom", key: "city_prices") {
                value
              }
            }
          }
        }
      `,
      { ids: uniqueVariantIds }
    );

    if (!ok) {
      return res.status(status).json({ error: 'shopify_variant_lookup_failed', details: variantData });
    }
    if (variantData.errors?.length) {
      return res.status(502).json({ error: 'shopify_variant_graphql_errors', errors: variantData.errors });
    }

    const nodes = variantData?.data?.nodes || [];
    const priceMap = {};
    nodes.forEach((node) => {
      if (!node?.id) return;
      const price = resolveCityPrice(node, normalizedCity);
      if (price != null) priceMap[node.id] = price;
    });

    const missingPrices = normalizedCart.filter((item) => priceMap[item.variantId] == null);
    if (missingPrices.length > 0) {
      return res.status(422).json({ error: 'price_not_found', variants: missingPrices.map((i) => i.variantId) });
    }

    // 2. Build line items with the resolved city price tied to each real variant
    const lineItems = normalizedCart.map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
      originalUnitPrice: priceMap[item.variantId].toFixed(2),
    }));

    // 3. Create the draft order via GraphQL (reliably overrides price per-line
    //    while still keeping the real variant reference, unlike REST which
    //    can silently ignore a custom price when variant_id is present)
    const draftInput = {
      lineItems,
      tags: [`city-${normalizedCity}`],
      note: `City: ${normalizedCity}`,
      useCustomerDefaultAddress: Boolean(customerId),
    };
    if (customerId) {
      draftInput.customerId = toCustomerGid(customerId);
    }

    const { ok: draftOk, status: draftStatus, json: draftData } = await shopifyGraphQL(
      `
        mutation draftOrderCreate($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder {
              id
              name
              invoiceUrl
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      { input: draftInput }
    );

    if (!draftOk) {
      return res.status(draftStatus).json({ error: 'shopify_draft_order_failed', details: draftData });
    }
    if (draftData.errors?.length) {
      return res.status(502).json({ error: 'shopify_draft_graphql_errors', errors: draftData.errors });
    }

    const result = draftData?.data?.draftOrderCreate;
    const userErrors = result?.userErrors || [];
    if (userErrors.length > 0) {
      return res.status(422).json({ error: 'draft_order_user_errors', errors: userErrors });
    }

    const draftOrder = result?.draftOrder;
    return res.json({
      success: true,
      invoiceUrl: draftOrder?.invoiceUrl || null,
      draftOrderId: draftOrder?.id || null,
      draftOrderName: draftOrder?.name || null,
    });
  } catch (error) {
    console.error('create-draft-order error', error);
    return res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

app.use((req, res) => res.status(404).json({ error: 'not_found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

const PORT = process.env.PORT || 3000;
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

export default app;
