
// Initialize the database
require("dotenv").config();

const http = require("node:http");
const express = require("express");
const cors = require("cors");
const { Pool, types } = require("pg");
const { WebSocketServer } = require("ws");
types.setTypeParser(1082, (v) => v); // DATE -> string
const snowflakeService = require("./services/snowflake");
const presageService = require("./services/presage");

const app = express();
const allowedWebOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim()) : []),
]);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedWebOrigins.has(origin));
  },
}));
app.use(express.json());

// Test database connection
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    console.error("TigerData error:", err);
    res.status(500).json({
      error: "Database connection failed",
      code: err.code,
      detail: err.message
    });
  }
});

app.post("/api/vitals/sessions", async (req, res) => {
  if (!allowedWebOrigins.has(req.get("origin"))) {
    return res.status(403).json({ error: "Vitals sessions must be started from the WasteNot app." });
  }
  try {
    res.status(201).json(await presageService.createSession());
  } catch (error) {
    console.error("Vitals session could not start:", error.message);
    res.status(error.status || 503).json({ error: error.message || "Could not start a vitals session." });
  }
});

app.delete("/api/vitals/sessions/:token", (req, res) => {
  if (!allowedWebOrigins.has(req.get("origin"))) {
    return res.status(403).json({ error: "Vitals sessions must be stopped from the WasteNot app." });
  }
  presageService.closeSession(req.params.token);
  res.status(204).end();
});

// Get fridge inventory
app.get("/api/foods", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM food_items
       ORDER BY expiration_date ASC NULLS LAST`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Could not load foods" });
  }
});

// Add a food item
app.post("/api/foods", async (req, res) => {
  try {
    const {
      name, quantity, unit, expiration_date, expiration_is_estimated,
      protein_g, carbs_g, fiber_g, sugar_g
    } = req.body;

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Food name is required" });
    }

    
    const result = await pool.query(
      `INSERT INTO food_items
      (name, quantity, unit, expiration_date, expiration_is_estimated,
        protein_g, carbs_g, fiber_g, sugar_g)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        name,
        quantity ?? 1,
        unit ?? "item",
        expiration_date || null,
        expiration_is_estimated ?? true,
        protein_g ?? null,
        carbs_g ?? null,
        fiber_g ?? null,
        sugar_g ?? null
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Could not save food" });
  }
});

function isValidIngredient(ingredient) {
  return ingredient &&
    typeof ingredient.name === "string" && ingredient.name.trim() &&
    Number.isFinite(Number(ingredient.quantity)) && Number(ingredient.quantity) > 0 &&
    typeof ingredient.unit === "string" && ingredient.unit.trim();
}

// List saved recipes and their ingredients.
app.get("/api/recipes", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.name, r.description, r.instructions, r.created_at, r.updated_at,
              COALESCE(
                json_agg(json_build_object(
                  'id', i.id, 'name', i.name, 'quantity', i.quantity, 'unit', i.unit
                ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL),
                '[]'::json
              ) AS ingredients
         FROM recipes r
         LEFT JOIN recipe_ingredients i ON i.recipe_id = r.id
        GROUP BY r.id
        ORDER BY r.updated_at DESC, r.id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Recipe list failed:", error);
    res.status(500).json({ error: "Could not load recipes" });
  }
});

// Save a recipe in the shared recipe collection.
app.post("/api/recipes", async (req, res) => {
  const { name, description = null, instructions = [], ingredients = [] } = req.body || {};
  if (typeof name !== "string" || !name.trim() ||
      !Array.isArray(instructions) || !Array.isArray(ingredients) ||
      ingredients.length === 0 || !ingredients.every(isValidIngredient)) {
    return res.status(400).json({
      error: "Provide a recipe name, instructions array, and valid ingredients",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const recipeResult = await client.query(
      `INSERT INTO recipes (name, description, instructions)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id, name, description, instructions, created_at, updated_at`,
      [name.trim(), description, JSON.stringify(instructions)]
    );
    const recipe = recipeResult.rows[0];
    for (const ingredient of ingredients) {
      await client.query(
        `INSERT INTO recipe_ingredients (recipe_id, name, quantity, unit)
         VALUES ($1, $2, $3, $4)`,
        [recipe.id, ingredient.name.trim(), Number(ingredient.quantity), ingredient.unit.trim()]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ ...recipe, ingredients });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Recipe save failed:", error);
    res.status(500).json({ error: "Could not save recipe" });
  } finally {
    client.release();
  }
});

app.get("/api/recipes/favorites", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.name, r.description, r.instructions, f.created_at AS favorited_at
         FROM recipe_favorites f
         JOIN recipes r ON r.id = f.recipe_id
        WHERE f.user_id = 'shared'
        ORDER BY f.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Recipe favorites failed:", error);
    res.status(500).json({ error: "Could not load favorite recipes" });
  }
});

app.get("/api/recipes/history", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT h.id, h.recipe_id, h.recipe_name_snapshot, h.servings, h.made_at,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'category', n.nutrient_category,
                  'amountGrams', n.amount_grams,
                  'source', n.source
                ) ORDER BY n.nutrient_category)
                  FROM recipe_nutrient_usage n WHERE n.recipe_history_id = h.id
              ), '[]'::json) AS nutrients,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'name', f.food_name,
                  'quantity', f.quantity_used,
                  'unit', f.unit,
                  'source', f.source
                ) ORDER BY f.id)
                  FROM food_usage_events f WHERE f.recipe_history_id = h.id
              ), '[]'::json) AS ingredient_usage
         FROM recipe_history h
        ORDER BY h.made_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Recipe history failed:", error);
    res.status(500).json({ error: "Could not load recipe history" });
  }
});

app.post("/api/recipes/:id/favorite", async (req, res) => {
  const recipeId = Number(req.params.id);
  if (!Number.isSafeInteger(recipeId) || recipeId < 1) {
    return res.status(400).json({ error: "Invalid recipe id" });
  }
  try {
    const existing = await pool.query(
      "SELECT id FROM recipe_favorites WHERE recipe_id = $1 AND user_id = 'shared'",
      [recipeId]
    );
    if (existing.rowCount) {
      await pool.query("DELETE FROM recipe_favorites WHERE id = $1", [existing.rows[0].id]);
      return res.json({ recipeId, favorite: false });
    }
    await pool.query(
      "INSERT INTO recipe_favorites (recipe_id, user_id) VALUES ($1, 'shared')",
      [recipeId]
    );
    res.json({ recipeId, favorite: true });
  } catch (error) {
    if (error.code === "23503") return res.status(404).json({ error: "Recipe not found" });
    console.error("Recipe favorite update failed:", error);
    res.status(500).json({ error: "Could not update favorite" });
  }
});

async function syncPendingRecipeNutrients() {
  const pending = await pool.query(
    `SELECT h.id, h.made_at, n.nutrient_category, n.amount_grams
       FROM recipe_history h
       JOIN recipe_nutrient_usage n ON n.recipe_history_id = h.id
      WHERE h.snowflake_synced_at IS NULL
      ORDER BY h.id`
  );
  const byHistory = new Map();
  for (const row of pending.rows) {
    if (!byHistory.has(row.id)) {
      byHistory.set(row.id, { historyId: row.id, madeAt: row.made_at, nutrients: [] });
    }
    byHistory.get(row.id).nutrients.push({
      category: row.nutrient_category,
      amountGrams: Number(row.amount_grams),
    });
  }

  for (const record of byHistory.values()) {
    await snowflakeService.syncRecipeNutrients(record);
    await pool.query(
      "UPDATE recipe_history SET snowflake_synced_at = NOW() WHERE id = $1",
      [record.historyId]
    );
  }
}

// Record the meal and immutable Cortex nutrient estimates, then sync to Snowflake.
app.post("/api/recipes/:id/made", async (req, res) => {
  const recipeId = Number(req.params.id);
  const servings = Number(req.body?.servings ?? 1);
  if (!Number.isSafeInteger(recipeId) || recipeId < 1 ||
      !Number.isFinite(servings) || servings <= 0) {
    return res.status(400).json({ error: "Provide a valid recipe id and positive servings" });
  }

  try {
    const recipeResult = await pool.query(
      `SELECT r.id, r.name,
              COALESCE(json_agg(json_build_object(
                'name', i.name, 'quantity', i.quantity, 'unit', i.unit
              ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS ingredients
         FROM recipes r
         LEFT JOIN recipe_ingredients i ON i.recipe_id = r.id
        WHERE r.id = $1
        GROUP BY r.id`,
      [recipeId]
    );
    if (!recipeResult.rowCount) return res.status(404).json({ error: "Recipe not found" });

    const recipe = recipeResult.rows[0];
    if (!recipe.ingredients.length) {
      return res.status(400).json({ error: "Recipe needs ingredients before it can be marked made" });
    }
    const nutrients = await snowflakeService.estimateRecipeNutrients({
      name: recipe.name,
      ingredients: recipe.ingredients,
      servings,
    });

    const client = await pool.connect();
    let history;
    try {
      await client.query("BEGIN");
      history = (await client.query(
        `INSERT INTO recipe_history (recipe_id, recipe_name_snapshot, servings)
         VALUES ($1, $2, $3)
         RETURNING id, recipe_id, recipe_name_snapshot, servings, made_at`,
        [recipe.id, recipe.name, servings]
      )).rows[0];
      for (const nutrient of nutrients) {
        await client.query(
          `INSERT INTO recipe_nutrient_usage
             (recipe_history_id, nutrient_category, amount_grams, source)
           VALUES ($1, $2, $3, 'Snowflake Cortex estimate')`,
          [history.id, nutrient.category, nutrient.amountGrams]
        );
      }
      for (const ingredient of recipe.ingredients) {
        await client.query(
          `INSERT INTO food_usage_events
             (recipe_history_id, food_name, quantity_used, unit)
           VALUES ($1, $2, $3, $4)`,
          [
            history.id,
            ingredient.name,
            Number(ingredient.quantity) * servings,
            ingredient.unit,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    let analyticsSync = "complete";
    try {
      await snowflakeService.syncRecipeNutrients({
        historyId: history.id,
        madeAt: history.made_at,
        nutrients,
      });
      await pool.query(
        "UPDATE recipe_history SET snowflake_synced_at = NOW() WHERE id = $1",
        [history.id]
      );
    } catch (error) {
      analyticsSync = "pending";
      console.error("Nutrient snapshot sync pending:", error.message);
    }

    res.status(201).json({ ...history, nutrients, nutrientsAreEstimates: true, analyticsSync });
  } catch (error) {
    console.error("Recipe make event failed:", error);
    res.status(500).json({ error: "Could not record recipe as made" });
  }
});

app.get("/api/insights/weekly", async (req, res) => {
  try {
    await syncPendingRecipeNutrients();
    const [topNutritionCategories, periodResult, expiringFoodsResult] = await Promise.all([
      snowflakeService.getTopRecipeNutritionCategories(),
      snowflakeService.getWeeklyPeriod(),
      pool.query(
        `SELECT id, name, quantity, unit, expiration_date, expiration_is_estimated
           FROM food_items
          WHERE expiration_date IS NOT NULL
            AND expiration_date <= CURRENT_DATE + INTERVAL '7 days'
          ORDER BY expiration_date ASC NULLS LAST`
      ),
    ]);
    res.json({
      period: periodResult,
      topNutritionCategories,
      expiringFoods: expiringFoodsResult.rows,
      nutritionValuesAreEstimates: true,
    });
  } catch (error) {
    console.error("Weekly insights failed:", error);
    res.status(error.code === "SNOWFLAKE_NOT_CONFIGURED" ? 503 : 500).json({
      error: "Could not load weekly insights",
      detail: error.code === "SNOWFLAKE_NOT_CONFIGURED"
        ? "Configure the server-side Snowflake connection and create RECIPE_NUTRIENT_USAGE."
        : undefined,
    });
  }
});

// Scan a grocery receipt and extract food items with Gemini API

const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      return cb(new Error("Upload a JPG, PNG, or WebP image."));
    }
    cb(null, true);
  }
});

app.post("/api/scan-receipt", upload.single("receipt"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Please upload a receipt image." });
    }

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });
 
    const prompt = `
      Read this grocery receipt.
      Return ONLY valid JSON in this format:
      {
        "items": [
          {
            "name": "Spinach",
            "quantity": 1,
            "price": 2.99,
            "unit": "bag",
            expiration_date DATE,
            "expiration_is_estimated": true,
            "protein_g": 2.5,
            "carbs_g": 3.0,
            "fiber_g": 1.5,
            "sugar_g": 1.0,
            "created_at": "2023-10-01T12:00:00Z"
          }
        ]
      }

      Instructions:
        - Include only identifiable grocery food items.
        - Exclude tax, discounts, totals, and non-food products.
        - Do not invent missing items, quantities, or prices.
        - Estimate an expiration date for each food item using
          typical shelf life and the current date.
        - Use YYYY-MM-DD format for expiration_date.
        - Set expiration_date to a date in the future for estimated dates.
        - Set expiration_is_estimated to true for every estimated date.
        - Consider typical storage conditions and food type.
        - If the item or its shelf life is too uncertain, use null
          for expiration_date.
        - Do not include nutrition facts unless they are provided
          by a reliable source.
        - Return valid JSON only.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: [
        {
          inlineData: {
            mimeType: req.file.mimetype,
            data: req.file.buffer.toString("base64")
          }
        },
        { text: prompt }
      ],
      config: {
        responseMimeType: "application/json"
      }
    });

    const parsed = JSON.parse(response.text);

    res.json(parsed);
  } catch (error) { 
      console.error("Receipt scan failed:", error);

      res.status(500).json({
        error: "Receipt scanning failed. Please try again."
      });
  }
});

//Database initialization loaded

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

const server = http.createServer(app);
const vitalsSockets = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });

server.on("upgrade", (request, socket, head) => {
  let requestUrl;
  try {
    requestUrl = new URL(request.url, `http://${request.headers.host}`);
  } catch {
    socket.destroy();
    return;
  }
  const origin = request.headers.origin;
  const token = requestUrl.searchParams.get("token");
  if (
    requestUrl.pathname !== "/api/vitals/stream" ||
    !origin || !allowedWebOrigins.has(origin) ||
    !token || !presageService.hasSession(token)
  ) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  vitalsSockets.handleUpgrade(request, socket, head, (webSocket) => {
    presageService.attachSocket(token, webSocket);
  });
});

server.listen(process.env.PORT || 3001, () => {
  console.log(`WasteNot API running on port ${process.env.PORT || 3001}`);
});
