# Nutrition and expiration insights implementation

## What is implemented now

The UI is in [client/src/pages/Health.jsx](./client/src/pages/Health.jsx), which
is rendered by the existing **Health** tab in [client/src/App.jsx](./client/src/App.jsx).
The section that previously contained the “Presage SDK + Snowflake placeholder”
now contains two insight panels:

1. **Top nutrition categories** — a clearly marked Snowflake-planned panel. It
   explains that the app cannot yet calculate recipe-based protein,
   carbohydrate, fat, or other nutrition totals because recipe history and
   food-usage data are not implemented. It intentionally displays no invented
   sample statistics.
2. **Expiring foods** — a working panel that calls the existing `getFoods()`
   client method, filters inventory for expired items and items expiring in the
   next seven days, sorts them by expiration, and shows quantity and whether the
   date was estimated. Loading, empty, and error states are included.

The expiring-food panel uses PostgreSQL inventory through the existing
`GET /api/foods` route. Snowflake, Presage, and recipe nutrition aggregation are
**not connected yet**; the UI says so explicitly. There is no Snowflake or
Presage SDK dependency or credential configured in the repository.

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
| [server/migrations/001_initial_schema.sql](./server/migrations/001_initial_schema.sql) | Create the current `food_items` table and recipe, recipe-ingredient, favorites, made-history, and nutrient-usage tables in Tiger. The nutrient usage table stores per-made-recipe gram snapshots so future edits do not rewrite history. |
| `server/services/snowflake.js` (new) | Own Snowflake connection setup, parameterized aggregation queries, and error reporting. Keep credentials on the server, never in Vite/client variables. |
| `server/index.js` | Add recipe/history routes and `GET /api/insights/weekly`. That route obtains nutrition aggregates from the Snowflake service and current expiring items from PostgreSQL, then returns one validated response. |
| `client/src/api.js` | Add a typed-by-contract client function such as `getWeeklyInsights()` that calls `GET /api/insights/weekly`. |
| `client/src/pages/Health.jsx` | Replace the current no-data message with the API result, while preserving loading, error, and empty states. The expiring-food panel is already wired to current PostgreSQL inventory here. |
| `server/services/presage.js` (optional, new) | Encapsulate a Presage request if the product later needs an external waste-risk or usage prediction. Call it only from a server route/service, not from browser code. |

The server connects to Tiger (Tiger Data), which provides PostgreSQL-compatible
database service. Use PostgreSQL SQL and the `pg` driver already present in the
server. [server/migrations/001_initial_schema.sql](./server/migrations/001_initial_schema.sql)
now defines `food_items` plus the recipe and nutrient-history tables used by
the design. Apply this SQL to the configured Tiger database before starting the
API. The repository does not yet include a migration runner, so apply it once
through Tiger's SQL console or a PostgreSQL client connected with `DATABASE_URL`.
Keep Tiger credentials and deployment-specific connection settings in the
server environment.

The migration's recipe tables establish storage only; recipe CRUD, marking a
recipe as made, inventory decrement, and syncing snapshots to Snowflake still
need implementation. There is no authentication yet, so the nullable
`recipe_favorites.user_id` column is only a future extension point and does not
provide household isolation or authorization.

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
  ]
}
```

Return empty arrays when there is no usage/inventory to report; return a clear
server error if a required data source fails. Do not turn a Snowflake outage into
a successful response with fabricated category values.

## Example code placement

The following snippets describe the intended integration contract. The
Snowflake service and weekly endpoint shown here are **not yet implemented**.

### `server/services/snowflake.js` — aggregate recipe nutrient usage

After syncing recipe nutrient-usage snapshots to Snowflake, use Snowflake SQL to
calculate totals. This assumes the warehouse table has `HOUSEHOLD_ID`,
`EVENT_DATE`, `NUTRIENT_CATEGORY`, and `AMOUNT_GRAMS` columns. The PostgreSQL
source table is `recipe_nutrient_usage`; the sync/model must add the household
and made-event date keys needed by the warehouse query.
The weekly period is the previous seven days plus today: `EVENT_DATE` is from
seven days before the current date through the current date, inclusive. The
response's `period.start` and `period.end` must be computed from the same
calendar-date rule. `AMOUNT_GRAMS` is the summed mass in grams for a nutrient
category actually used in one made recipe (for example, total protein grams
across its ingredients and servings). It must be calculated when the meal is
recorded and saved as a snapshot in `recipe_nutrient_usage`, not read later
from mutable inventory data. Store one row per made recipe and nutrient
category; `source` identifies the nutrient-data provenance (such as a trusted
food-data provider or user entry). Do not infer these totals from an item's
inventory quantity. Current item fields include protein, carbs, fiber, and
sugar only; there is no fat field, and receipt review does not save those
nutrient values today. Add fat only when its source and validation are defined.

```js
// server/services/snowflake.js
// Keep Snowflake credentials and queries on the server; do not expose them to Vite.
async function getTopRecipeNutritionCategories(connection, householdId) {
  // Bind the household and date window instead of interpolating user input.
  const sql = `
    SELECT
      NUTRIENT_CATEGORY AS category,
      SUM(AMOUNT_GRAMS) AS amount_grams
    FROM RECIPE_NUTRIENT_USAGE
    WHERE HOUSEHOLD_ID = ?
      AND EVENT_DATE >= DATEADD(day, -7, CURRENT_DATE())
      AND EVENT_DATE < DATEADD(day, 1, CURRENT_DATE())
    GROUP BY NUTRIENT_CATEGORY
    ORDER BY amount_grams DESC
    LIMIT 4
  `;

  return executeSnowflakeQuery(connection, sql, [householdId]);
}

module.exports = { getTopRecipeNutritionCategories };
```

`executeSnowflakeQuery` above represents the query wrapper to implement using
the selected Snowflake Node.js driver; it does not exist in this repository.
Use the driver's documented connection and parameter-binding API.

### `server/index.js` — combine analytics with live expiry data

```js
// server/index.js
// This route is a design example; it depends on the future Snowflake service,
// recipe/usage schema, and household identity/authentication.
app.get("/api/insights/weekly", async (req, res) => {
  try {
    const householdId = req.auth.householdId;

    // Nutrition is aggregated from recipe usage in Snowflake.
    const topNutritionCategories =
      await snowflakeService.getTopRecipeNutritionCategories(
        snowflakeConnection,
        householdId
      );

    // Filter in SQL so the API returns only expired and soon-to-expire rows.
    // The window is inclusive of today through seven days from today; null
    // expiration dates are omitted. The migration defines this Tiger schema.
    const expiringFoodsResult = await pool.query(
      `SELECT id, name, quantity, unit, expiration_date, expiration_is_estimated
       FROM food_items
       WHERE expiration_date IS NOT NULL
         AND expiration_date <= CURRENT_DATE + INTERVAL '7 days'
       ORDER BY expiration_date ASC NULLS LAST`
    );

    // Keep the response period aligned with the Snowflake filter.
    const periodResult = await pool.query(
      `SELECT (CURRENT_DATE - 7)::text AS start,
              CURRENT_DATE::text AS end`
    );

    res.json({
      period: periodResult.rows[0],
      topNutritionCategories,
      expiringFoods: expiringFoodsResult.rows,
    });
  } catch (error) {
    console.error("Weekly insights failed:", error);
    res.status(500).json({ error: "Could not load weekly insights" });
  }
});
```

The current server has no `req.auth`, household identity, Snowflake connection,
or recipe/usage schema. Those prerequisites must be implemented before this
example can run. In particular, the current app has no login system, so
household-scoped queries need an explicit identity design rather than a
hard-coded household ID.

### `client/src/api.js` and `client/src/pages/Health.jsx` — display live values

```js
// client/src/api.js
// Add this alongside getFoods() after the server route is implemented.
export const getWeeklyInsights = () => request("/api/insights/weekly");
```

```jsx
// client/src/pages/Health.jsx
// Fetch the combined response and render real ranked amounts; keep the existing
// loading/error handling so an upstream failure is visible to the user.
const insights = await getWeeklyInsights();
setTopNutritionCategories(insights.topNutritionCategories);
setExpiringFoods(insights.expiringFoods);
```

The current Health screen already fetches foods using `getFoods()` and renders
expiry details. When the combined endpoint is ready, switch that screen to its
response or retain `getFoods()` as the expiry-only source. Do not show static
values as if they were live nutrition analytics.

## Where Presage should be used

Presage is not currently imported or called anywhere in the repository. If the
product requirements call for predicted food-waste risk, likely usage, or
prioritization beyond transparent date-based sorting:

- Put vendor API/authentication code in a server-only
  `server/services/presage.js` adapter.
- Call that adapter from a server endpoint such as
  `GET /api/insights/waste-risk`, after supplying the current inventory and
  relevant recipe/usage history.
- Return prediction scores and explanations to the client and render them as
  *predictions*, distinct from actual expiry dates or measured nutrition totals.
- Keep `GET /api/foods` and the date-based expiring-food list as the
  authoritative inventory data; Presage predictions should not overwrite it.

Presage should not be inserted into the nutrition aggregation path unless its
documented product specifically provides the required nutritional analytics.
The Snowflake SQL aggregation is the appropriate place for deterministic
“which nutrient category had the largest recorded recipe usage?” calculations.
The exact Presage endpoint, request schema, and authentication cannot be
specified reliably until the vendor API/SDK and credentials are selected.

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

Gemini recipe generation is not implemented today: it is only used for receipt
parsing. Recipe history, nutrient usage data, and recipe recommendation routes
must be added before Gemini can make grounded, household-specific suggestions.

