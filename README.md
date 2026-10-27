# GoodTable — Food Rescue Network

GoodTable is a multi-page, multi-user food rescue web app for SDG 2 (Zero Hunger), SDG 12 (Responsible Consumption and Production), and SDG 11 (Sustainable Cities and Communities).

Restaurants can create a business profile with a pickup address and optional map coordinates, publish surplus-food listings, and track claims. Community partners can browse available food by city/category, claim a pickup, and track collections. Exact restaurant addresses are hidden from unclaimed listings and shown to the partner after a successful claim.

## Run locally

Requires Node.js 20 or newer; there are no npm packages to install.

```powershell
node server.mjs
```

Open `http://localhost:8080`. Stop the server with `Ctrl+C`.

The first run creates `.local-data/goodtable.json` and a local session-signing key. This file-backed storage is for coursework/demo development. Keep `.local-data` private and do not upload it to source control.

### Demo accounts

All demo accounts use password `GoodTableDemo!26`:

| Role | Email |
|---|---|
| Community partner | `partner@goodtable.demo` |
| Restaurant | `restaurant@goodtable.demo` |
| Restaurant | `bakery@goodtable.demo` |

Use the account buttons on the sign-in page, or sign up with a new account. Restaurant profiles can be edited in **Location & profile**. Add latitude and longitude there to sort partner listings by distance. The **Use device location** button asks the browser for location only after it is clicked.

## Pages and workflows

- **Sign in / create account:** select Restaurant or Community partner. Restaurant registration collects the business name, pickup address, city, and optional map pin.
- **Overview:** role-specific summary of active listings, rescues, meals, and upcoming pickup activity.
- **Find food:** partner search, city/category filters, food details, distance sorting, and a one-click claim flow.
- **Saved listings:** partners can bookmark food cards and filter the discovery page to saved items. Saves are per account in that browser.
- **My listings:** restaurant listing creation and listing status management.
- **Pickups:** partner pickup schedule and restaurant handoff tracking; restaurants can mark a claimed pickup completed.
- **Notification inbox:** shows pickup claims and completion updates, with unread counts and a mark-all-read action.
- **Impact:** rescued listing, meal, and food diversion summaries.
- **Location & profile:** update restaurant address/map pin or partner service area.

## AWS deployment architecture

The included `server.mjs` is a local development backend. To serve multiple people over the internet, replace its file-backed API and local cookie login with managed AWS services:

```text
Amplify Hosting (static UI)
        │
        ├── Cognito User Pool (sign-in, restaurant/partner groups)
        │       └── access token (JWT)
        ▼
API Gateway HTTP API (Cognito JWT authorizer)
        ▼
Lambda API handlers
  ├── DynamoDB: Users/Profiles, Listings, Pickups
  ├── S3: optional donation photos (private objects)
  └── SNS: optional pickup notices

Amazon Location Service: map tiles/geocoding (optional)
CloudWatch: API and Lambda logs/metrics
```

Suggested implementation sequence:

1. **Publish the frontend:** push the project to a Git provider and connect it to Amplify Hosting. Set the static publish root to the repository root. Amplify serves the frontend; it does not run `server.mjs` as a persistent backend.
2. **Add Cognito:** create a user pool and browser app client. Use Cognito groups or a custom `role` claim for `restaurant` and `partner`. Configure the frontend's sign-in redirect URLs to your Amplify domain. Do not put a client secret or AWS credentials in browser code.
3. **Create DynamoDB tables:** use a `Listings` table keyed by `listingId`, a `Profiles` table keyed by `userId`, and a `Pickups` table keyed by `pickupId`. Add indexes for `city + status + createdAt` and `restaurantId + createdAt` so discovery and owner dashboards avoid table scans.
4. **Create API Gateway + Lambda:** implement `GET /listings`, `POST /listings`, `GET /my/listings`, `POST /listings/{id}/claim`, `GET /my/pickups`, `PATCH /listings/{id}/status`, and `PATCH /me`. Pass the Cognito JWT from the browser and authorize routes using the token's role and user ID.
5. **Use conditional writes:** claim a listing by updating it only when `status = available`; this prevents two partners from claiming the same item at once. Restrict edits/completion/cancellation to the restaurant that owns the listing.
6. **Protect location data:** return city and approximate distance for unclaimed food. Return the full address only to the listing owner and the partner who claimed it. Limit the Lambda execution role to the required tables and S3 path.
7. **Connect optional services:** store photos in a private S3 bucket using short-lived upload URLs, send pickup notifications with SNS, and replace the location illustration with Amazon Location Service maps and geocoding.

For a real pilot, add food handling instructions, allergens, best-before times, listing expiry, account recovery, rate limits, and a clear process for reporting unsafe listings.

## AWS references

- [Amplify Hosting guide](https://docs.aws.amazon.com/amplify/latest/userguide/welcome.html)
- [Cognito user pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html)
- [API Gateway HTTP API with Lambda and DynamoDB](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-dynamo-db.html)
- [Amazon Location Service map application with MapLibre GL JS](https://docs.aws.amazon.com/location/latest/developerguide/first-app.html)
