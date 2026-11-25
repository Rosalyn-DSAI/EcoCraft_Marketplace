# EcoCraft - Sustainable Marketplace

EcoCraft is a web marketplace for handmade and sustainably made products. Artists can create and manage listings, customers can shop and leave reviews, and administrators can approve artists and products before they appear in the catalog.

We built EcoCraft for our NoSQL database project. The focus is on using MongoDB through a working web application—not entering CRUD commands manually in Compass. The interface talks to a Python/Flask backend, which handles validation, permissions, and MongoDB operations using PyMongo.

> **Course project:** Checkout creates a demo order and updates inventory; it does not collect payments. The shared database also protects the original seeded records from demo edits.

## What you can do

| Role | Main actions |
| --- | --- |
| Visitor | Browse approved products, search by keyword, filter by category, material or sustainability practice, sort and set a price range, and read reviews. |
| Customer | Register, sign in, manage a cart, place demo orders, cancel eligible unshipped items, and manage reviews of purchased products. |
| Artist | Register for approval, sign in after approval, create/edit/delete eligible listings, add product photos, and update shipping progress for their own order items. |
| Admin | Review artist applications (request documents, then approve, reject, or ask for more info), review new products, approve and list them with a commission rate, and view MarketPulse analytics. |

The admin **MarketPulse** dashboard shows marketplace growth, revenue, and performance analytics with a global date-range selector. It currently runs on mock data (`USE_MOCK` in `marketpulse-data.js`).

## Built with

- **Backend:** Python, Flask, PyMongo, JWT authentication
- **Database:** MongoDB Atlas (five collections: `users`, `products`, `cart`, `orders`, `reviews`)
- **Frontend:** HTML, CSS, JavaScript served by Flask
- **Images:** HTTPS image URLs; optional Cloudinary upload from the artist form

## Run locally

The steps below use **Windows PowerShell** from the project root. You'll need Python and access to a MongoDB Atlas database.

1. Get the project folder from the team's shared copy, or extract the ZIP if you downloaded it that way. Open the folder containing `app/`, `requirements.txt`, and `README.md` in VS Code. Use that folder for the commands below.

2. Create a virtual environment and install the dependencies:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
   ```

3. Make a local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

   Edit `.env` with your own Atlas connection details and a randomly generated `JWT_SECRET_KEY` (at least 32 characters). The example file explains the required variables. **Do not commit `.env` or post connection details online.**

   By default, database writes are disabled. For the team's shared `ecocraft` database, enable demo writes only after backing up the data and agreeing on which new accounts to use:

   ```dotenv
   MONGO_DB_NAME=ecocraft
   ENABLE_TEAM_DEMO_WRITES=true
   ENABLE_DEV_WRITES=false
   ```

   The application limits permitted updates to newly registered demo accounts and their records. Existing seeded users and products are kept read-only. Enabling the flag does not remove the need for a backup or appropriate database permissions.

4. Start the application:

   ```powershell
   .\.venv\Scripts\python.exe -m flask --app app run --host 127.0.0.1 --port 5000
   ```

5. Open **http://127.0.0.1:5000/** in your browser.

   Use `/api/health` to check the Flask service and `/api/health/db` to check the MongoDB connection. A successful database check returns `{"database":"ecocraft","status":"ok"}` when configured for the shared database.

   Product uploads from your computer also require Cloudinary settings in `.env`. You can use a direct HTTPS image URL instead; see [Product images](docs/PRODUCT_IMAGE_UPLOAD.md).

## Try the full workflow

You need three accounts: a customer, an artist, and an existing team admin. Public registration does **not** create administrator accounts.

1. **Open the admin dashboard.** Sign in as the team admin and open **My studio / account**. The admin shortcuts are **Meet the Makers** (artist onboarding), **Curate the Catalog** (product review), and **MarketPulse** (analytics).
2. **Register the accounts.** Use **Sign in / Sign up**, then the register form, to create a customer and an artist. A new artist cannot sign in until approved. Signing in shows a message that explains which onboarding stage the account is in.
3. **Approve the artist (admin).** In the admin **Meet the Makers** screen (artist onboarding), move the artist through the approval states with the buttons on each card:
   - **New artist requests** → *Request documents*
   - **Waiting for documents** → *Documents received*
   - **Under review** → *Request additional info*, *Approve*, or *Reject*
   - **Approved** artists can sign in.
4. **Submit a product (artist).** Sign in as the artist and open **My studio / account**. Add a product with a direct HTTPS image URL, or upload a photo if Cloudinary is configured. The product starts as a new submission waiting for review.
5. **Approve and list the product (admin).** In **Curate the Catalog**, open **New products**, enter a commission percentage, and choose *Approve and list* or *Reject*. Listed products appear in the catalog.
6. **Shop (customer).** On the home page (click the EcoCraft logo), open a product, add it to the cart, adjust the quantity, and check out. Checkout is a demo: no payment is taken, stock is reduced, and the cart is cleared. Confirm the order and stock change in Atlas.
7. **Ship (artist).** Open **Your orders**. It shows all order items by default; choose **To ship** on the right to filter. Enter a tracking ID for a pending item, then choose *Mark shipped*. The customer sees the tracking ID in their order history.
8. **Cancel and review (customer).** In **Your orders**, cancel an item that has not shipped, which restores its stock. After an item ships, leave a review on the product. You can edit or delete only your own reviews.

**Why the extra accounts?** Products from the original seeded dataset can be viewed, but the protected shared-database demo only allows purchases and edits involving newly eligible demo records.

## MongoDB design

Our database uses five collections:

- `users`: customer, artist and administrator accounts, with embedded profile information
- `products`: artist-owned listings, inventory and approval details
- `cart`: one cart per customer, containing embedded product/quantity items
- `orders`: customer orders with embedded line-item and price snapshots
- `reviews`: reviews linked to a product, customer and purchased order

The project uses references between collections where data has an independent lifecycle, and embedding where related information is normally retrieved together. MongoDB validators and indexes enforce additional constraints, including unique emails and cart ownership.

## Project files

```text
app/                  Flask application package
  __init__.py         App factory and blueprint registration
  db.py               MongoDB connection and client setup
  security.py         JWT auth, roles, and onboarding messages
  image_uploads.py    Product image handling (URLs and optional Cloudinary upload)
  domain/             Validation and business rules (accounts, products, orders, sustainability)
  routes/
    auth.py           Registration and sign-in
    health.py         Health checks
    admin/            Admin artist approvals and product moderation
    shop/             Catalog, artist products, cart, orders, reviews, and insights
  static/             CSS, JavaScript pages, and images
  templates/          HTML pages grouped by role
scripts_admin/    Opt-in helper script (shared admin creation)
docs/                 API details, architecture, and image setup
.env.example          Configuration template (no working credentials)
requirements*.txt     Python dependencies
```

## Documentation

- [Requirements and business rules](docs/REQUIREMENTS.md)
- [Architecture and technical design](docs/ARCHITECTURE_AND_TECHNICAL_DESIGN.md)
- [API endpoints and validation](docs/API_CONTRACT.md)
- [Product images and Cloudinary setup](docs/PRODUCT_IMAGE_UPLOAD.md)
- [Contributing and repository guidelines](CONTRIBUTING.md)

## Notes

EcoCraft is a local coursework application, not a public shopping service. Key limits:

- It does not process payments.
- It does not provide password recovery, returns/refunds, or production audit logging.
- For a shared class demo, use only records the team has approved for testing.
- Keep the Atlas and Cloudinary secrets out of shared files and chat messages.

