# Cloudflare background removal for SBF

A ~50-line Cloudflare Worker that removes the background of a product image with
[Cloudflare Images](https://developers.cloudflare.com/images/) `segment: 'foreground'`,
which runs the open-source BiRefNet model on Workers AI. SBF calls it from the product
form when the **BiRefNet (Cloudflare)** method is enabled.

Why a Worker and not a plain image-transformation URL: SBF sends the bytes of an uploaded
file, which Cloudflare cannot fetch from a URL, and the Worker keeps the endpoint behind a
token.

## Deploy

```bash
cd integrations/cloudflare-background-removal
npx wrangler login
npx wrangler secret put SBF_TOKEN   # paste a long random string, e.g. `openssl rand -hex 32`
npx wrangler deploy
```

Then set in the SBF `.env`:

```dotenv
PRODUCT_IMAGE_CLOUDFLARE_URL=https://sbf-background-removal.<your-subdomain>.workers.dev
PRODUCT_IMAGE_CLOUDFLARE_TOKEN=<the same SBF_TOKEN>
```

and restart the app. The method appears in the product form's **Background** menu, and
**Remove automatically** tries it first.

## Cost

Each call is one Cloudflare Images transformation. The Free plan includes 5,000 unique
transformations a month; a fridge adds a handful of products a month, so it stays free.
Background removal was an open beta when this was written — check the current terms.

## Test

```bash
curl -sS -X POST --data-binary @product.jpg \
  -H "Authorization: Bearer $SBF_TOKEN" \
  https://sbf-background-removal.<your-subdomain>.workers.dev -o cut.png
```
