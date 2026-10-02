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

## Contributing back to Open Food Facts

Open Food Facts is a free, crowd-sourced database, and Czech products are often missing
from it. Fridgora can give back what its suppliers already have in hand: the EAN, the name
and their own photo. It is off until the instance has an OFF account (below).

### What the supplier sees

Under the product fields, the form offers **Contribute to Open Food Facts**, with a line
saying exactly what will be sent. It is unchecked by default and shown only

- for a **public EAN** — in-store codes (prefixes 02, 04, 20–29), coupons, ISSN/ISBN
  numbers, outer-case GTIN-14 codes and codes with a wrong check digit name nothing outside
  the shop and are never sent;
- when there is **something left to send** — the edit form of a product whose barcode was
  shared before offers it again only after a new own photo is picked.

### What is sent

- **The EAN and the name**, when OFF does not know the product or has no name for it
  (as `product_name_cs`; a product we create gets Czech as its main language). A name
  already on OFF is never overwritten, and a barcode goes this way only once.
- **The supplier's own photo, twice:**
  - the **cut-out** — the background removed with the method the preview used, trimmed but
    not rotated or squeezed into the 9:16 canvas, on white, as JPEG at up to 2048 px;
  - the **original**, exactly as it was picked.

  The original helps OFF's text recognition (ingredients, nutrition), the cut-out anyone
  who needs a clean product picture. The cut-out becomes the front-of-pack picture only
  when the product has none on OFF yet; otherwise both are added as further pictures. With
  *Keep background* only the original goes.

A picture from a link or from the Open Food Facts results is never sent — it is not the
supplier's to license. Photos on OFF are published under CC BY-SA, which the form says.

### How it is sent

Saving the product never waits for OFF. The contribution is queued in the
`off_contributions` table, and the **scheduler** sends it within two minutes. The original
photo waits in the database, not under `storage/uploads`, so it is never reachable over
`/uploads`; it is deleted once sent or given up. A failed round is retried after 5, 10, 20,
40 and 80 minutes and continues where it stopped (nothing is uploaded twice); after six
rounds it is given up. A photo OFF already has, or rejects as too small or unreadable, is
skipped without failing the rest.

The audit log records the supplier's consent (*Shared with Open Food Facts*) and the
outcome (*Sent to Open Food Facts* / *Sending to Open Food Facts failed*, with the error).

Every request identifies the app (`app_name=Fridgora`, `app_version`) and carries an
`app_uuid` derived from `APP_KEY` and the supplier's id. OFF can then moderate a single
contributor without banning the whole instance, and learns nothing about who they are.

### Enabling it

1. **Create an account for the instance** — a dedicated one, never a personal one. OFF
   logs in with the **username**, not the e-mail address.
2. **Try it on the staging server first.** Staging has its own accounts: register at
   <https://world.openfoodfacts.net> (the site asks for the fixed login `off` / `off`
   first; Fridgora adds it to its requests automatically), then set:

   ```bash
   PRODUCT_IMAGE_OPENFOODFACTS_URL=https://world.openfoodfacts.net
   PRODUCT_IMAGE_OPENFOODFACTS_USER=<staging username>
   PRODUCT_IMAGE_OPENFOODFACTS_PASSWORD=<staging password>
   ```

   Restart **both** the app and the scheduler (`docker compose up -d`) — the form reads the
   variables in the app, the scheduler sends. Save a product with a real EAN and the box
   ticked; within two minutes it shows up on staging and in the audit log.

3. **Switch to production:** register at <https://world.openfoodfacts.org>, put that
   account in, and remove `PRODUCT_IMAGE_OPENFOODFACTS_URL` (or set it back to
   `https://world.openfoodfacts.org`). The barcode lookup uses the same server, so on
   staging it finds only what staging knows.

OFF also asks API users to introduce themselves through their
[API usage form](https://docs.google.com/forms/d/e/1FAIpQLSdIE3D8qvjC_zRJw1W8OmuHhsWJ_NSckiiniAHlfaVwUZCziQ/viewform)
— worth doing for a production instance.

To turn it off, empty the two account variables (or set
`PRODUCT_IMAGE_OPENFOODFACTS_ENABLED=false`, which also turns off the lookup) and restart.
The box disappears; contributions already queued stay in `off_contributions` and are sent
once it is enabled again.

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
- The Open Food Facts account is used only by the server; it never reaches the browser.
  Original photos queued for OFF live in the database until sent, so they are part of
  database backups for that time, but never of `/uploads`.

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
| `PRODUCT_IMAGE_OPENFOODFACTS_URL`     | `https://world.openfoodfacts.org` | API base URL, for lookups and contributions    |
| `PRODUCT_IMAGE_OPENFOODFACTS_USER`    | —                                 | Instance's OFF username; empty = no contributions |
| `PRODUCT_IMAGE_OPENFOODFACTS_PASSWORD` | —                                | Its password (secret)                          |
| `PRODUCT_AI_ENDPOINT`                 | —                                 | Azure OpenAI / Foundry endpoint; empty = off   |
| `PRODUCT_AI_DEPLOYMENT`               | `gpt-5-mini`                      | Chat deployment name                           |
| `PRODUCT_AI_API_VERSION`              | `2024-10-21`                      | Azure OpenAI API version                       |
| `PRODUCT_AI_API_KEY`                  | —                                 | Key auth (secret)                              |
| `PRODUCT_AI_TENANT_ID` / `_CLIENT_ID` / `_CLIENT_SECRET` | —              | Entra service principal auth (secret)          |
| `PRODUCT_AI_BEARER_TOKEN`             | —                                 | Static token, local testing only               |
