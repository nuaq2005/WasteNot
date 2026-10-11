# Health insights and Gemini recipe recommendations

## What is implemented now

The UI is in [client/src/pages/Health.jsx](./client/src/pages/Health.jsx), which
is rendered by the existing **Health** tab in [client/src/App.jsx](./client/src/App.jsx).
It displays expired foods and foods expiring within seven days, then offers a
user-triggered Gemini recipe recommender below that panel. Recommendations use
saved inventory name, quantity, expiration, and receipt line total. Gemini
suggestions are not saved or deducted from inventory automatically.

Receipt scans already return item prices for review. Saving a receipt now
persists each item’s receipt **line total** in Tiger/PostgreSQL through the
`receipt_line_total` column. It is the amount paid for the receipt row, not a
unit price or recipe cost. The Health recommender considers larger line totals
as one prioritization signal alongside expiration and available quantity.

Snowflake and Cortex runtime use is paused because the API is not currently
being used. The Snowflake service, driver, schema, and historical nutrient
tables remain in the repository for possible later reactivation, but the server
does not import the Snowflake service, make Snowflake/Cortex calls, or display a
Snowflake nutrition panel. Recipe-made events continue to save recipe history
and ingredient-usage events in Tiger only; they do not create nutrient
estimates. The Vitals tab continues to use Presage SmartSpectra as described
below.

## Recommended data flow

```text
Receipt scan
  -> user reviews item names, quantities, expiration dates, and receipt line totals
  -> POST /api/foods stores inventory in Tiger/PostgreSQL
  -> GET /api/insights/weekly returns the date window and SQL-filtered expiring foods
  -> Health displays the expiring-foods panel
  -> user clicks Generate recipe ideas
  -> POST /api/recommendations/recipes reads current inventory from Tiger
  -> Gemini suggests recipes using expiry, quantity, and receipt line totals
  -> Health displays the suggestions for review; nothing is saved or deducted
```

Tiger/PostgreSQL is the source of truth for current inventory and recipe
history. Expiring-food filtering happens in SQL and omits rows with null
expiration dates. The window includes expired items and dates through seven
days from the database's current date. Snowflake is not required to run these
features.

## Exact files to implement the complete integration

| File | Responsibility |
|---|---|
| [server/migrations/001_initial_schema.sql](./server/migrations/001_initial_schema.sql) | Create inventory, recipe, ingredient, favorite, made-history, ingredient-usage, and future nutrient-snapshot tables in Tiger. |
| [server/migrations/002_food_receipt_line_total.sql](./server/migrations/002_food_receipt_line_total.sql) | Add the nullable, nonnegative receipt line total to existing Tiger inventory tables. |
| `server/scripts/migrate.js` | Apply both idempotent PostgreSQL migrations with `npm run db:migrate`. |
| `server/services/snowflake.js` | Retained for a possible future Snowflake/Cortex integration; it is not used at runtime. |
| [server/snowflake/schema.sql](./server/snowflake/schema.sql) | Retained for later; not required for the current app or migrations. |
| `server/index.js` | Provide recipe, favorite, made-history, weekly-expiry, receipt-scan, and Gemini recommendation routes. |
| `client/src/api.js` | Provide weekly-insights and on-demand Gemini recipe-recommendation requests. |
| `client/src/pages/Health.jsx` | Render SQL-filtered expiring inventory and Gemini recipe ideas below it. |
| `client/src/pages/ScanReceipt.jsx` | Let the user review and edit receipt line totals before saving inventory. |
| `server/services/presage.js` | Manage transient SmartSpectra sessions, decode metrics, convert incoming JPEG frames to RGB, and enforce session/frame limits. |
| `client/src/pages/Vitals.jsx` | Provide camera permission/start/stop controls, preview, validation feedback, live readings, confidence, and privacy/health notices. |
| `client/src/App.jsx` | Add the Vitals navigation tab. |
| `server/index.js` | Create short-lived measurement sessions and accept same-origin WebSocket video frames. |

The server connects to Tiger (Tiger Data), which provides PostgreSQL-compatible
database service. Use PostgreSQL SQL and the `pg` driver already present in the
server. Apply both migrations to the configured Tiger database with
`cd server && npm run db:migrate`. This creates `food_items`, recipe/history
tables, and the receipt-line-total column. Keep Tiger credentials and
deployment-specific connection settings in the server environment.

The recipe API uses one shared collection and adds no authentication. Marking a
recipe made does not decrement inventory; no reliable matching/quantity
conversion is defined between recipe ingredients and inventory rows.

## Suggested API response contract

`GET /api/insights/weekly` returns the date window and matching inventory rows:

```json
{
  "period": {
    "start": "2026-10-04",
    "end": "2026-10-11"
  },
  "expiringFoods": [
    {
      "id": 17,
      "name": "Spinach",
      "quantity": 1,
      "unit": "bag",
      "expiration_date": "2026-10-13",
      "expiration_is_estimated": true
    }
  ]
}
```

The date window is computed by PostgreSQL as today and the prior seven days.
`expiringFoods` can be empty. Rows without an expiration date are excluded.

## Implemented API behavior

- GET /api/recipes lists the shared recipe collection with ingredients.
- POST /api/recipes saves a recipe and its ingredients.
- GET /api/recipes/favorites and POST /api/recipes/:id/favorite list and toggle shared favorites.
- GET /api/recipes/history lists made events, ingredient quantities used, and any existing nutrient snapshots. Current runtime does not create nutrient snapshots.
- POST /api/recipes/:id/made records recipe history and ingredient usage in Tiger. It does not call Snowflake/Cortex, estimate nutrients, or decrement inventory.
- GET /api/insights/weekly returns a computed date window and SQL-filtered inventory rows for expired foods or foods expiring through seven days from today. Null expiration dates are omitted.
- POST /api/recommendations/recipes reads up to 100 in-stock inventory rows from Tiger and asks Gemini for up to three recipe suggestions. The API key is `GEMINI_API_KEY`; the endpoint returns validated inventory IDs and quantities with the generated suggestions. A missing key returns a configuration error.
- POST /api/scan-receipt asks Gemini to identify receipt foods. The price field represents the receipt row's line total and is editable before saving.

Snowflake service code and schema are retained but no Snowflake settings or
privileges are needed for the current runtime.

The made endpoint records each recipe ingredient as a food-usage event, scaling
its saved quantity by the requested servings. It does not decrement inventory
because ingredient-to-inventory matching and unit conversion are not defined.

When generating recipe ideas, Gemini is instructed to prioritize earlier
expiration, larger available quantities, and higher receipt line totals. A
line total describes the whole receipt row, so the UI does not treat it as a
per-unit price or calculate recipe cost from it. Generated ideas are displayed
for review and do not mutate saved recipes or inventory.

## Presage SmartSpectra Vitals integration

PresageTech's SmartSpectra SDK measures wellness metrics from changing camera
frames. It cannot produce these measurements from one still photo. The Vitals
tab starts an explicit live camera session, explains capture conditions, shows
SmartSpectra validation feedback, and lets the user stop the session.

### User-visible behavior

- The **Vitals** tab is wired in `client/src/App.jsx` and rendered by
  `client/src/pages/Vitals.jsx`.
- Ask for camera permission only after the user chooses to start a measurement.
- Show the camera preview, camera/lighting/framing guidance, current validation
  status, and a clear stop control. Do not save or record camera frames.
- Display only metrics actually returned by SmartSpectra, with confidence and
  capture duration. Document warm-up expectations: pulse rate needs about 12
  seconds; breathing rate about 30 seconds; HRV about 60 seconds.
- Label results as general-wellness information. Do not present the relative
  arterial-pressure waveform as blood pressure, or provide diagnosis or
  treatment advice. SmartSpectra states its metrics are not FDA-cleared for
  diagnosis or treatment.

### Integration and privacy details

- The existing app is a browser-based React/Vite client with an Express/Node
  server. Presage's Node.js SDK is a native Node/Electron SDK, not a browser
  package. Keep the SmartSpectra API key server-side in `PRESAGE_API_KEY`.
- For the existing browser app, capture frames with the browser camera after
  user permission and feed them to the SmartSpectra Node SDK through its custom
  frame input. This requires a real-time client-to-server frame transport and
  server-side session lifecycle. Camera frames cross the app server for
  processing, must be transient, and must never be written to disk or logged.
  The UI and privacy notice must say this before the user starts.
- Use `@smartspectra/node-sdk` only in the server process. Create a dedicated
  `server/services/presage.js` adapter that creates/destroys one SDK session per
  user capture, feeds RGB frames with monotonic timestamps, and emits only
  decoded metrics, confidence, validation status, and sanitized errors to the
  browser. Limit session duration, frame dimensions/rate, request sizes, and
  concurrent sessions. Do not persist health measurements unless separately
  specified and approved.
- Use an unguessable short-lived session token for the WebSocket connection,
  validate the browser origin, cap active sessions and frame size/rate, and
  clean up the SDK session on disconnect or timeout. The current app has no
  user login; this does not provide identity or account-level access control.
- Read `PRESAGE_API_KEY` from `server/.env`; never expose it through Vite
  environment variables or send it to the browser. Return a clear
  configuration error if the key is absent.
- Check SmartSpectra plan/credits and SDK platform compatibility before
  deployment. The Node SDK requires a supported server platform and currently
  supported Node.js runtime. A native mobile app is an alternative that runs
  the platform SDK directly on the device and avoids forwarding camera frames
  through the WasteNot server.
- Do not implement food-waste prediction under this integration: SmartSpectra
  is for camera-based vital measurements. Keep those results separate from
  inventory, food nutrition, and Snowflake analytics.

The browser sends JPEG frames to the WasteNot server over a WebSocket. The
server converts each frame to RGB and feeds it to SmartSpectra's custom-input
pipeline. Frames and measurements are transient; neither is stored in Tiger or
Snowflake. `PRESAGE_API_KEY` stays in `server/.env`. Camera access requires
localhost or HTTPS, and production deployments must use HTTPS/WSS. The SDK
metrics are for general wellness and are not cleared for medical diagnosis or
treatment. Relative arterial-pressure waveforms must not be presented as blood
pressure readings.

## Gemini recipe recommendations

Gemini is used in two places: `POST /api/scan-receipt` interprets a receipt
image, and the Health tab's **Generate recipe ideas** action requests
`POST /api/recommendations/recipes`. The recommendation endpoint reads saved
inventory from Tiger, including expiration date, quantity, and receipt line
total, then asks Gemini to suggest recipes. This uses receipt information after
it has been reviewed and saved; the recommendation endpoint does not resend the
original receipt image. Presage measurements are unrelated and are not sent to
Gemini.

The server checks that suggested inventory IDs exist and caps suggested
quantities at saved amounts. Gemini's recipe text is still generated advice,
not verified nutrition or allergy guidance. Suggestions are only displayed;
they do not save a recipe or change inventory. Snowflake/Cortex is paused and
not used by either Gemini feature.

