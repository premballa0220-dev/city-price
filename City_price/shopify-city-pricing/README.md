# Shopify City-Based Dynamic Pricing

## What is included

- Express backend with a health check and draft order creation endpoint
- Shopify theme snippet for city selection, price replacement, cart attribute updates, and checkout override
- Railway-ready deployment files

## Files

- server.js: Express backend
- city-pricing.js: Shopify theme snippet
- package.json: Node dependencies and start script
- Procfile: Railway start command
- .env.example: environment variable template

## Backend setup

1. Copy .env.example to .env.
2. Fill in the Shopify values:
   - SHOPIFY_CLIENT_ID
   - SHOPIFY_CLIENT_SECRET
   - SHOPIFY_ADMIN_ACCESS_TOKEN
   - SHOPIFY_STORE_DOMAIN
   - SHOPIFY_API_VERSION
   - SHOPIFY_STOREFRONT_TOKEN
   - PORT
3. Install dependencies:
   - npm install
4. Start locally:
   - npm start
5. Verify health:
   - http://localhost:3000/health

## Theme integration

1. Place the file in your Shopify theme under Assets:
   - Assets/city-pricing.js
2. Add this before the closing body tag in theme.liquid:
   - <script src="{{ 'city-pricing.js' | asset_url }}" defer></script>
3. In city-pricing.js replace:
   - const STOREFRONT_TOKEN = 'YOUR_STOREFRONT_ACCESS_TOKEN';
   - with your Shopify Storefront access token.
4. In city-pricing.js replace:
   - const BACKEND_URL = 'https://your-railway-domain.up.railway.app';
   - with your Railway public URL or ngrok URL.

## Local testing with ngrok

1. Start the backend locally.
2. Run ngrok on port 3000:
   - ngrok http 3000
3. Copy the ngrok forwarding URL.
4. Update BACKEND_URL in city-pricing.js to the ngrok URL.
5. Test:
   - Open the storefront
   - Select a city
   - Verify prices update
   - Add a product to cart
   - Checkout and confirm the draft order flow

## Railway deployment

1. Create a new Railway project.
2. Connect the repository or upload the project folder.
3. Set the environment variables from .env.example in the Railway dashboard.
4. Deploy the service.
5. Copy the Railway public URL.
6. Update BACKEND_URL in city-pricing.js to the Railway URL.
7. Verify the health endpoint:
   - https://YOUR_RAILWAY_URL/health
