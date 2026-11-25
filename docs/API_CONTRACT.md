# EcoCraft API contract

Base URL: `http://127.0.0.1:5000/api`. Requests/responses use JSON except the multipart image upload. Protected routes require `Authorization: Bearer <accessToken>`. The frontend holds tokens in tab memory; authentication does not use cookies.

## Access and shared-data rules

Customer and artist are the only publicly registrable roles. An artist must be approved before login/access. Admin privileges come from an existing authorized account, never a registration field.

All mutations require the configured write opt-in. In shared `ecocraft`, ordinary mutations also require an eligible new `WEB26-` customer/artist and record ownership. Seeded admins may approve only eligible new artists/products. Original seeds remain read-only. A token authenticates the user; it does not bypass these checks.

## Endpoints

Paths below are relative to `/api`.

| Method | Path | Access and behavior |
| --- | --- | --- |
| GET | `/health` | Public Flask status; no database access. |
| GET | `/health/db` | Public read-only Atlas ping. |
| POST | `/auth/register` | Public, write-gated customer/artist creation. |
| POST | `/auth/login` | Public authentication; returns JWT and public user. |
| GET | `/auth/me` | Authenticated public profile. |
| PATCH | `/auth/me` | Eligible user's own `firstName`, `lastName` and `mobile`. Artists may also send `originStory` (1-2000 characters, stored at `artistProfile.originStory`); other roles get 400 for it. |
| PUT | `/auth/me/address` | Customer sets their single shipping address at `personalInfo.address` (street, city, state, zipCode, country). Returns the updated user. |
| GET | `/admin/artists` | Admin artist list. Optional `status` (one of the five onboarding statuses), `q` (name or email search, up to 100 characters), `sort=name` (first/last name order; default newest first), `page` (1–1000), and `pageSize` (1–50, default 20). Returns `artists`, `page`, `pageSize`, `total`. |
| PATCH | `/admin/artists/<id>/approval` | Admin moves an artist's onboarding status. Allowed moves: `request_received` → `waiting_for_documents`; `waiting_for_documents` → `received_documents`; `received_documents` → `waiting_for_documents` (additional info), `approved`, or `rejected`. Any other move returns 409. Unknown status values return 400, and seeded original artists return 403. Only `approved` artists can sign in. |
| GET | `/products` | Public approved/listed catalog with stock available (`inventory.quantityAvailable > 0`) from artists whose onboarding is `approved` and account is active; optional `search`, repeatable `category` (up to 30), repeatable `material` (up to 15), repeatable `practice` (sustainability practice values, up to 7), `artistId`, `minPrice`, `maxPrice`, `sort` (`newest`, `price_asc`, `price_desc`), `page`; 20/page. Multiple values in one filter match any of them. Invalid values return 400. |
| GET | `/products/mine` | Artist's own listings, up to 200. |
| POST | `/products` | Eligible approved artist creates pending, unlisted product. |
| PATCH | `/products/<id>` | Owning artist edits an eligible product. Listed products save directly and reject sustainability changes (409). Rejected products resubmit for review. |
| DELETE | `/products/<id>` | Owning artist soft-deletes a product (`active: false`) and removes it from all carts. |
| POST | `/products/image-upload` | Eligible approved artist multipart upload; no product/database insert. |
| GET | `/admin/products` | Admin product list; `status` defaults to `pending_review`, or use `approved`, `rejected`, `all`. Paged 50 per page (`page` 1–10000) with `total` and `totalPages`; optional `artistIds` (up to 50). |
| PATCH | `/admin/products/<id>/review` | Admin approves/lists or rejects an eligible new product. Approval requires `commissionRate`; rejection does not. |
| PATCH | `/admin/products/<id>/sustainability` | Admin replaces the full sustainability object (practices, summary, certifications with `verified`). Does not change listing or commission. |
| GET | `/cart` | Customer's own cart or empty cart shape. Each line includes `product` (title, price, category, images, quantityAvailable), or `null` when the product is inactive, not approved/listed, or its artist is not approved or inactive. Such lines reappear automatically if the artist is approved again. POST, PATCH, and DELETE cart routes return the same shape. |
| POST | `/cart/items` | Customer adds eligible approved product/quantity; returns 404 `NOT_FOUND` if the product or its artist is not available. |
| PATCH | `/cart/items/<productId>` | Customer changes existing cart item quantity. |
| DELETE | `/cart/items/<productId>` | Customer removes own cart item. |
| POST | `/orders/checkout` | Customer simulated transaction-based checkout. Returns **201** with `order` and `message`. Each item's `productSnapshot` includes `title`, `image` (the product's first image, or `null`), `artistId` and `artistName`. The order includes `createdAt` (UTC). |
| GET | `/orders/mine` | Customer's own order history, up to 100. Items include the same `productSnapshot` fields, including `image`. |
| GET | `/orders/sales` | Artist's own order items, up to 100 orders; each order includes `createdAt`; retains original item indices. |
| GET | `/orders/insights?start=<ms>&end=<ms>` | Artist-only KPIs for `[start,end)` and the equal-length window before it. Returns `period`, `current` and `previous` (`grossSales`, `commission`, `netPayout`, `orders`), `statusCounts` (`Shipped`, `Pending`, `Cancelled`), and `topProducts` (`productId`, `title`, `unitsSold`, `grossSales`, `netPayout`). Window must be 1 ms to 800 days long. |
| PATCH | `/orders/<id>/items/<index>/cancel` | Customer cancels own active unshipped item; restores stock once. |
| PATCH | `/orders/<id>/items/<index>/ship` | Owning artist marks an active pending item as shipped. |
| GET | `/products/<id>/reviews` | Public product reviews, up to 100. |
| POST | `/reviews` | Eligible customer creates verified review of an active item that has shipped. Returns **201** with `review`, which includes `createdAt` (UTC). |
| PATCH | `/reviews/<id>` | Customer edits own eligible review rating/comment. |
| DELETE | `/reviews/<id>` | Customer soft-deletes own eligible review (`active: false`). |
| GET | `/analytics/categories` | Public MongoDB category aggregation, up to 30 groups. |
| GET | `/analytics/materials` | Public distinct listed materials (same visibility rules), most used first, up to 40. |
| GET | `/artists/makers` | Public "Meet the Makers" cards; optional `limit` (default 10, max 100). Returns `id`, `name`, `originStory`, `image` (first product photo or null), `inCarts` (carts holding their listed products) and `soldLast30Days` (units from active order items in the last 30 days). No email, address or account fields. |

## Request examples and field rules

Customer registration:

```json
{"role":"customer","email":"buyer@example.test","password":"example-only-password","firstName":"Demo","lastName":"Buyer"}
```

Artist registration adds `originStory` and sets `role` to `artist`. Password length is 10–128 characters. Registration returns 201 with `message`/`user`; new artists start at `request_received`. Duplicate email/user ID returns 409. Never put real account passwords in repository examples.

Login accepts `email` and `password`, returning `accessToken`, `tokenType: "Bearer"`, `expiresIn` (seconds) and `user`. Public users expose `id`, `userID`, `email`, `role`, `personalInfo`, and optional `artistProfile`; they do not expose password hashes. Profile PATCH accepts `firstName`, `lastName`, `mobile`, and (artists only) `originStory`.

Product creation:

```json
{"title":"Recycled Tote","description":"Handmade from reclaimed fabric.","price":"25.50","category":"Accessories","materials":["Cotton"],"quantityAvailable":5,"tags":["recycled"],"images":["https://example.test/tote.png"]}
```

Required: title, description, price, category, nonempty materials, and integer quantity. Price has at most two decimal places, range 0.01–9999999.99. Inventory range is 0–100000. Optional fields include dimensions, care instructions, tags, images (up to 8 HTTPS URLs), sustainability, copyright text and return policy; exact limits are in `parse_product()`. Sustainability is `{practices, summary, certifications}`: practices are codes from the approved list (up to 7, unique), summary is up to 500 characters, and each certification has `name`, `issuer` (1–100 characters), optional https `certificateUrl`, and `verified` (admin-only; artist writes always store `false`). Any artist sustainability edit resets all `verified` flags. PATCH accepts a nonempty subset of those fields. Clients cannot submit artist ownership, approval, listing or commission fields. Direct inventory replacement is blocked after ordering, except an unchanged quantity may be omitted from the update.

Artist approval accepts `{"status":"<next status>"}` using the transitions listed in the `/admin/artists/<id>/approval` row above. Product review accepts `{"status":"approved","commissionRate":10}` or `{"status":"rejected"}`. Approval requires `commissionRate` (0–100, at most two decimal places); rejection ignores it.

Image upload accepts `multipart/form-data` with field `file`, PNG/JPEG/WebP up to 4 MB. Successful response is **201** with `{"url":"https://res.cloudinary.com/..."}`. Save that URL separately through product create/update. No Cloudinary credentials are returned. Missing configuration returns 503; rejected/unreachable hosting returns 502. An upload can remain unused if product saving ultimately fails.

Cart POST accepts `productId` and integer `quantity` (1–100). Quantity PATCH accepts `quantity`; stock is checked server-side. Checkout accepts `shippingAddress` containing nonempty `street`, `city`, `state`, `zipCode`, `country`. Prices, totals, artist payout and commission are calculated server-side. Checkout returns 201 with `order`/`message`; it decreases stock and clears the cart atomically. If a cart line's product or artist is no longer available, checkout returns 400 `VALIDATION_ERROR` naming the product (or "A cart product is no longer available" when the product itself is gone); the whole transaction rolls back and the cart is kept so the customer can remove the line.

Shipping requires `{"status":"shipped","trackingNumber":"EXAMPLE-123"}`. Tracking ID is required (1–100 characters); missing or blank returns 400. Pending → shipped is the only supported progression. A `status` other than `shipped` returns 400 `VALIDATION_ERROR`; an item that is cancelled or not pending returns 409. Cancellation requires an active pending-shipping item; shipped items cannot be cancelled. Order status is `pending`, `partially_shipped`, `shipped`, or `cancelled`.

Review POST requires `productId`, `orderId`, integer `rating` (1–5), and optional `comment` up to 1000 characters. The order must belong to the customer and contain the active item. Duplicate active reviews for the same purchase return 409 `DUPLICATE`. Review PATCH accepts rating/comment; DELETE soft-deletes the review so the customer can review again. `/orders/mine` items include `review` (or null). Product list, artist listing, and detail responses include `averageRating` and `reviewCount`.

## Responses and errors

Product/order/review documents use `_id` strings; the public user projection uses `id`. Money is serialized as two-decimal strings and dates as ISO strings. Success envelopes use names such as `product`, `products`, `cart`, `order`, `orders`, `sales`, `review`, `reviews`, `artists`, `categories`. Category results contain `category`, `productCount`, `averagePrice`.

Errors generally use:

```json
{"error":{"code":"VALIDATION_ERROR","message":"Description of the problem"}}
```

Health configuration/connection errors instead expose `status: "unavailable"` and an error code without credentials. Common statuses: 400 invalid input; 401 missing/invalid/expired credentials; 403 role, approval, disabled-write or seed protection; 404 missing eligible resource; 409 duplicate/reference/stock/state conflict; 413 request too large; 502 upload service failure; 503 unavailable/unconfigured service. The normal JSON body limit is 16 KB; only the image endpoint raises its multipart limit.
