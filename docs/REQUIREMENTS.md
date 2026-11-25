# Business and functional requirements

This document states what EcoCraft must do and the business rules it follows. It does not describe how the code is structured (see [ARCHITECTURE_AND_TECHNICAL_DESIGN.md](ARCHITECTURE_AND_TECHNICAL_DESIGN.md)) or list endpoints (see [API_CONTRACT.md](API_CONTRACT.md)).

## Goal and scope

EcoCraft is a coursework marketplace for sustainable, handmade craft. Visitors browse approved products, customers buy them, and artists sell their own work. Admins approve artists and products.

In scope:
- Public catalog, makers page, and product reviews.
- Customer accounts, cart, checkout, order history, cancellation of unshipped items, and verified reviews.
- Artist onboarding, product listing, image upload, order fulfilment, and sales insights.
- Admin onboarding review, product moderation, and sustainability verification.

Out of scope:
- Real payment processing. Checkout records an order without taking payment.
- Real shipping carriers. Artists enter a tracking ID manually.
- Automated tests and production hosting.

## Roles

| Role | Who | Main capabilities |
|------|-----|-------------------|
| Visitor | Not signed in | Browse the catalog, view products, reviews, and makers. |
| Customer | Registered buyer | Manage cart, check out, view own orders, cancel unshipped items, and review purchased products. |
| Artist | Registered maker | After approval, manage own products, fulfil own order items, and view sales insights. |
| Admin | Team administrator | Review artist onboarding, moderate products, and set sustainability verification. |

## Artist onboarding

Artists register and then move through these onboarding states. The names match the stored values.

1. `request_received`: registration is complete. Admin requests documents.
2. `waiting_for_documents`: the artist must send the requested documents.
3. `received_documents`: documents are in and under admin review. Admin can request additional information, which returns the artist to `waiting_for_documents`, or approve or reject.
4. `approved`: the artist can sign in and sell.
5. `rejected`: the artist cannot sign in.

Only approved artists can sign in. Any other artist who tries to sign in sees a message that says which onboarding state they are in.

## Functional requirements

### Visitors and customers

- Visitors can browse approved, listed products with stock available. Sold-out products stay hidden.
- Catalog filters: search, category (multiple at once), material, sustainability practice (multiple at once), artist, price range, and sort. Multiple values in one filter match any of them.
- Customers add items to a cart with a quantity from 1 to 100 per product.
- Checkout requires a complete shipping address. Totals, artist payout, and commission are calculated by the server.
- Customers can see their order history and cancel an item that the artist has not yet shipped.
- Customers can review a product only after an active item from that product has shipped. One review per purchase. Only the reviewer can edit or delete their review. Deleting a review removes it from public view.

### Artists

- Artists create products with title, description, price, category, materials, quantity, and optional details, photos, and sustainability information.
- New products wait for admin review before they are listed. A rejected product can be edited and resubmitted.
- Artists cannot change sustainability on a listed product. Admins verify sustainability.
- Artists mark their own order items as shipped by entering a tracking ID. They see only their own items.
- Artists see sales KPIs (sales, commission, payout, and order status) for their own products over a chosen date window.

### Admins

- Admins see the artist onboarding list, filter it by state, and move artists through the states above.
- Admins approve or reject pending products. Approval requires a commission rate. Rejection does not.
- Admins set sustainability verification on a product. This does not change its listing or commission.

## Business rules

- **Commission:** a percentage of each sale that goes to EcoCraft. New products default to 10%. The admin sets the rate when approving a product. Payouts are the item total minus commission.
- **Shipping-only flow:** there is no payment step. An order is placed when checkout succeeds, and stock is reserved then.
- **Stock:** checkout reduces stock. Cancelling an unshipped item restores it.
- **Order status:** `pending` until items ship, then `partially_shipped` or `shipped`. `cancelled` when every item is cancelled.
- **Reviews:** verified only. The purchase must have shipped.
- **Seed data:** original seeded artists and products are not edited by the app. Only newly created records can be moderated.

## Open questions

- **Minimum rating filter in Shop by:** add it with a server-side aggregation (slower paging), or drop it. Decision deferred.
- **"Meet the Makers" naming:** the same phrase is used for the admin onboarding screen and the public makers page. Confirm whether the admin screen should be renamed.
