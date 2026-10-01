# Product images

Every product image goes through the same pipeline before it is stored, so the shop and
the kiosk show a uniform catalogue without anyone editing pictures by hand.

## What the supplier does

The image is one tile on the left of the product form: the preview is also the drop zone,
and what it shows is what gets saved.

- **Pick a picture:** drop it on the tile, paste it (Ctrl+V — a copied image or a copied
  image link), click the tile or **Choose photo** (on a phone this offers the camera), or
  **From a link**. With a barcode, **Find** next to the barcode field lists pictures from
  [Open Food Facts] and offers the product name it knows; a click on a picture puts it in
  the tile. The new-product form starts with the cursor in the barcode field, so a scanner
  can type the code and press Enter.
- **Adjust:** ↺ / ↻ turn the result by a quarter; **No background / Keep background**
  switches background removal. **Doesn't look right?** offers *Remove white background only
  (faster)*, *Don't rotate* and *Try again*.
- **Edit form:** the tile shows the saved image (badge *Saved image*). The same adjustments
  work on it directly; **Restore original** discards the change, and nothing is replaced
  unless the supplier saves after a change (the form says so next to the save button).

The supplier never chooses a technology: background removal uses the methods in
`PRODUCT_IMAGE_BG_AUTO` (below). Processing takes 1–15 s; the tile shows a spinner meanwhile,
the save button waits, and a failed attempt keeps the last good picture.

Open Food Facts is crowd-sourced: pictures are often phone photos, so nothing from it is
applied without a click.

[Open Food Facts]: https://world.openfoodfacts.org

## Name, category, allergens and description

The barcode is where a new product starts. **Find** (or Enter in the barcode field)
looks the product up on Open Food Facts and:

- **fills the name** in the catalogue's style (`Snickers 50 g`) — only while the name is
  empty or still the previous suggestion; a typed name is never overwritten. The found name
  stays in the results as a chip: ✓ when it is in the name field, ⤓ to put it back;
- **pre-selects allergens** from what Open Food Facts lists for the product (EU-14 tags
  matched to the instance's allergen names). Allergens are a safety matter, so they are
  never guessed by a model — only taken from the product's record, and marked
  *From Open Food Facts — check the pack*;
- **suggests a category** with AI, when configured — only while no category is chosen.

With AI configured, **Suggest** next to the description writes one playful line in the
tone of the existing catalogue: the prompt carries 20 random descriptions of other
products as style examples, plus the product's Open Food Facts category and ingredients.
Asking again gives a different one. Filled fields say where their value came from until
the supplier edits them.

### Enabling AI suggestions

Any Azure OpenAI / Azure AI Foundry chat deployment works (tested with `gpt-5-mini`):

```bash
PRODUCT_AI_ENDPOINT=https://<resource>.cognitiveservices.azure.com
PRODUCT_AI_DEPLOYMENT=gpt-5-mini
# then one way to authenticate — first match wins:
PRODUCT_AI_API_KEY=<key>
# …or an Entra service principal with the "Cognitive Services OpenAI User" role:
PRODUCT_AI_TENANT_ID=<tenant>
PRODUCT_AI_CLIENT_ID=<app id>
PRODUCT_AI_CLIENT_SECRET=<secret>
# …or, for local testing only, a token from `az account get-access-token
# --resource https://cognitiveservices.azure.com` (valid for about an hour):
PRODUCT_AI_BEARER_TOKEN=<token>
```

Without these the **Suggest** button is not shown and no category is suggested; the name
and the allergens still come from Open Food Facts. What is sent: the product name, its
Open Food Facts category and ingredients, the instance's category names, and other
products' names and descriptions as examples — no personal data.

## The pipeline

1. **Decode** the image and apply its EXIF orientation (phone photos).
2. **Remove the background** with the selected method (below).
3. **Trim** to the visible content.
4. **Rotate** content that is at least 1.8× wider than tall by 90° counter-clockwise, so
   bars and wafers stand upright like cans (text reads bottom to top). Cups and other squat
   products are left alone. The supplier can force left/right or no rotation.
5. **Fit** onto a transparent 450×800 (9:16) canvas — the size the catalogue already used.
6. **Encode** as WebP (typically 30–80 kB instead of 300+ kB PNG).

The processing endpoint (`POST /supplier/products/image/process`) stores nothing; the form
submits the result like any upload.

## Background removal methods

| Method                     | Where it runs                                    | Good for                                         |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| **Remove automatically**   | first available of `PRODUCT_IMAGE_BG_AUTO`       | the default                                      |
| **Keep background**        | —                                                | images that should stay as they are              |
| **Plain background**       | in the app (flood fill, no model)                | e-shop pictures on white; instant                |
| **BiRefNet (own server)**  | optional `rembg` sidecar container               | photos; nothing leaves your server               |
| **BiRefNet (Cloudflare)**  | Cloudflare Images via a small Worker             | photos; no hardware needed, free tier            |

"Automatically" skips images that are already transparent, then tries
`PRODUCT_IMAGE_BG_AUTO` in order (default `cloudflare,rembg,flood`), skipping methods that
are not configured. A model that is down is skipped; if every configured method fails, the
supplier gets an error and can pick another method.

The plain-background fill cannot tell a white package from a white backdrop and may eat
into it — which is why the models come first when they are configured.

### Comparison (measured on real catalogue and Open Food Facts pictures)

| Model                   | Time / image, 4 modern cores | RAM peak | Quality on photos |
| ----------------------- | ---------------------------- | -------- | ----------------- |
| `u2netp`                | 0.1 s                        | 0.8 GB   | poor              |
| `isnet-general-use`     | 0.6 s                        | 1.8 GB   | poor              |
| `birefnet-general-lite` | 5 s                          | 12 GB    | good              |
| `birefnet-general`      | 9–10 s                       | 14 GB    | very good         |

An older 4-core Xeon (E5-2603 v3) is roughly 5× slower per core. The first request after
the sidecar starts also downloads (~1 GB) and loads the model, which takes a few minutes.
Cloudflare runs `birefnet-general` on GPUs.

## Enabling the local model (rembg sidecar)

```bash
# .env
PRODUCT_IMAGE_REMBG_URL=http://rembg:7000
PRODUCT_IMAGE_REMBG_MODEL=birefnet-general   # or birefnet-general-lite

docker compose --profile bg-removal up -d
```

The `rembg` service in `compose.yaml` runs the official
[`danielgatis/rembg`](https://github.com/danielgatis/rembg) image in server mode, one
request at a time, with the models cached in the `rembg_models` volume. It is only started
with the `bg-removal` profile. Give the host enough RAM for the chosen model (table above).
The sidecar does not need to be reachable from outside the compose network.

## Enabling Cloudflare

Deploy the Worker in
[`integrations/cloudflare-background-removal`](../integrations/cloudflare-background-removal/README.md)
and set:

```bash
PRODUCT_IMAGE_CLOUDFLARE_URL=https://sbf-background-removal.<subdomain>.workers.dev
PRODUCT_IMAGE_CLOUDFLARE_TOKEN=<shared secret>
```

Product images are then sent to your Cloudflare account for processing.

## Normalising the existing catalogue

Images uploaded before the pipeline existed can be brought in line once:

```bash
node ace products:normalize-images --dry-run            # report only
node ace products:normalize-images                      # trim, rotate, 450×800 WebP
node ace products:normalize-images --background=flood   # also remove plain backdrops
node ace products:normalize-images --ids=12,40          # selected products only
node ace products:normalize-images --exclude-ids=7,9    # leave these alone
node ace products:normalize-images --rotate=none        # reframe without rotating
```

The width rule also catches things that are not bars — plated food, an egg carton, a
wrapped sweet. Look at the `rotated` lines of a `--dry-run` and exclude what should stay
landscape. Images the supplier wants redone individually can be processed from the edit
form with **Process current image**.

The default `--background=none` changes only the framing. New files are written under new
names and the old files stay on disk, so a database restore undoes the run. Each change is
audit-logged as `product.updated` with `reason: products:normalize-images`.

## Security

- The link field downloads on the server. Only `http(s)` is accepted; addresses in private,
  loopback, link-local (cloud metadata), CGNAT and multicast ranges are refused. The check
  runs inside the socket's DNS lookup, so the address that is checked is the address that
  is connected to, and it is repeated for every redirect.
- Downloads are capped at 15 MB, must be served as `image/*` and must decode as an image.
- Only suppliers and admins can use the endpoints (`/supplier/*` middleware).

## Configuration reference

| Variable                              | Default                           | Description                                    |
| ------------------------------------- | --------------------------------- | ---------------------------------------------- |
| `PRODUCT_IMAGE_WIDTH` / `_HEIGHT`     | `450` / `800`                     | Output canvas                                  |
| `PRODUCT_IMAGE_ROTATE_MIN_RATIO`      | `1.8`                             | Width/height ratio from which content is rotated |
| `PRODUCT_IMAGE_ROTATE_DIRECTION`      | `ccw`                             | `ccw` (text bottom-to-top) or `cw`             |
| `PRODUCT_IMAGE_BG_AUTO`               | `cloudflare,rembg,flood`          | Order "automatically" tries                    |
| `PRODUCT_IMAGE_REMBG_URL`             | —                                 | rembg sidecar, e.g. `http://rembg:7000`        |
| `PRODUCT_IMAGE_REMBG_MODEL`           | `birefnet-general`                | Any rembg model name                           |
| `PRODUCT_IMAGE_REMBG_TIMEOUT_MS`      | `300000`                          | Covers the first, model-downloading request    |
| `PRODUCT_IMAGE_CLOUDFLARE_URL`        | —                                 | Background-removal Worker                      |
| `PRODUCT_IMAGE_CLOUDFLARE_TOKEN`      | —                                 | Shared bearer token (secret)                   |
| `PRODUCT_IMAGE_CLOUDFLARE_TIMEOUT_MS` | `60000`                           |                                                |
| `PRODUCT_IMAGE_OPENFOODFACTS_ENABLED` | `true`                            | Barcode lookup (sends only the barcode)        |
| `PRODUCT_IMAGE_OPENFOODFACTS_URL`     | `https://world.openfoodfacts.org` | API base URL                                   |
| `PRODUCT_AI_ENDPOINT`                 | —                                 | Azure OpenAI / Foundry endpoint; empty = off   |
| `PRODUCT_AI_DEPLOYMENT`               | `gpt-5-mini`                      | Chat deployment name                           |
| `PRODUCT_AI_API_VERSION`              | `2024-10-21`                      | Azure OpenAI API version                       |
| `PRODUCT_AI_API_KEY`                  | —                                 | Key auth (secret)                              |
| `PRODUCT_AI_TENANT_ID` / `_CLIENT_ID` / `_CLIENT_SECRET` | —              | Entra service principal auth (secret)          |
| `PRODUCT_AI_BEARER_TOKEN`             | —                                 | Static token, local testing only               |
