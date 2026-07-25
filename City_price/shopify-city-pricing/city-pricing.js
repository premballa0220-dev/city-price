
(function () {
  const COOKIE_NAME = 'selected_city';
  const STORAGE_KEY = 'selected_city';
  const STORE_DOMAIN = 'vuprke-tx.myshopify.com';
  const API_VERSION = '2026-04';
  const STOREFRONT_TOKEN = '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';
  const BACKEND_URL = 'https://city-price-28l04sh1g-premballa0220-3300s-projects.vercel.app/';
  const CITY_LABELS = { mumbai: 'Mumbai', delhi: 'Delhi', silvassa: 'Silvassa' };

  let selectedCity = readCity();

  function readCity() {
    const cookieValue = document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${COOKIE_NAME}=`));
    const cookieCity = cookieValue ? decodeURIComponent(cookieValue.split('=').slice(1).join('=')) : '';
    const storageCity = window.localStorage.getItem(STORAGE_KEY) || '';
    return cookieCity || storageCity || '';
  }

  function setCity(city) {
    selectedCity = city;
    document.cookie = `${COOKIE_NAME}=${city}; max-age=2592000; path=/`;
    window.localStorage.setItem(STORAGE_KEY, city);
    updateHeaderIndicator();
    replacePrices();
  }

  function clearCity() {
    selectedCity = '';
    document.cookie = `${COOKIE_NAME}=; max-age=0; path=/`;
    window.localStorage.removeItem(STORAGE_KEY);
    updateHeaderIndicator();
    replacePrices();
  }

  function showToast(message) {
    let toast = document.getElementById('city-pricing-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'city-pricing-toast';
      toast.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:999999;background:#111827;color:#fff;padding:12px 16px;border-radius:8px;box-shadow:0 10px 20px rgba(0,0,0,.2);';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => {
      toast.style.opacity = '0';
    }, 2500);
  }

  function createModal() {
    if (document.getElementById('city-pricing-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'city-pricing-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.85);display:flex;align-items:center;justify-content:center;z-index:999999;padding:24px;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:16px;max-width:560px;width:100%;padding:24px 24px 28px;text-align:center;color:#111827;';

    const title = document.createElement('h2');
    title.textContent = 'Select Your City to View Prices';
    title.style.cssText = 'margin:0 0 16px;font-size:24px;';

    const options = document.createElement('div');
    options.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;';

    ['mumbai', 'delhi', 'silvassa'].forEach((city) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = CITY_LABELS[city];
      button.style.cssText = 'padding:16px;border:1px solid #d1d5db;border-radius:12px;background:#f9fafb;cursor:pointer;font-size:16px;font-weight:600;';
      button.addEventListener('click', () => {
        setCity(city);
        closeModal();
      });
      options.appendChild(button);
    });

    box.appendChild(title);
    box.appendChild(options);
    modal.appendChild(box);
    document.body.appendChild(modal);

    return modal;
  }

  function closeModal() {
    const modal = document.getElementById('city-pricing-modal');
    if (modal) modal.remove();
  }

  function updateHeaderIndicator() {
    let indicator = document.getElementById('city-pricing-header');
    if (!indicator) {
      const header = document.querySelector('header') || document.body;
      indicator = document.createElement('div');
      indicator.id = 'city-pricing-header';
      indicator.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid #e5e7eb;border-radius:999px;background:#fff;margin:10px 0;font-size:14px;';
      header.insertBefore(indicator, header.firstChild);
    }

    if (selectedCity) {
      indicator.innerHTML = `📍 ${CITY_LABELS[selectedCity]} <button type="button" id="city-pricing-change" style="background:none;border:none;color:#2563eb;padding:0;font:inherit;cursor:pointer;">Change</button>`;
      document.getElementById('city-pricing-change').addEventListener('click', () => {
        clearCity();
        fetch('/cart/clear.js', { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } }).catch(() => {});
        showToast('City changed. Please re-add items for correct pricing.');
        showModal();
      });
    } else {
      indicator.innerHTML = '📍 Select city';
    }
  }

  function showModal() {
    if (!selectedCity) {
      createModal();
    }
  }

  function getVisibleVariantContainers() {
    const containers = [];
    const seen = new Set();

    document.querySelectorAll('form[action*="/cart/add"], .product-card, .product, .card, .grid-product__content, .cart__row, .cart-item, [data-variant-id], [data-product-variant-id]').forEach((container) => {
      const variantId = container.querySelector('input[name="id"], select[name="id"]')?.value || container.getAttribute('data-variant-id') || container.getAttribute('data-product-variant-id') || container.dataset.variantId || container.dataset.productVariantId;
      if (!variantId || seen.has(variantId)) return;
      seen.add(variantId);
      containers.push({ variantId, container });
    });

    return containers;
  }

  function findPriceTarget(container) {
    const selectors = ['.price', '.price__regular', '.price-item', '.product__price', '[data-product-price]'];
    for (const selector of selectors) {
      const element = container.querySelector(selector);
      if (element) return element;
    }
    return container;
  }

  function getVariantIdFromContainer(container) {
    // common inputs/selects
    const inputId = container.querySelector('input[name="id"], select[name="id"], input[name="id[]"]')?.value;
    if (inputId) return inputId;

    // data attributes on the container or descendants
    const dataAttrs = ['data-variant-id', 'data-product-variant-id', 'data-product-id', 'data-id', 'data-variant', 'data-product-variant-id'];
    for (const attr of dataAttrs) {
      const attrVal = container.getAttribute(attr) || container.querySelector(`[${attr}]`)?.getAttribute(attr);
      if (attrVal) return attrVal;
    }

    // look for any element with data-variant-id deeper
    const deep = container.querySelector('[data-variant-id], [data-product-variant-id], [data-id], [data-product-id]');
    if (deep) {
      return deep.getAttribute('data-variant-id') || deep.getAttribute('data-product-variant-id') || deep.getAttribute('data-id') || deep.getAttribute('data-product-id');
    }

    // try to parse form action query parameters like ?id=123
    const form = container.closest('form');
    if (form && form.action) {
      try {
        const url = new URL(form.action, location.origin);
        const idParam = url.searchParams.get('id') || url.searchParams.get('variant');
        if (idParam) return idParam;
      } catch (e) {
        // ignore
      }
    }

    return null;
  }

  function addSkeleton(element) {
    if (element.dataset.cityPriceSkeleton === 'true') return;
    element.dataset.cityPriceSkeleton = 'true';
    element.dataset.originalText = element.textContent;
    element.style.display = 'inline-block';
    element.style.minHeight = '1.2em';
    element.style.width = '5rem';
    element.style.background = '#e5e7eb';
    element.style.borderRadius = '4px';
    element.style.color = 'transparent';
    element.textContent = '';
  }

  function removeSkeleton(element) {
    element.dataset.cityPriceSkeleton = 'false';
    element.style.background = '';
    element.style.borderRadius = '';
    element.style.color = '';
    element.style.width = '';
    element.style.minHeight = '';
    element.style.display = '';
  }

  function formatRupees(value) {
    return `₹${Number(value).toLocaleString('en-IN')}`;
  }

  async function replacePrices() {
    const priceTargets = getVisibleVariantContainers();
    const allTargets = priceTargets.map(({ container }) => ({ target: findPriceTarget(container), variantId: getVariantIdFromContainer(container) }));

    if (!selectedCity) {
      allTargets.forEach(({ target }) => {
        if (target) {
          target.textContent = 'Select your city to view price';
        }
      });
      return;
    }

    allTargets.forEach(({ target }) => {
      if (target) addSkeleton(target);
    });

    const uniqueVariantIds = [...new Set(allTargets.map(({ variantId }) => {
      if (!variantId) return null;
      return variantId.startsWith('gid://')
        ? variantId
        : `gid://shopify/ProductVariant/${variantId}`;
    }).filter(Boolean))];

    if (!uniqueVariantIds.length) {
      // nothing to query — keep existing prices or show request
      console.debug('city-pricing: no variant ids found in visible containers', allTargets);
      allTargets.forEach(({ target }) => {
        if (target) {
          removeSkeleton(target);
          target.textContent = 'Price on request';
        }
      });
      return;
    }

    try {
      const response = await fetch(`https://${STORE_DOMAIN}/api/${API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query ($ids: [ID!]!) {
              nodes(ids: $ids) {
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
          variables: { ids: uniqueVariantIds },
        }),
      });

      const data = await response.json();
      console.debug('city-pricing: storefront nodes response', data);
      const priceMap = {};
      (data?.data?.nodes || []).forEach((node) => {
        const gid = node?.id;
        const metafieldValue = node?.metafield?.value;
        let cityPrice;
        if (metafieldValue) {
          try {
            const parsed = JSON.parse(metafieldValue);
            if (typeof parsed[selectedCity] === 'number') {
              cityPrice = parsed[selectedCity];
            }
          } catch (err) {
            // ignore invalid JSON
          }
        }

        const defaultPriceRaw = node?.priceV2?.amount;
        const defaultPrice = defaultPriceRaw ? Number(defaultPriceRaw) : null;

        priceMap[gid] = { cityPrice: typeof cityPrice === 'number' ? cityPrice : null, defaultPrice };
      });

      allTargets.forEach(({ target, variantId }) => {
        removeSkeleton(target);
        const gid = variantId && variantId.startsWith('gid://')
          ? variantId
          : variantId
            ? `gid://shopify/ProductVariant/${variantId}`
            : null;

        const entry = gid ? priceMap[gid] : null;
        const displayPrice = entry?.cityPrice ?? entry?.defaultPrice ?? null;

        if (typeof displayPrice === 'number' && !Number.isNaN(displayPrice)) {
          target.textContent = formatRupees(displayPrice);
        } else if (entry && entry.defaultPrice == null) {
          // We had a variant but no price information at all
          target.textContent = 'Price on request';
        } else {
          // No variant or fallback
          target.textContent = 'Price on request';
        }
      });
    } catch (error) {
      allTargets.forEach(({ target }) => {
        removeSkeleton(target);
        target.textContent = 'Price on request';
      });
    }
  }

  function handleAddToCart(event) {
    const form = event.target;
    if (!form.matches('form[action*="/cart/add"]')) return;

    if (!selectedCity) {
      event.preventDefault();
      alert('Please select your city first');
      return;
    }

    event.preventDefault();

    const formData = new FormData(form);
    fetch(form.action, {
      method: 'POST',
      body: formData,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then((response) => response.text())
      .then(() => fetch('/cart/update.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ attributes: { city: selectedCity } }),
      }))
      .then(() => {
        document.dispatchEvent(new CustomEvent('cart:updated'));
        document.dispatchEvent(new CustomEvent('theme:cart:add'));
      })
      .catch(() => {});
  }

  function handleCheckout(event) {
    const target = event.target.closest('[name="checkout"], a[href="/checkout"], #checkout, .cart__checkout');
    if (!target) return;

    event.preventDefault();

    if (!selectedCity) {
      alert('Please select your city first');
      return;
    }

    // UX: disable checkout controls and show spinner
    const checkoutButtons = Array.from(document.querySelectorAll('[name="checkout"], a[href="/checkout"], #checkout, .cart__checkout'));
    checkoutButtons.forEach((b) => b.setAttribute('aria-disabled', 'true'));
    showToast('Creating draft order...');

    function cleanupUI() {
      checkoutButtons.forEach((b) => b.removeAttribute('aria-disabled'));
    }

    fetch('/cart.js', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then((response) => response.json())
      .then((cart) => {
        const payload = {
          city: selectedCity,
          customerId: window.__st?.cid || null,
          cart: (cart.items || []).map((item) => ({
            variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
            quantity: item.quantity,
          })),
        };

        return fetch(`${BACKEND_URL.replace(/\/$/, '')}/create-draft-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).then((res) => ({ res, payload }));
      })
      .then(async ({ res, payload }) => {
        let result = {};
        try {
          result = await res.json().catch(() => ({}));
        } catch (err) {
          // ignore
        }

        if (res.ok && result.invoiceUrl) {
          // success: redirect to invoice URL
          window.location.href = result.invoiceUrl;
          return;
        }

        // If draft creation failed, fallback to normal checkout but preserve attributes
        cleanupUI();
        showToast('Draft order creation failed — proceeding to checkout');

        // Ensure cart has city attribute set, then navigate to checkout
        await fetch('/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ attributes: { city: selectedCity } }),
        }).catch(() => {});

        window.location.href = '/checkout';
      })
      .catch((err) => {
        console.error('Checkout/draft order error', err);
        cleanupUI();
        showToast('Something went wrong. Redirecting to checkout.');
        // best-effort fallback
        fetch('/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ attributes: { city: selectedCity } }),
        }).catch(() => {}).finally(() => (window.location.href = '/checkout'));
      });
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateHeaderIndicator();
    if (!selectedCity) {
      showModal();
    }
    replacePrices();
    document.addEventListener('submit', handleAddToCart);
    document.addEventListener('click', handleCheckout);
  });

  window.addEventListener('load', () => {
    replacePrices();
  });

  // Debug helper: expose a method to fetch variant data from the storefront API for testing
  window.cityPricingDebug = {
    async fetchVariant(variantGid) {
      try {
        const ids = [variantGid.startsWith('gid://') ? variantGid : `gid://shopify/ProductVariant/${variantGid}`];
        const resp = await fetch(`https://${STORE_DOMAIN}/api/${API_VERSION}/graphql.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
          },
          body: JSON.stringify({
            query: `query ($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id metafield(namespace: "custom", key: "city_prices") { value } priceV2 { amount } } } }`,
            variables: { ids },
          }),
        });
        const data = await resp.json();
        console.log('cityPricingDebug.fetchVariant result:', data);
        return data;
      } catch (err) {
        console.error('cityPricingDebug.fetchVariant error', err);
        throw err;
      }
    },
  };
})();
