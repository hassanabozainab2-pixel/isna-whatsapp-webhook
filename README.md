# Isna WhatsApp Webhook

A small Node.js webhook service for the دليل إسنا للخدمات directory.

## Current scope
- Meta WhatsApp Cloud API webhook verification (GET /webhook).
- Validates Meta X-Hub-Signature-256 before processing POST /webhook.
- Sends Arabic text replies through WhatsApp Cloud API.
- Reads categories, areas, and published business listings from the existing Supabase project.
- Health endpoint: GET /health.

## Deploy on Render
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`
- Branch: `main`

## Required Render environment variables
Copy the names from `.env.example` and set real values in Render's Environment page:
- `META_VERIFY_TOKEN`: a long random string you choose; use the same value in Meta webhook configuration.
- `META_APP_SECRET`: Meta app secret, used to validate webhook signatures.
- `WHATSAPP_TOKEN`: WhatsApp Cloud API access token.
- `WHATSAPP_PHONE_NUMBER_ID`: the WhatsApp phone number ID from Meta.
- `WHATSAPP_API_VERSION`: supported Graph API version (default in code: v23.0).
- `SUPABASE_URL`: URL of the existing Isna Supabase project.
- `SUPABASE_SERVICE_ROLE_KEY`: service-role key for server-side access only. Never put it in frontend code or commit it to GitHub.

## Meta webhook configuration
After deployment, set callback URL to:
`https://YOUR-RENDER-SERVICE.onrender.com/webhook`
Subscribe to the `messages` webhook field and use the exact `META_VERIFY_TOKEN` configured above.

## Important
The service is not live until deployed, all secrets are configured, Meta verifies the callback, and an end-to-end message test succeeds. Never commit real tokens or secrets. The current reply logic is a starter; before public launch, add persistent message deduplication, rate limiting, inquiry capture/human handoff, and stronger Arabic intent matching.
