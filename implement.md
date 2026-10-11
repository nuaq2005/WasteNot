# Nutrition and expiration insights implementation

## What is implemented now

The UI is in [client/src/pages/Health.jsx](./client/src/pages/Health.jsx), which
is rendered by the existing **Health** tab in [client/src/App.jsx](./client/src/App.jsx).
The section that previously contained the “Presage SDK + Snowflake placeholder”
now contains two insight panels:

1. **Top nutrition categories** — `GET /api/insights/weekly` reads usage totals
   from Snowflake and shows Cortex nutrient estimates saved when a recipe is
   marked made. Values are labeled as estimates.
2. **Expiring foods** — the weekly endpoint filters current Tiger inventory in
   SQL. If Snowflake is unavailable, the Health page falls back to
   `GET /api/foods` so expiration visibility remains available.
3. **Recipe storage and made history** — the API supports shared recipes,
   ingredients, favorites, history, and marking a recipe made. Cortex estimates
   protein, carbohydrates, fiber, and sugar; the server validates and snapshots
   those values in PostgreSQL, then syncs them to Snowflake.
4. **Vitals** — the new tab uses PresageTech SmartSpectra to estimate pulse,
   breathing rate, and HRV from a live camera session. It does not analyze one
   still photo and does not save camera frames or measurements.

The application code and Snowflake driver are present. Live Cortex and
warehouse queries require the server-side Snowflake settings in
`server/.env.example` and the warehouse table in `server/snowflake/schema.sql`.
Until those are configured, the recipe-made endpoint cannot create nutrient
estimates and weekly nutrition insights return an error; food expiry still
works.

## Recommended data flow

```text
Recipe marked as made
  -> server records recipe history and ingredient/nutrient usage in PostgreSQL
  -> sync usage records to Snowflake
  -> Snowflake SQL aggregates grams of protein/carbohydrates/etc. by category
  -> GET /api/insights/weekly combines Snowflake aggregates with current
     expiring inventory from PostgreSQL
  -> client/src/api.js fetches the endpoint
  -> client/src/pages/Health.jsx renders the real insight values
```

PostgreSQL should remain the operational source of truth for current fridge
inventory and recipe history. Snowflake is useful for aggregating usage trends.
Fetch expiring inventory from PostgreSQL for freshness; optionally mirror
inventory snapshots to Snowflake for historical or warehouse reporting. Do not
make expiration visibility depend on a delayed warehouse sync.

## Exact files to implement the complete integration

| File | Responsibility |
|---|---|
| [server/migrations/001_initial_schema.sql](./server/migrations/001_initial_schema.sql) | Create inventory, recipe, ingredient, favorite, made-history, ingredient-usage, and nutrient-snapshot tables in Tiger. |
| `server/scripts/migrate.js` | Apply the idempotent PostgreSQL migration with `npm run db:migrate`. |
| `server/services/snowflake.js` | Own Snowflake connection setup, Cortex nutrient estimates, parameterized warehouse sync/aggregation, and error reporting. |
| [server/snowflake/schema.sql](./server/snowflake/schema.sql) | Define the Snowflake nutrient-usage table that must be created in the configured database/schema. |
| `server/index.js` | Provide recipe, favorite, made-history, and weekly-insights routes; retry unsynced nutrient snapshots. |
| `client/src/api.js` | Provide `getWeeklyInsights()` for the weekly insights endpoint. |
| `client/src/pages/Health.jsx` | Render estimated nutrition totals and expiring inventory with separate loading/error behavior and an expiry fallback. |
| `server/services/presage.js` | Manage transient SmartSpectra sessions, decode metrics, convert incoming JPEG frames to RGB, and enforce session/frame limits. |
| `client/src/pages/Vitals.jsx` | Provide camera permission/start/stop controls, preview, validation feedback, live readings, confidence, and privacy/health notices. |
| `client/src/App.jsx` | Add the Vitals navigation tab. |
| `server/index.js` | Create short-lived measurement sessions and accept same-origin WebSocket video frames. |

The server connects to Tiger (Tiger Data), which provides PostgreSQL-compatible
database service. Use PostgreSQL SQL and the `pg` driver already present in the
server. [server/migrations/001_initial_schema.sql](./server/migrations/001_initial_schema.sql)
defines `food_items` plus the recipe and nutrient-history tables used by the
design. Apply it to the configured Tiger database with `cd server && npm run db:migrate`.
Keep Tiger credentials and deployment-specific connection settings in the
server environment.

The recipe API uses one shared collection and adds no authentication. Marking a
recipe made does not decrement inventory; no reliable matching/quantity
conversion is defined between recipe ingredients and inventory rows.

## Suggested API response contract

For example, `GET /api/insights/weekly` could return:

```json
{
  "period": {
    "start": "2026-10-04",
    "end": "2026-10-11"
  },
  "topNutritionCategories": [
    {
      "category": "protein",
      "amountGrams": 428.5
    },
    {
      "category": "carbohydrates",
      "amountGrams": 361.2
    }
  ],
  "expiringFoods": [
    {
      "id": 17,
      "name": "Spinach",
      "quantity": 1,
      "unit": "bag",
      "expiration_date": "2026-10-13",
      "expiration_is_estimated": true
    }
  ],
  "nutritionValuesAreEstimates": true
}
```

Return empty arrays when there is no usage/inventory to report; return a clear
server error if a required data source fails. Do not turn a Snowflake outage into
a successful response with fabricated category values.

## Implemented API behavior

- GET /api/recipes lists the shared recipe collection with ingredients.
- POST /api/recipes saves a recipe and its ingredients.
- GET /api/recipes/favorites and POST /api/recipes/:id/favorite list and toggle shared favorites.
- GET /api/recipes/history lists made events, ingredient quantities used, and immutable nutrient snapshots.
- POST /api/recipes/:id/made uses Snowflake AI_COMPLETE to estimate total recipe protein, carbohydrates, fiber, and sugar in grams; validates the structured result; stores the estimate and source in PostgreSQL; and syncs it to Snowflake. Cortex values are estimates, not measured nutrition facts.
- GET /api/insights/weekly returns nutrition totals for the prior seven days plus today and SQL-filtered inventory rows for expired foods or foods expiring through seven days from today. Null expiration dates are omitted.

The Snowflake Node.js driver uses connection.execute() with bound query parameters. The configured role needs access to the selected Cortex model, warehouse, database, and schema, plus Snowflake's USE AI FUNCTIONS privilege and CORTEX_USER or AI_FUNCTIONS_USER database role. Configure the SNOWFLAKE_* values in the server environment and run server/snowflake/schema.sql in that database/schema before starting. Snowflake settings and permissions cannot be validated until supplied.

The made endpoint records each recipe ingredient as a food-usage event, scaling its saved quantity by the requested servings. It does not decrement inventory because ingredient-to-inventory matching and unit conversion are not defined.

If the warehouse is temporarily unavailable, a made event and nutrient snapshot remain in Tiger with a pending sync marker. The next weekly insights request retries the sync. The Health screen falls back to the inventory API so expiration visibility does not depend on Snowflake availability.

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

## Can Gemini do recipe recommendations based on RECEIPT and presage information?

Yes, Gemini can technically receive inventory, recipe ingredients, and usage
history and generate recipe suggestions or natural-language summaries. The
repository already calls Gemini from `POST /api/scan-receipt` in
[server/index.js](./server/index.js), using `@google/genai` and the server-side
`GEMINI_API_KEY`.

Gemini is an LLM, so its generated quantities, rankings, and explanations are
not a reliable source of truth for measured nutrition totals. For exact top
categories, calculate totals from recorded recipe/ingredient nutrient data
with SQL (PostgreSQL or Snowflake), then optionally ask Gemini to explain those
verified results or recommend recipes from them. Validate structured Gemini
output server-side and keep user review before any generated recipe changes
inventory.

Gemini recipe recommendation generation is not implemented; Gemini remains
used for receipt parsing. Cortex is used here only to estimate nutrient
snapshots for recipes marked as made.

