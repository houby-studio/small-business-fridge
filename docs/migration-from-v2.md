# Migrating from v2 (MongoDB) to v3 (PostgreSQL)

> **The only supported migration path is v2 `2.2.0` → v3 `3.0.0`.**
> Migrating straight into 3.1.0 or later is not supported, and the tooling to do it
> does not ship in those releases. Migrate onto 3.0.0 first, then upgrade normally.

## Why the path is pinned

The MongoDB importer (`node ace migration:mongodb`) was a one-time tool. It was removed
in 3.1.0 along with the `mongodb` driver, because carrying a legacy database client in
the production image for a migration almost nobody runs is a needless dependency and a
standing source of CVEs.

It still exists, fully working, in the 3.0.0 release — which is exactly where you need it.

## Procedure

**1. Deploy 3.0.0 specifically.** Not `latest`.

```bash
docker pull houbystudio/sbf:3.0.0
# or, from source:
git checkout 3.0.0 && npm ci
```

**2. Create the schema.**

```bash
node ace migration:run
```

**3. Import the MongoDB data.**

```bash
node ace migration:mongodb --connectionstring "mongodb://user:pass@host:27017/sbf-prod?authSource=admin"
# or set MONGO_URI in .env and run it without the flag
```

The importer moves categories, users, products, favorites, deliveries, invoices and orders,
in that order. It is **idempotent — it truncates the target tables before inserting**
(`user_favorites`, `orders`, `invoices`, `deliveries`, `user_auth_identities`, `products`,
`categories`, `users`), so a failed run can simply be repeated. For the same reason, never
point it at a database that already holds live v3 data.

**4. Verify** before going further: user count, product count, and a spot check that
historical orders resolve to the right buyer and invoice.

**5. Upgrade to the current release** the way you would any other version bump.

```bash
docker pull houbystudio/sbf:latest
node ace migration:run
```

## Notes

- v2 stored no allergen, rating or audit data, so those tables start empty.
- Users arrive without a usable local password. They sign in through OIDC, or an admin sends
  an invite so they can set one — see [auth-scenarios.md](auth-scenarios.md).
- Product image **paths** are rewritten (`./images/x.png` → `/uploads/products/x.png`), but the
  **files are not copied**. Move the contents of the v2 `public/images/` directory into
  `storage/uploads/products/` yourself, or every product renders a broken image.
