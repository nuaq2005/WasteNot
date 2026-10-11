# WasteNot

WasteNot helps households track grocery inventory, spot food that should be used soon, scan receipts, and get Gemini-generated recipe ideas. Recipes can be saved to a shared **Favourites** collection. The Vitals page streams browser camera frames to the server for SmartSpectra analysis.

**Live demo:** [WasteNot on Vercel](https://wastenot-lake.vercel.app) (the deployment URL configured in this repository).

## Features

- View saved food and quantities, with expiry dates and estimated-date labels.
- Scan JPG, PNG, or WebP grocery receipts with Gemini, review extracted items, then save them to inventory.
- Generate recipe ideas from current inventory and save or remove recipes using the heart control.
- Keep a recipe and its displayed inventory details as a snapshot in Favourites.
- Use the Vitals page with a camera and SmartSpectra credentials to view pulse, breathing, and HRV measurements.

## Architecture

```mermaid
flowchart LR
  Browser[React + Vite client]
  API[Express API on Node.js]
  Tiger[(TigerData PostgreSQL)]
  Gemini[Google Gemini API]
  Presage[Presage SmartSpectra SDK]
  Vercel[Vercel routing]

  Browser -->|HTTP /api requests| API
  Browser -->|camera frames over WebSocket| API
  API -->|inventory and favourite snapshots| Tiger
  API -->|receipt extraction and recipe ideas| Gemini
  API -->|vitals session frames| Presage
  Vercel -->|/api/*| API
  Vercel -->|other routes| Browser
```

For local development, Vite proxies `/api` requests and WebSocket upgrades to the Express server at `localhost:3001`. In deployment, [`vercel.json`](vercel.json) routes `/api/*` to the server service and other paths to the client.

## Technology

| Area | Technologies |
| --- | --- |
| Client | React 19, JavaScript, Vite 8, CSS |
| Server | Node.js, Express 5, `pg`, `ws`, Multer, Sharp, CORS, dotenv |
| Database | TigerData (PostgreSQL-compatible), PostgreSQL migrations |
| AI | Google Gemini through `@google/genai` |
| Camera vitals | Presage SmartSpectra Node SDK, browser camera APIs, WebSocket |
| Deployment | Vercel multi-service configuration |
| Code quality | ESLint |

The Snowflake SDK and Cortex helper are present in the repository, but Snowflake is currently disabled in the application runtime. Snowflake credentials are not required for local setup.

## Local setup

### Requirements

- Node.js and npm
- A TigerData PostgreSQL connection string
- A Gemini API key for receipt scanning and recipe recommendations
- A Presage API key for Vitals (optional if you do not use that page)

### Configure the server

Create `server/.env` and provide the values below. Keep this file private and do not commit real credentials.

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
GEMINI_API_KEY=your-gemini-api-key
PRESAGE_API_KEY=your-presage-api-key
PORT=3001
```

`PORT` is optional; the server defaults to `3001`. The database must be reachable by the machine running the server.

### Install, migrate, and run

Install dependencies in both application services:

```bash
cd server
npm install
npm run db:migrate
```

Then start the API and leave that terminal running:

```bash
npm start
```

In a second terminal, install and start the client:

```bash
cd client
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The client proxy expects the API on port `3001`; if you set a different `PORT`, update `client/vite.config.js` to match.

To create a production client bundle:

```bash
cd client
npm run build
```

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check API and database connectivity |
| `GET` / `POST` | `/api/foods` | Read inventory and add a food item |
| `POST` | `/api/scan-receipt` | Extract grocery items from an uploaded receipt image |
| `GET` | `/api/insights/weekly` | Weekly insights endpoint (currently a placeholder) |
| `POST` | `/api/recommendations/recipes` | Generate recipes from inventory with Gemini |
| `GET` / `POST` | `/api/recipe-recommendation-favorites` | List or save a recipe snapshot |
| `DELETE` | `/api/recipe-recommendation-favorites/:id` | Remove a saved recipe |
| `POST` / `DELETE` | `/api/vitals/sessions` | Start or stop a camera measurement session |
| WebSocket | `/api/vitals/stream?token=…` | Stream camera frames and receive vitals updates |

Receipt uploads are held in memory, limited to 8 MB, and restricted to JPG, PNG, or WebP. Gemini API calls are made on the server so the API key is not exposed to the browser.

## Database and data scope

Run `npm run db:migrate` from `server/` after setting `DATABASE_URL`. The migration files create inventory and recipe-related tables, add receipt line totals, and create `generated_recipe_favorites` for saved Gemini recommendations.

The app currently has no authentication or household model. Inventory and favourites are shared by all visitors using the same deployment and database. Favouriting a recipe does not deduct inventory. The saved recipe and the relevant inventory display fields are snapshotted so later inventory edits do not change saved favourites.

## Design decisions

- **Keep AI credentials on the server.** The browser calls the Express API; Gemini requests are performed server-side.
- **Save recipes only when asked.** Generating recommendations does not automatically add them to Favourites or consume food quantities.
- **Snapshot generated content.** Favourites preserve the Gemini recipe structure and the inventory context shown at save time.
- **Store receipt row totals as receipt totals.** They represent the paid amount for a receipt row, not a calculated ingredient or recipe cost.
- **Use shared data for the current unauthenticated app.** No user identity is inferred from a browser or client-supplied field.
- **Keep Snowflake inactive for now.** Its connector and Cortex code remain in the repository for possible later use but are not required to run the current product.

## Current limitations

- Weekly insights currently return a placeholder response.
- The recipe recommendation handler currently filters inventory by `user_id`, but the checked-in `food_items` migration does not define that column. On a database created from the checked-in migrations, recipe generation needs that query/schema mismatch resolved before it can work.
- Vitals require camera permission, a secure context (localhost or HTTPS), a valid Presage API key, and available SmartSpectra service credits.

## Repository layout

```text
client/
  src/pages/          React views for inventory, receipts, health, vitals, favourites
  src/api.js          Browser API client
  vite.config.js      Local API and WebSocket proxy
server/
  index.js            Express API and WebSocket server
  services/           Presage and optional Snowflake service code
  migrations/         TigerData/PostgreSQL schema migrations
  scripts/migrate.js  Migration runner
vercel.json           Client/server service routing
```
