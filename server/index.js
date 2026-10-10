
// Initialize the database
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

app.use(cors({ origin: "http://localhost:5173" }));
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
      name, quantity, unit, expiration_date,
      protein_g, carbs_g, fiber_g, sugar_g
    } = req.body;

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Food name is required" });
    }

    const result = await pool.query(
      `INSERT INTO food_items
       (name, quantity, unit, expiration_date,
        protein_g, carbs_g, fiber_g, sugar_g)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        name, quantity ?? 1, unit ?? "item",
        expiration_date || null,
        protein_g ?? null, carbs_g ?? null,
        fiber_g ?? null, sugar_g ?? null
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
            "unit": "bag"
          }
        ]
      }

      Include only identifiable grocery food items.
      Exclude tax, discounts, totals, and non-food products.
      Do not invent missing items or quantities.
      If a product name is unclear, mark it as uncertain.
      A receipt does not provide expiration dates or nutrition facts.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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

app.listen(process.env.PORT || 3001, () => {
  console.log("WasteNot API running on port 3001");
});
