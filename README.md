# Isna WhatsApp Webhook

Webhook for دليل إسنا للخدمات. The repository keeps the existing Node/Express implementation and includes a Cloudflare Workers runtime at `src/worker.js`.

## Recommended free deployment: Cloudflare Workers

Cloudflare Workers Free currently includes up to 100,000 requests/day. No paid Workers plan is needed for this expected webhook workload. Free-plan availability and limits can change; check the dashboard before confirming deployment.

### Deploy
1. Sign in to Cloudflare and open Workers & Pages.
2. Create a Worker named `isna-whatsapp-webhook`.
3. Deploy the contents of `src/worker.js` as the Worker entry point, or connect this GitHub repository and configure the build/deploy to use `wrangler.toml`.
4. Add the secrets below under Worker Settings > Variables and Secrets.
5. Deploy and test `/health`.

### Required secrets
- `META_VERIFY_TOKEN`: a long random value you choose; enter the same value in Meta webhook settings.
- `META_APP_SECRET`: Meta app secret.
- `WHATSAPP_TOKEN`: WhatsApp Cloud API access token.
- `WHATSAPP_PHONE_NUMBER_ID`: WhatsApp phone number ID.
- `SUPABASE_URL`: URL of the existing Isna Supabase project.
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service-role key. Store as a secret only; never commit it or expose it in browser code.

Optional variable:
- `WHATSAPP_API_VERSION`: defaults to `v23.0`.

### Meta webhook
After deployment, use:
- Callback URL: `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/webhook`
- Verify token: the exact `META_VERIFY_TOKEN` secret.
- Subscribe to the `messages` webhook field.

### Important
The Worker is not live until deployed, all secrets are configured, Meta verifies the callback, and a real end-to-end test succeeds. No real credentials belong in GitHub. The current search/reply logic is a starter and must be checked against the actual Supabase schema before public launch. Add durable message deduplication, rate limiting, inquiry capture and human handoff before scaling.
