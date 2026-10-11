import { useEffect, useState } from "react";
import { getFoods, getRecipeRecommendations, getWeeklyInsights } from "../api";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(dateString) {
  const [year, month, day] = dateString.slice(0, 10).split("-").map(Number);
  const expiryDate = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((expiryDate - today) / DAY_MS);
}

function expirationLabel(days) {
  if (days < 0) return `Expired ${Math.abs(days)} days ago`;
  if (days === 0) return "Expires today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

export default function Health() {
  const [expiringFoods, setExpiringFoods] = useState([]);
  const [period, setPeriod] = useState(null);
  const [loadingFoods, setLoadingFoods] = useState(true);
  const [foodsError, setFoodsError] = useState("");
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationInventory, setRecommendationInventory] = useState([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [recommendationError, setRecommendationError] = useState("");

  useEffect(() => {
    getWeeklyInsights()
      .then((insights) => {
        setExpiringFoods(insights.expiringFoods ?? []);
        setPeriod(insights.period ?? null);
      })
      .catch(() => getFoods().then((foods) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        setExpiringFoods(
          foods
            .filter((food) => food.expiration_date)
            .map((food) => ({ ...food, expiryDay: new Date(`${food.expiration_date.slice(0, 10)}T00:00:00`) }))
            .filter((food) => (food.expiryDay - today) / DAY_MS <= 7)
            .sort((a, b) => a.expiryDay - b.expiryDay)
        );
      }).catch((error) => setFoodsError(error.message)))
      .finally(() => setLoadingFoods(false));
  }, []);

  async function generateRecommendations() {
    setLoadingRecommendations(true);
    setRecommendationError("");
    try {
      const result = await getRecipeRecommendations();
      setRecommendations(result.recipes ?? []);
      setRecommendationInventory(result.inventory ?? []);
    } catch (error) {
      setRecommendationError(error.message);
    } finally {
      setLoadingRecommendations(false);
    }
  }

  const inventoryById = new Map(recommendationInventory.map((food) => [food.id, food]));

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>WEEKLY OVERVIEW</p>
          <h2>Food insights</h2>
          <p style={styles.description}>
            See foods that need using soon and get recipe ideas from your saved inventory.
          </p>
        </div>
        {period && (
          <span style={styles.connectionBadge}>
            {String(period.start).slice(0, 10)} – {String(period.end).slice(0, 10)}
          </span>
        )}
      </header>

      <section aria-labelledby="expiring-foods-title" style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <p style={styles.eyebrow}>FROM YOUR CURRENT INVENTORY</p>
            <h3 id="expiring-foods-title" style={styles.cardTitle}>Expiring foods</h3>
          </div>
          <span style={styles.sourceBadge}>Expired + 7 days</span>
        </div>

        {loadingFoods && <p style={styles.status}>Loading inventory…</p>}
        {!loadingFoods && foodsError && (
          <p role="alert" style={styles.error}>Could not load expiring foods: {foodsError}</p>
        )}
        {!loadingFoods && !foodsError && expiringFoods.length === 0 && (
          <p style={styles.status}>No foods are expired or expiring within the next 7 days.</p>
        )}
        {!loadingFoods && !foodsError && expiringFoods.length > 0 && (
          <ul style={styles.foodList}>
            {expiringFoods.map((food) => (
              <li key={food.id ?? `${food.name}-${food.expiration_date}`} style={styles.foodRow}>
                <span>
                  <strong>{food.name}</strong>
                  <span style={styles.quantity}>{food.quantity} {food.unit}</span>
                </span>
                <span style={{
                  ...styles.expiration,
                  ...(daysUntil(food.expiration_date) < 0 ? styles.expired : {}),
                }}>
                  {expirationLabel(daysUntil(food.expiration_date))}
                  {food.expiration_is_estimated ? " · estimated" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recipe-recommendations-title" style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <p style={styles.eyebrow}>GEMINI · USE YOUR RECEIPT AND INVENTORY</p>
            <h3 id="recipe-recommendations-title" style={styles.cardTitle}>Recipe ideas</h3>
          </div>
          <button type="button" onClick={generateRecommendations} disabled={loadingRecommendations}>
            {loadingRecommendations ? "Generating…" : recommendations.length ? "Refresh ideas" : "Generate recipe ideas"}
          </button>
        </div>
        <p style={styles.status}>
          Ideas consider food expiry, available quantity, and receipt line totals. A line total is the amount paid for that receipt row, not the cost of a recipe.
        </p>
        {loadingRecommendations && <p style={styles.status}>Asking Gemini for ideas…</p>}
        {recommendationError && <p role="alert" style={styles.error}>{recommendationError}</p>}
        {!loadingRecommendations && !recommendationError && recommendations.length === 0 && (
          <p style={styles.status}>Generate ideas when you’re ready. Recommendations use current saved inventory and are not saved or deducted automatically.</p>
        )}
        {!loadingRecommendations && recommendations.map((recipe, index) => (
          <article key={`${recipe.name}-${index}`} style={styles.recipe}>
            <h4 style={styles.recipeTitle}>{recipe.name}</h4>
            {recipe.description && <p style={styles.recipeDescription}>{recipe.description}</p>}
            <h5 style={styles.subheading}>Uses from your inventory</h5>
            <ul style={styles.compactList}>
              {recipe.usesInventory.map((used, usedIndex) => {
                const food = inventoryById.get(used.foodId);
                if (!food) return null;
                return (
                  <li key={`${used.foodId}-${usedIndex}`}>
                    {used.quantity} {used.unit} {food.name}
                    {food.expirationDate && ` · ${expirationLabel(daysUntil(food.expirationDate))}`}
                    {food.receiptLineTotal != null && ` · receipt row $${food.receiptLineTotal.toFixed(2)}`}
                  </li>
                );
              })}
            </ul>
            {recipe.additionalIngredients.length > 0 && (
              <p><strong>Also needed:</strong> {recipe.additionalIngredients.join(", ")}</p>
            )}
            <h5 style={styles.subheading}>Steps</h5>
            <ol style={styles.compactList}>
              {recipe.instructions.map((instruction, instructionIndex) => (
                <li key={instructionIndex}>{instruction}</li>
              ))}
            </ol>
          </article>
        ))}
      </section>
    </div>
  );
}

const styles = {
  page: { textAlign: "left", maxWidth: "760px", margin: "auto", color: "#222" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", marginBottom: "20px" },
  eyebrow: { margin: "0 0 6px", color: "#756a80", fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em" },
  description: { marginTop: "8px", color: "#666", maxWidth: "580px" },
  connectionBadge: { border: "1px solid #e5c98c", borderRadius: "999px", background: "#fff8e7", color: "#775915", padding: "6px 10px", fontSize: "13px", whiteSpace: "nowrap" },
  card: { background: "#fff", padding: "20px", borderRadius: "8px", border: "1px solid #e5e4e7", marginBottom: "20px" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "16px" },
  cardTitle: { margin: 0 },
  sourceBadge: { borderRadius: "999px", background: "#f1e8fa", color: "#62338a", padding: "5px 9px", fontSize: "12px" },
  status: { color: "#666", margin: "8px 0" },
  error: { color: "crimson", margin: "8px 0" },
  foodList: { listStyle: "none", padding: 0, margin: 0 },
  foodRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", padding: "12px 0", borderTop: "1px solid #eef2f7" },
  quantity: { display: "block", color: "#777", fontSize: "14px" },
  expiration: { borderRadius: "999px", background: "#fff0c2", padding: "4px 10px", fontSize: "13px" },
  expired: { background: "#ffd6d6", color: "#8d2222" },
  recipe: { borderTop: "1px solid #eef2f7", paddingTop: "14px", marginTop: "14px" },
  recipeTitle: { margin: "0 0 6px", fontSize: "18px" },
  recipeDescription: { color: "#555" },
  subheading: { margin: "14px 0 6px" },
  compactList: { paddingLeft: "22px", margin: "6px 0", lineHeight: 1.6 },
};
