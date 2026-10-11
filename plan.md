# WasteNot: current codebase overview and implementation plan

## 1. What the codebase does today

This repository is currently structured as a Vite-based React frontend and a separate Express API server.

### Frontend shell

The root project in [package.json](package.json) declares a Vite app using React 19, React DOM, and `react-router-dom`.

- It runs with `npm run dev`
- It builds with `npm run build`
- It previews with `npm run preview`
- The Vite config in [vite.config.js](vite.config.js) only enables the React plugin and does not define custom routing, proxying, or app-specific settings.

At the moment, there are no visible frontend source files such as `src/App.jsx`, `src/main.jsx`, or component folders in the workspace. That means the app currently has a frontend scaffold but not a complete user-facing interface yet.

### Backend API

The server-side logic lives in [server/index.js](server/index.js) and is configured via [server/package.json](server/package.json).

The server uses:

- Express for the API layer
- PostgreSQL via `pg` and a `Pool`
- CORS to allow requests from the frontend on `http://localhost:5173`
- `dotenv` for environment variables
- `multer` for receipt image uploads
- `@google/genai` for Gemini-powered OCR/receipt parsing

The API currently exposes these endpoints:

- `GET /api/health`
  - Tests the database connection with `SELECT 1`
  - Returns `{ status: "ok", database: "connected" }` when PostgreSQL is reachable

- `GET /api/foods`
  - Reads rows from the `food_items` table
  - Sorts by `expiration_date` ascending, keeping null dates last

- `POST /api/foods`
  - Accepts food metadata such as name, quantity, unit, expiration_date, protein_g, carbs_g, fiber_g, and sugar_g
  - Validates that a food name is present
  - Inserts a new record into `food_items` and returns the inserted row

- `POST /api/scan-receipt`
  - Accepts a single uploaded image file under the field name `receipt`
  - Validates file type (`image/jpeg`, `image/png`, `image/webp`) and size (8MB max)
  - Sends the image to Gemini with a strict JSON schema prompt
  - Extracts grocery items from a receipt, excluding prices, totals, taxes, and non-food products
  - Returns the parsed result as JSON

The server also reads environment variables from [server/.env.example](server/.env.example):

- `DATABASE_URL`
- `GEMINI_API_KEY`
- `PORT=3001`

## 2. How the app is intended to work

The code strongly suggests the product is a food inventory/tracking application:

- Inventory is stored in PostgreSQL in a `food_items` table
- Food entries include quantity, unit, expiration date, and nutrition data
- The app can ingest grocery receipt photos and infer likely food items using Gemini
- The backend is meant to support a frontend that lists and tracks pantry/fridge items

This matches a WasteNot use case where a user can:

1. Add items they already have in a fridge or pantry
2. See those foods sorted by soonest expiry
3. Scan grocery receipts to bulk-import items
4. Keep track of food information and nutrition attributes

## 2.1 Adding Snowflake Cortex and Presage APIs

To extend the product beyond basic inventory tracking, the app can add two external AI/data services:

- Snowflake Cortex API: used for structured analytics, inventory insights, and query-driven reasoning over food data stored in Snowflake or a warehouse-backed dataset
- Presage API: used for prediction, prioritization, and AI-assisted decisions such as waste risk, likely usage, or meal-planning suggestions based on current inventory and household patterns

A practical integration pattern would be:

- Keep the current local PostgreSQL inventory as the operational source of truth
- Add a sync layer that sends relevant inventory snapshots to Snowflake Cortex for analysis and reporting
- Add a prediction layer through Presage to score items by urgency, likely usage, or waste risk
- Return the enrichment results back to the app so the frontend can show a “use soon,” “buy less,” or “likely to expire” recommendation panel

This preserves the current app architecture while expanding the product from basic CRUD into a smart food management assistant.

## 2.2 End-to-end user flow with Snowflake Cortex + Presage

A full user journey could look like this:

1. User opens the WasteNot dashboard
   - The app loads the current inventory from `GET /api/foods`
   - The backend can also request a summary from Snowflake Cortex, such as: top expiring items, category trends, or household waste patterns

2. User scans a grocery receipt
   - The user uploads an image to the receipt scanning form
   - The app calls `POST /api/scan-receipt`
   - Gemini extracts grocery items and returns a JSON list of likely products

3. The backend normalizes the scanned items
   - It maps raw receipt names into the `food_items` schema
   - It assigns default quantities, units, and null expiration dates if they are not provided
   - It stores the inventory updates in PostgreSQL

4. The app triggers enrichment
   - After saving, the backend sends the current inventory and recent activity to Snowflake Cortex
   - Snowflake analyzes trends such as food categories, expiration risk, over-buying, and consumption patterns
   - The app also sends inventory context to the Presage API for predictive scoring

5. Presage generates recommendations
   - It may rank items by urgency, “likely to spoil soon,” or “best to consume first”
   - It can also suggest meal ideas or recommendations based on what is in the pantry

6. The frontend renders the smart insights
   - Inventory list shows upcoming expiration dates
   - A recommendations section suggests what to use first
   - A forecast panel may show waste-risk trends for the week
   - A Snowflake analytics panel may show overall food usage or buying patterns

7. User reviews and confirms actions
   - The user can accept, reject, or edit the receipt-imported items
   - They can mark food as eaten, donated, or discarded
   - Those updates feed back into the data pipeline so Predictions and Cortex analytics stay current

This flow gives the app a clear pattern:

- local app + database for immediate actions
- Gemini for receipt extraction
- Snowflake Cortex for warehouse-style analytics
- Presage for predictive prioritization and AI guidance

## 2.3 Recipe intelligence, “made” tracking, and user favorites

The features below are not currently implemented in this repository.

At the moment, the codebase has:

- a `food_items` table for inventory
- a receipt scan endpoint
- no recipe table
- no saved favorites table
- no “made” or consumption history table
- no frontend tab for recommended recipes or saved recipe collections

The intended product direction is more specific than generic “top expiring items” metrics. A stronger version of the app would do this:

- show the top expiring items in the inventory dashboard
- show the categories of the most consumed foods
- derive those categories from recipes the user actually made
- allow the user to mark a recipe as “made” in the UI
- save recipe favorites that the user explicitly likes
- persist both recipe suggestions and user-made recipe history for future recommendations

### Recommended data model

The app should add a recipe layer in PostgreSQL alongside the existing inventory data.

Suggested tables:

- `recipes`
  - `id`
  - `user_id` (nullable for shared or AI-generated recipes)
  - `title`
  - `description`
  - `instructions`
  - `source` (`ai_generated`, `user_created`, `imported`)
  - `is_favorite` or a separate favorites table
  - `created_at`
  - `updated_at`

- `recipe_ingredients`
  - `id`
  - `recipe_id`
  - `food_name`
  - `quantity`
  - `unit`
  - `category` (produce, dairy, protein, grain, pantry, etc.)
  - `matched_food_item_id` (optional)

- `recipe_favorites`
  - `id`
  - `user_id`
  - `recipe_id`
  - `created_at`

- `recipe_history` or `meals_made`
  - `id`
  - `user_id`
  - `recipe_id`
  - `made_at`
  - `servings`
  - `notes`
  - `status` (`planned`, `made`, `skipped`)

- `food_usage_events` (optional but useful)
  - `id`
  - `user_id`
  - `food_name`
  - `category`
  - `quantity_used`
  - `unit`
  - `source` (`recipe`, `manual`, `receipt`)
  - `event_date`

### Recipe recommendation UX

The frontend should have a recipe tab structure like:

- Recommended
- My recipes
- Favorites
- Made

Behavior:

- Recommended tab: Gemini suggests recipes based on current inventory, expiry risk, and likely pantry items
- My recipes tab: recipes created by the user and saved locally
- Favorites tab: user-saved recipes sorted by favorites
- Made tab: history of recipes the user has already cooked, including timestamps and a summary of which ingredients were used

### End-to-end recipe flow

1. User opens the Recipes tab
2. The app loads recipe recommendations from Gemini using current inventory and expiring items
3. The user selects a recommended recipe
4. The recipe is displayed with ingredients, instructions, and a “Made it” button
5. When the user taps “Made it,” the app stores the recipe in `recipe_history`
6. The app also records the ingredient usage in `food_usage_events`
7. Those usage events are then aggregated to compute:
   - the most consumed food categories
   - the top expiring items
   - the items most likely to be used next
   - personalized recipe recommendations based on what the household actually makes

### Technical implementation details

#### Backend endpoints

Suggested server routes:

- `GET /api/recipes` — returns recommended and saved recipes for a user
- `POST /api/recipes` — creates a user-created recipe
- `GET /api/recipes/favorites` — returns favorite recipes
- `POST /api/recipes/:id/favorite` — toggles favorite state
- `POST /api/recipes/:id/made` — marks a recipe as made and logs usage
- `GET /api/insights/top-expiring-items` — returns inventory items closest to expiration
- `GET /api/insights/top-consumed-categories` — returns categories with the highest recipe usage over time

#### Recommendation logic

The recipe recommendation endpoint should combine:

- current inventory from `food_items`
- expiring items from `expiration_date`
- user recipe history from `recipe_history`
- favorite recipes from `recipe_favorites`
- the home’s most-used categories from `food_usage_events`

Then Gemini can generate recipe suggestions like:

- “Use these spinach, eggs, and feta ingredients before they expire”
- “Based on your household’s most-used produce categories, here are three recipes to make this week”

#### How “Made” updates the insights

When a user clicks “Made it,” do this:

1. Look up the recipe ingredients
2. Match each ingredient to a food item in `food_items` by normalized name
3. Reduce the matching inventory quantity by the recipe’s amount, or log the usage event separately if inventory should remain intact
4. Insert a record into `recipe_history`
5. Insert one or more `food_usage_events` rows for each consumed ingredient
6. Recompute insight aggregates for top categories and expiring items

This creates a positive feedback loop:

- recipes generate consumption data
- consumption data improves recommendations
- better recommendations reduce food waste and avoid buying duplicates

#### Why this matters for the product

This connects the app to real household behavior, not just raw grocery data. The system stops being a static pantry tracker and becomes a household consumption intelligence tool:

- most consumed foods are learned from recipes made
- top categories are inferred from actual usage
- favorites create a personal preference layer
- recipe history allows long-term personalization and smarter recommendations

## 3. Current implementation status

Based on the repository contents, the project is in the early-to-middle build phase:

- The backend API is implemented and structured for real data access
- The environment configuration exists for Postgres and Gemini
- The frontend scaffold exists, but the actual React app screens and logic are not present in the repo yet
- There is no visible source tree under a typical `src/` folder, meaning the user interface still needs to be created or added

## 4. Recommended implementation plan

### Phase 1: Establish the frontend shell

- Create the React app entrypoints and base layout
- Add navigation for inventory, scan receipt, and maybe dashboard views
- Wire in a global app shell consistent with a pantry management app

### Phase 2: Connect the UI to the API

- Build a client-side service layer for `GET /api/foods` and `POST /api/foods`
- Add forms for adding food items manually
- Display inventory items, expiration dates, and nutritional details
- Handle loading/error states consistently

### Phase 3: Implement receipt scanning flow

- Add an upload form for receipt images
- Send the file to `POST /api/scan-receipt`
- Parse returned item data and merge it into the inventory list
- Let the user review or edit inferred items before saving

### Phase 4: Improve the product experience

- Add sorting, filtering, and “use soon”/“expired” views
- Consider low-stock or soon-to-expire warnings
- Add a way to remove or edit items from the inventory
- Add testing around API routes and frontend behavior

### Phase 5: Production readiness

- Add secure environment handling for local and deployment environments
- Set up API validation and error logging
- Add database migration or initialization scripts for `food_items`
- Document setup instructions for developers and deployment operators

## 5. Summary

The current codebase already contains the core backend idea for WasteNot: a PostgreSQL-backed food inventory plus a receipt-scanning flow powered by Gemini. The missing piece is the frontend application itself, which still needs to be built around the existing API. The remaining work is primarily to turn this backend capability into a complete user-facing food management experience.
