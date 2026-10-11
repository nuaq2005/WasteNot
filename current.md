# Current feature map

This document compares the features described in [plan.md](./plan.md) with the
code currently present in this repository. Status is based on implementation in
the checked-in source, not on a feature being mentioned in a prompt or displayed
as placeholder text. A database table is considered *referenced* when server code
queries it; this repository does not include a database migration or schema that
proves the table exists in a deployed database.

## Status key

- **Present** — implemented in the repository and wired into the app.
- **Partial** — some of the feature exists, but important planned behavior is
  missing or hard-coded.
- **Placeholder** — only sample/static UI or descriptive placeholder text exists.
- **Not present** — no implementation found in the repository.

## Feature mapping

| Planned feature | Status | What is in the repository | What is missing or limited |
|---|---|---|---|
| React frontend shell | Present | React app entry point and tab-based UI in [client/src/main.jsx](./client/src/main.jsx) and [client/src/App.jsx](./client/src/App.jsx). | The app has three tabs, not the planned four-tab product flow. |
| Inventory/fridge view | Partial | [CheckFridge.jsx](./client/src/pages/CheckFridge.jsx) fetches food rows, displays quantities, and highlights items expiring within five days (including expired items). | No manual add form, edit/delete actions, sorting/filtering controls, or nutrition display. |
| Read inventory API | Present | `GET /api/foods` reads `food_items`, ordering by expiration date with null dates last, in [server/index.js](./server/index.js). The client calls it through [api.js](./client/src/api.js). | Depends on a PostgreSQL `food_items` table; no schema/migration is included. |
| Add inventory API | Partial | `POST /api/foods` validates a name and inserts name, quantity, unit, expiry estimate, and nutrition columns into `food_items`. Client `addFood` is used when saving receipt items. | There is no standalone manual-entry UI. The API only checks that name is a string; broader field validation is not implemented. |
| PostgreSQL operational storage | Partial | Server configures a `pg` pool from `DATABASE_URL`; health and food routes query the database. | No migration, initialization script, or table definition is present, so database schema setup is not represented in the repository. |
| API health check | Present | `GET /api/health` runs `SELECT 1` and returns database connection status in [server/index.js](./server/index.js). | No client UI currently calls or displays this endpoint. |
| Receipt image upload and parsing | Partial | [ScanReceipt.jsx](./client/src/pages/ScanReceipt.jsx) uploads an image. `POST /api/scan-receipt` accepts a single `receipt` image, caps it at 8 MB, checks JPEG/PNG/WebP MIME types, and asks Gemini for JSON food items. | Gemini/API configuration and a working API key are required. No automated tests or robust response-schema validation are present. |
| Receipt item review/edit | Present | Parsed items appear in a review form where name, quantity, unit, and expiration date can be edited before saving. | No explicit reject/remove-item action is provided. Editing the date marks it non-estimated. |
| Save receipt items to inventory | Partial | The UI saves reviewed items by calling `POST /api/foods` once per item. | Saves are sequential and can partially complete if a later request fails. The receipt flow does not pass parsed nutrition values to the save API. |
| Expiration tracking | Partial | Expiration date and estimated flag are accepted by the add-food endpoint; fridge UI computes days remaining and marks estimated dates. Receipt scan prompt asks Gemini to estimate dates. | No date validation or editing existing stored inventory. UI only highlights the five-day window and does not provide dedicated expired/use-soon filters. |
| Food nutrition data | Partial | Add-food API accepts `protein_g`, `carbs_g`, `fiber_g`, and `sugar_g`. | Nutrition data is not displayed in the inventory UI and the receipt save flow does not persist those fields. No nutrition lookup/integration exists. |
| Recipe recommendations based on inventory | Placeholder | [Health.jsx](./client/src/pages/Health.jsx) shows three hard-coded example recipes and placeholder copy mentioning recommendations. | No recipe generation endpoint, Gemini recipe call, inventory-aware logic, household usage signals, or real recommendation data. |
| Recipe tabs: Recommended / My recipes / Favorites / Made | Not present | The app has only Check Fridge, Scan Receipt, and Health tabs in [App.jsx](./client/src/App.jsx). | No recipe-specific tab or subtabs. |
| User-created and saved recipes | Not present | No recipe creation UI or persistence implementation found. | No recipes table, recipe APIs, or local recipe store. |
| Recipe favorites | Not present | No favorites UI or behavior found. | No favorites table or favorite API routes. |
| “Made it” and recipe history | Not present | No recipe completion or history flow found. | No history table, API, timestamped meal records, or made-history UI. |
| Food usage/consumption tracking | Not present | No usage-event recording or inventory consumption logic found. | No `food_usage_events` table, endpoints, category aggregation, or quantity reduction on recipe completion. |
| Weekly top-expiring and consumed-category insights | Partial | Fridge view highlights items within five days of expiration. Health page renders hard-coded nutrition progress values. | No weekly summary, consumption-category tracking, insight endpoints, or live nutrition data. |
| Snowflake Cortex / Presage | Placeholder | Health page contains copy describing these as placeholders. | No SDK/API integration, credentials, data sync, analytics, or prediction code found. |
| Gemini integration | Partial | Gemini is invoked by the receipt endpoint for receipt parsing, using `GEMINI_API_KEY`. | Gemini is not used for recipes or other recommendations. |
| Frontend API service layer | Partial | [api.js](./client/src/api.js) wraps food-list, add-food, and receipt-scan requests; the API base URL can use `VITE_API_URL`. | No client methods for recipes, favorites, history, insights, manual edit/delete, or health status. |
| Loading/error states | Partial | Fridge and receipt views show loading/error or success messages for their implemented requests. | No shared UI pattern; no automated frontend behavior tests are included. |
| Secure environment configuration | Partial | [server/.env.example](./server/.env.example) lists `DATABASE_URL`, `GEMINI_API_KEY`, and `PORT`. Server loads environment variables with `dotenv`. | No deployment-specific configuration documentation or committed environment validation is present. |
| API validation and error logging | Partial | Food name is checked; upload has size/type restrictions; route failures are logged and return errors. | Input validation is limited, and the global Express error handler returns a 400 for any forwarded error. |
| Database migrations / initialization | Not present | Server code assumes `food_items` exists. | No schema, migration, or initialization script is in the repository. |
| Testing | Not present | No test files or test framework configuration found. | `server/package.json` has a placeholder `test` command that exits with an error; frontend scripts include build/lint only. |
| Developer setup documentation | Partial | Root README is only a project title. [client/README.md](./client/README.md) documents npm install/run/build/lint commands. | No complete root-level setup guide for configuring PostgreSQL, Gemini, and running both client and server. |

## Existing user-facing screens

1. **Check Fridge** — loads inventory and shows item quantities, total row count,
   and an “Expire Soon” section.
2. **Scan Receipt** — uploads a receipt, presents returned items for editing,
   then saves them to inventory.
3. **Health** — shows static recipe examples and static nutrition progress bars;
   its text explicitly describes Presage/Snowflake and recipe intelligence as
   placeholders.

The order and scope differ from the plan’s proposed four tabs (receipt scan,
recipe recommendations, saved recipes/favorites, and weekly insights).

## Repository-level gaps and notes

- The plan’s section 3 statement that frontend source/screens are absent is
  outdated: `client/src/` contains a working React shell and the three screens
  listed above.
- The plan describes an implemented PostgreSQL food inventory API, which is
  reflected in server routes, but there is no database schema/migration in this
  repository to establish that the referenced `food_items` table is provisioned.
- `client/package.json` and `client/package-lock.json` define the frontend npm
  dependencies. The client is not a Python project and has no
  `requirements.txt`.
- No recipe or insights API routes are implemented in [server/index.js](./server/index.js).
- No user/account or authentication flow is present; planned `user_id`-scoped
  persistence and household personalization are therefore not implemented.
