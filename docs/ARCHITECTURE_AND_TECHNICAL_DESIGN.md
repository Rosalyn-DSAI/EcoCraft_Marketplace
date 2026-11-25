# Architecture and technical design

This document describes how EcoCraft is built. Business rules and scope are in [REQUIREMENTS.md](REQUIREMENTS.md). Endpoint paths, parameters, and error codes are in [API_CONTRACT.md](API_CONTRACT.md). UI standards are in the team design notes.

## Application boundaries

`app.create_app()` loads the project-root `.env`, applies optional test overrides, configures CORS for `/api/*`, sets a 16 KB default request body limit, and registers the blueprints. Unknown routes, wrong methods, and oversized bodies return JSON errors (404, 405, and 413). Importing the app does not open a database connection. `app/db.py` lazily creates one PyMongo client per Flask application and reuses it through `app.extensions`.

Routes are grouped by function under `app/routes/`:
- `health.py`: `/api/health` and `/api/health/db`.
- `auth.py`: registration, login, and the signed-in profile and address (`/api/auth/...`).
- `admin/`: `common.py` (blueprint and admin guard), `artists.py` (onboarding list), and `moderation.py` (artist transitions, product review, sustainability).
- `shop/`: `catalog.py` (public catalog and makers), `artist_products.py` (artist listings and uploads), `cart.py`, `orders.py` (checkout, history, shipping, cancellation), `reviews.py`, `insights.py` (artist KPIs and category analytics), and `common.py` (shared eligibility helpers).
- `app/image_uploads.py` holds the Cloudinary adapter used by the image upload route.
- The root `GET /` route is defined in `app/__init__.py`, outside the `/api` prefix.

The browser loads `marketplace.html` and its CSS and JavaScript. JavaScript sends same-origin `/api` requests to Flask. JWT access tokens are held in tab memory and sent as a `Bearer` authorization header, so refreshing the tab requires signing in again. The browser does not connect to Atlas and never receives database or Cloudinary secrets.

The marketplace template extends `base.html` and includes shared and page-specific sections. Styles are under `static/css/`, the shared marketplace script is under `static/js/pages/`, and branding images are under `static/images/`. The interface is a single-page shell rather than separate Flask routes.

## Validation, authentication, and authorization

- `app/domain/accounts.py` holds registration and profile allowlists plus name, email, and password length rules. Password hashes are created and checked server-side with Werkzeug.
- `app/domain/` validates product data, sustainability, addresses, prices, integers, and commission rates, and computes order money. `validation.py` holds shared primitives, `products.py` and `sustainability.py` hold product rules, and `orders.py` holds order math and status. These helpers have no Flask or database dependency.
- `security.py` verifies the HS256 JWT (issuer, signature, expiry, and required claims), reloads the account from MongoDB on every request, checks its current role, rejects disabled accounts, and denies artists who are not yet approved. The denial message depends on the artist's onboarding state.
- Write routes check both the configuration opt-in (`ENABLE_DEV_WRITES`, `ENABLE_TEAM_DEMO_WRITES`) and record eligibility and ownership. Enabling writes alone does not authorize a seeded-record mutation.
- In the shared `ecocraft` database, editable customer and artist records must have server-generated `WEB26-CUS-` or `WEB26-ART-` identifiers. `can_edit_user` fails closed for seeded records.

## Database

The application uses one MongoDB database. Collections and their relationships:
- `users` embeds personal and artist profile data, including the onboarding state.
- `products.artistId` references its artist.
- `cart` embeds item references and quantities, with one document per customer.
- `orders` embeds item-level financial and shipping data and a `productSnapshot` (title, image, artist), so historical purchases keep their original details.
- `reviews` references its customer, product, and purchased order.

Atlas collection validators and unique indexes (including the unique review-per-purchase index) are applied manually in Atlas. They are not defined in this repository, so they cannot be verified from code. They supplement the application checks rather than replacing authorization.

Every collection (`users`, `products`, `cart`, `orders`, `reviews`) stores `createdAt` and `updatedAt` as dates. The application sets both on insert, and sets `updatedAt` on every update. `createdAt` is never rewritten; the write helpers in `app/db.py` strip it from updates. The database validators require both fields, so every write must go through these helpers.
`parse_product()` returns Python `Decimal` values for validation and calculation. Product routes store prices as BSON `Decimal128`. Currency calculations use explicit two-decimal rounding. JSON responses serialize BSON IDs as strings, money as two-decimal strings, and datetimes as ISO strings.

Product `sustainability` is `{practices, summary, certifications}`. Artists write practices, summary, and certifications, but every stored `verified` flag is `false` on artist writes. Admins replace the whole object through `PATCH /admin/products/<id>/sustainability`, which never changes listing or commission.

## Product and image lifecycle

Artist creation sets `approvalStatus: pending_review` and `listProduct: false`. Editing a rejected product resubmits it for review. Editing a listed product saves directly, but sustainability is admin-managed and cannot be changed by the artist. Admin approval lists the product. Deleting a product is a soft delete: it sets `active: false` and removes the product from every cart, so existing orders and reviews keep their references. Ordered products also reject direct inventory replacement.

File uploads use a protected artist endpoint with the same write and seed guards. The endpoint raises the multipart body limit independently of the 16 KB JSON limit. The adapter checks a 4 MB file-size limit and PNG, JPEG, or WebP signatures, then sends a server-authenticated request to Cloudinary. Only the resulting HTTPS URL is stored on the product. Signature checks do not fully decode an image. Existing HTTPS URLs bypass uploading. Unchanged image arrays are preserved during edits. Unused uploaded images are not deleted automatically.

## Orders and transactions

Checkout runs in one MongoDB session and transaction. It reads the cart, rechecks product availability and artist eligibility, conditionally decrements stock, inserts the order with server-calculated totals, and clears the cart. Insufficient stock or any other error aborts the transaction. There is no non-transactional fallback.

Checkout returns **201** with the full order, including `createdAt` (UTC) and each item's `productSnapshot.image` (the product's first image, or `null`). Shipping changes the artist's own item from `pending` to `shipped`. It does not decrement stock again. The order status is `shipped` when all active items are shipped and `partially_shipped` when only some are. Artist responses expose only that artist's item details and keep the original item indices.

Cancellation and shipping each run their checks and writes in a transaction. Cancellation restores stock, marks the item cancelled, and recalculates totals and status together. Rejected requests return before any write, so they leave no partial change. Order status and totals are computed by `app/domain/orders.py`.

Cart add and quantity operations are read-modify-write updates on an embedded array and run outside a transaction. Concurrent cart edits are not guaranteed to be safe. This needs separate testing.

## Aggregation

`GET /api/analytics/categories` runs a MongoDB `$match` on approved, listed products, then `$group` by category (count and average price), `$sort`, and `$limit` to 30 groups. `GET /api/analytics/materials` uses the same match, `$unwind`s `materials`, groups distinct values, sorts by use, and limits to 40. Grouping happens in MongoDB, not in browser or Python code.

## Test and utility boundaries

The repository has no automated test suite. Verification is manual, in the browser, against the configured app and database.

The shared-admin utility (`scripts_admin/create_shared_admin.py`) performs one confirmed insert into `ecocraft`. Do not run it during routine checks.
