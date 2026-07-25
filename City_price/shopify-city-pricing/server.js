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

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || '';
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || '';
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'vuprke-tx.myshopify.com';
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';
const PORT = Number(process.env.PORT || 3000);

function getShopifyBaseUrl() {
  return `https://${SHOPIFY_STORE_DOMAIN}`;
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

function extractShopifyId(value) {
  if (!value) return null;
  const match = String(value).match(/(\d+)$/);
  return match ? Number(match[1]) : value;
}

function buildCartSummary(cart) {
  return (cart || []).map((item) => `${item.variantId}:${item.quantity}`).join(',');
}

function createErrorResponse(res, statusCode, error, extra = {}) {
  return res.status(statusCode).json({ error, ...extra });
}

async function fetchVariantPrice(variantId, city) {
  // Query metafield and fallback priceV2 from Admin API
  const response = await fetch(`${getShopifyBaseUrl()}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: getAdminHeaders(),
    body: JSON.stringify({
      query: `
        query ($id: ID!) {
          node(id: $id) {
            ... on ProductVariant {
              id
              metafield(namespace: "custom", key: "city_prices") {
                value
              }
              priceV2 {
                amount
              }
            }
          }
        }
      `,
      variables: { id: variantId },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify metafield lookup failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const node = data?.data?.node;
  const metafieldValue = node?.metafield?.value;

  // Try to parse city price from metafield
  if (metafieldValue) {
    try {
      const parsed = JSON.parse(metafieldValue);
      const normalized = {};
      Object.entries(parsed || {}).forEach(([key, value]) => {
        normalized[normalizeCityKey(key)] = value;
      });
      const rawPrice = normalized[city];
      if (typeof rawPrice === 'number') {
        return { price: rawPrice };
      }
      if (typeof rawPrice === 'string' && rawPrice.trim() !== '') {
        const numeric = Number(rawPrice);
        if (!Number.isNaN(numeric)) {
          return { price: numeric };
        }
      }
    } catch (err) {
      // invalid JSON - fall through to fallback price
    }
  }

  // Fallback: use priceV2.amount if available
  const defaultPriceRaw = node?.priceV2?.amount;
  const defaultPrice = defaultPriceRaw ? Number(defaultPriceRaw) : null;
  if (defaultPrice != null && !Number.isNaN(defaultPrice)) {
    return { price: defaultPrice };
  }

  return { error: 'price_not_found', variantId };
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
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

  const lineItems = [];

  try {
    for (const item of cart) {
      const variantId = item?.variantId;
      const quantity = Number(item?.quantity || 0);

      if (!variantId || !quantity) {
        return createErrorResponse(res, 400, 'invalid_cart_item', { variantId: variantId || null });
      }

      const priceResult = await fetchVariantPrice(variantId, normalizedCity);
      if (priceResult.error) {
        return createErrorResponse(res, 422, 'price_not_found', { variantId });
      }

      lineItems.push({
        variant_id: extractShopifyId(variantId),
        quantity,
        price: String(priceResult.price),
      });
    }

    const draftOrderPayload = {
      draft_order: {
        line_items: lineItems,
        use_customer_default_address: Boolean(customerId),
        tags: `city-${normalizedCity}`,
        send_invoice: false,
      },
    };

    if (customerId) {
      draftOrderPayload.draft_order.customer = {
        id: extractShopifyId(customerId),
      };
    }

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] draft-order attempt city=${normalizedCity} cart=${buildCartSummary(cart)}`);

    const response = await fetch(`${getShopifyBaseUrl()}/admin/api/${SHOPIFY_API_VERSION}/draft_orders.json`, {
      method: 'POST',
      headers: getAdminHeaders(),
      body: JSON.stringify(draftOrderPayload),
    });

    const data = await response.json().catch(() => ({}));
    console.log('draft order response', { status: response.status, body: data });

    if (!response.ok) {
      return createErrorResponse(res, response.status, data?.error || 'draft_order_failed', {
        details: data?.errors || null,
      });
    }

    const invoiceUrl = data?.draft_order?.invoice_url || data?.draft_order?.status_url || null;
    res.json({
      invoiceUrl,
      statusUrl: data?.draft_order?.status_url || null,
      draftOrderId: data?.draft_order?.id || null,
      raw: data,
    });
  } catch (error) {
    console.error(error);
    return createErrorResponse(res, 500, 'internal_error');
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

module.exports = async function handler(req, res) {
  return new Promise((resolve, reject) => {
    app(req, res, (err) => {
      if (err) {
        console.error(err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'internal_error' }));
        }
        reject(err);
      } else {
        resolve();
      }
    });
  });
};
