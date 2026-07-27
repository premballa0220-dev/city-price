const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://masonmart.in');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.urlencoded({ extended: true }));

const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'vuprke-tx.myshopify.com';
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';
const SHOPIFY_REQUEST_TIMEOUT_MS = Number(process.env.SHOPIFY_REQUEST_TIMEOUT_MS || 12000);
const PORT = Number(process.env.PORT || 3000);

function getShopifyUrl(path = 'graphql.json') {
  return `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/${path}`;
}

function getAdminHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
  };
}

function normalizeCity(city) {
  return String(city || '').trim().toLowerCase();
}

function normalizeCityKey(value) {
  return String(value || '').trim().toLowerCase();
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

function buildCartSummary(cart) {
  return (cart || []).map((item) => `${item.variantId}:${item.quantity}`).join(',');
}

function createErrorResponse(res, statusCode, error, extra = {}) {
  return res.status(statusCode).json({ error, ...extra });
}

async function shopifyRequest(body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHOPIFY_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(getShopifyUrl(), {
      method: 'POST',
      headers: getAdminHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseVariantPrice(node, city) {
  if (!node) return null;
  const metafieldValue = node?.metafield?.value;
  if (metafieldValue) {
    try {
      const parsed = JSON.parse(metafieldValue);
      const normalized = {};
      Object.entries(parsed || {}).forEach(([key, value]) => {
        normalized[normalizeCityKey(key)] = value;
      });
      const rawPrice = normalized[city];
      if (typeof rawPrice === 'number') return rawPrice;
      if (typeof rawPrice === 'string' && rawPrice.trim() !== '') {
        const numeric = Number(rawPrice);
        if (!Number.isNaN(numeric)) return numeric;
      }
    } catch (err) {
      console.warn('Invalid city_prices metafield JSON', err);
    }
  }

  const priceValue = node?.price;
  const defaultPrice = typeof priceValue === 'number' ? priceValue : Number(priceValue);
  return Number.isNaN(defaultPrice) ? null : defaultPrice;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/', (req, res) => {
  res.send('City price backend is running');
});

app.post('/create-draft-order', async (req, res) => {
  const { city, customerId, cart } = req.body || {};
  const normalizedCity = normalizeCity(city);

  if (!normalizedCity || !Array.isArray(cart) || cart.length === 0) {
    return createErrorResponse(res, 400, 'invalid_request');
  }

  if (!SHOPIFY_ADMIN_ACCESS_TOKEN || !SHOPIFY_STORE_DOMAIN) {
    return createErrorResponse(res, 500, 'missing_shopify_credentials');
  }

  const normalizedCart = cart.map((item) => ({
    variantId: toVariantGid(item?.variantId),
    quantity: Number(item?.quantity || 0),
  }));

  if (normalizedCart.some((item) => !item.variantId || item.quantity <= 0)) {
    return createErrorResponse(res, 400, 'invalid_cart_item');
  }

  const uniqueVariantIds = [...new Set(normalizedCart.map((item) => item.variantId))];

  try {
    const variantResponse = await shopifyRequest({
      query: `
        query ($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              metafield(namespace: "custom", key: "city_prices") {
                value
              }
              price
            }
          }
        }
      `,
      variables: { ids: uniqueVariantIds },
    });

    if (!variantResponse.ok) {
      const text = await variantResponse.text();
      return createErrorResponse(res, variantResponse.status, 'shopify_variant_lookup_failed', { details: text });
    }

    const variantData = await variantResponse.json();
    if (variantData.errors?.length) {
      return createErrorResponse(res, 502, 'shopify_variant_graphql_errors', { errors: variantData.errors });
    }

    const nodes = variantData?.data?.nodes || [];
    const priceMap = {};
    nodes.forEach((node) => {
      if (!node?.id) return;
      const price = parseVariantPrice(node, normalizedCity);
      if (price != null) {
        priceMap[node.id] = price;
      }
    });

    const missingPrices = normalizedCart.filter((item) => priceMap[item.variantId] == null);
    if (missingPrices.length > 0) {
      return createErrorResponse(res, 422, 'price_not_found', {
        variants: missingPrices.map((item) => item.variantId),
      });
    }

    const lineItems = normalizedCart.map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
      priceOverride: {
        amount: priceMap[item.variantId].toFixed(2),
        currencyCode: 'INR',
      },
    }));

    const draftMutation = `
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
    `;

    const draftInput = {
      lineItems,
      tags: [`city-${normalizedCity}`],
      useCustomerDefaultAddress: Boolean(customerId),
    };

    if (customerId) {
      draftInput.customerId = toCustomerGid(customerId);
    }

    const draftResponse = await shopifyRequest({
      query: draftMutation,
      variables: { input: draftInput },
    });

    const draftData = await draftResponse.json();
    if (!draftResponse.ok) {
      return createErrorResponse(res, draftResponse.status, 'shopify_draft_order_failed', { details: draftData });
    }

    if (draftData.errors?.length) {
      return createErrorResponse(res, 502, 'shopify_draft_graphql_errors', { errors: draftData.errors });
    }

    const result = draftData?.data?.draftOrderCreate;
    const userErrors = result?.userErrors || [];
    if (userErrors.length > 0) {
      return createErrorResponse(res, 422, 'draft_order_user_errors', { errors: userErrors });
    }

    const draftOrder = result?.draftOrder;
    return res.json({
      success: true,
      invoiceUrl: draftOrder?.invoiceUrl || null,
      draftOrderId: draftOrder?.id || null,
      draftOrderName: draftOrder?.name || null,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return createErrorResponse(res, 504, 'shopify_request_timeout');
    }
    console.error('create-draft-order error', error);
    return createErrorResponse(res, 500, 'internal_error', { message: error.message });
  }
});

app.use((req, res) => {
  createErrorResponse(res, 404, 'not_found');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;

