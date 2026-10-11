
// Initialize the database
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool, types } = require("pg");
types.setTypeParser(1082, (v) => v); // DATE -> string

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

app.use(cors({
  origin: [
    "https://wastenot-lake.vercel.app",
    "http://localhost:5173"
  ]
}));

app.use(express.json());

const http = require("node:http");
const { WebSocketServer } = require("ws");

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const {
  createSession,
  attachSocket,
  closeSession,
  hasSession,
} = require("./services/presage");


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
          typical shelf life and make it after the current date 10/11/2026.
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

app.get("/api/insights/weekly", async (req, res) => {
  res.json({
    summary: "Weekly insights are not available yet.",
    insights: [],
  });
});


app.post("/api/recommendations/recipes", async (req, res) => {
  try {
    // 1. Fetch the user's inventory from TigerData.
    const result = await pool.query(`
      SELECT
        id, name, quantity, unit, expiration_date,
        expiration_is_estimated, protein_g, carbs_g,
        fiber_g, sugar_g
      FROM food_items
      WHERE user_id = $1
      ORDER BY expiration_date ASC NULLS LAST
    `, ["demo-user"]);

    const inventory = result.rows.map((food) => ({
      id: Number(food.id),
      name: food.name,
      quantity: Number(food.quantity ?? 1),
      unit: food.unit ?? "item",
      expirationDate: food.expiration_date,
      expirationIsEstimated: food.expiration_is_estimated,
      proteinG: food.protein_g,
      carbsG: food.carbs_g,
      fiberG: food.fiber_g,
      sugarG: food.sugar_g
    }));

    if (inventory.length === 0) {
      return res.json({
        recipes: [],
        inventory: [],
        message: "Add foods to your inventory first."
      });
    }

    // 2. Generate recipes with Gemini.
    const { GoogleGenAI } = await import("@google/genai");

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });

    const today = new Date().toISOString().slice(0, 10);

    const prompt = `
You are WasteNot, an AI cooking assistant focused on
reducing food waste.

Today's date: ${today}

Available food inventory:
${JSON.stringify(inventory, null, 2)}

Generate up to 3 practical recipes using this inventory.

Rules:
- Prioritize usable foods expiring soon.
- Never assume expired or spoiled food is safe.
- Use actual inventory IDs in usesInventory.
- Do not exceed available ingredient quantities.
- Put missing ingredients in additionalIngredients.
- Include clear cooking instructions.
- Do not invent nutritional values or food inventory.
- Return fewer recipes if the inventory is limited.
- Do not assume receipt totals are recipe costs.

Return JSON only, with this structure:
{
  "recipes": [
    {
      "name": "Recipe name",
      "description": "Short description",
      "usesInventory": [
        {
          "foodId": 1,
          "quantity": 1,
          "unit": "item"
        }
      ],
      "additionalIngredients": ["salt"],
      "instructions": [
        "Prepare the ingredients.",
        "Cook until ready."
      ]
    }
  ]
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const parsed = JSON.parse(response.text);
    const recipes = Array.isArray(parsed.recipes)
      ? parsed.recipes
      : [];

    // 3. Save each generated recipe to TigerData.
    const savedRecipes = [];

    for (const recipe of recipes) {
      const saved = await pool.query(
        `INSERT INTO recipes (
          user_id,
          name,
          description,
          uses_inventory,
          additional_ingredients,
          instructions
        )
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
        RETURNING *`,
        [
          "demo-user",
          recipe.name,
          recipe.description ?? null,
          JSON.stringify(recipe.usesInventory ?? []),
          JSON.stringify(recipe.additionalIngredients ?? []),
          JSON.stringify(recipe.instructions ?? [])
        ]
      );

      savedRecipes.push(saved.rows[0]);
    }

    // 4. Return recipes in the format Health.jsx expects.
    res.json({
      recipes,
      inventory: inventory.map((food) => ({
        ...food,
        receiptLineTotal: null
      })),
      savedRecipes
    });

  } catch (error) {
    console.error("Recipe generation failed:", error);

    res.status(500).json({
      error: "Recipe generation failed. Please try again."
    });
  }
});

//vitals reading

app.post("/api/vitals/sessions", async (req, res) => {
  try {
    const session = await createSession();
    res.status(201).json(session);
  } catch (error) {
    console.error("Failed to create vitals session:", error);

    res.status(error.status || 500).json({
      error: error.message || "Could not start vitals measurement.",
    });
  }
});


app.delete("/api/vitals/sessions/:token", (req, res) => {
  const { token } = req.params;

  // Ending a session that has already ended is okay.
  closeSession(token);

  res.json({ success: true });
});




//Database initialization loaded

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, "http://localhost:3001");

  if (url.pathname !== "/api/vitals/stream") {
    socket.destroy();
    return;
  }

  const token = url.searchParams.get("token");

  if (!token || !hasSession(token)) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    attachSocket(token, ws);
  });
});

// Export the server for use in other modules.
module.exports = server;

// Vercel imports the exported server; local `npm start` needs to bind a port.
if (require.main === module) {
  const port = Number(process.env.PORT) || 3001;
  server.listen(port, () => {
    console.log(`WasteNot API running on port ${port}`);
  });
}
