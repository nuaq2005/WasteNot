import { useEffect, useState } from "react";
import { deleteRecipeFavorite, getRecipeFavorites } from "../api";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(dateString) {
  if (!dateString) return null;
  const [year, month, day] = String(dateString).slice(0, 10).split("-").map(Number);
  const expiryDate = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((expiryDate - today) / DAY_MS);
}

function expirationLabel(days) {
  if (days === null) return "";
  if (days < 0) return ` · expired ${Math.abs(days)} days ago`;
  if (days === 0) return " · expires today";
  if (days === 1) return " · 1 day left";
  return ` · ${days} days left`;
}

export default function Favourites() {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getRecipeFavorites()
      .then(setFavorites)
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, []);

  async function removeFavorite(id) {
    setBusyId(id);
    setError("");
    try {
      await deleteRecipeFavorite(id);
      setFavorites((current) => current.filter((favorite) => favorite.id !== id));
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <p style={styles.eyebrow}>SAVED FROM GEMINI RECIPE IDEAS</p>
        <h2 style={styles.title}>Favourites</h2>
        <p style={styles.description}>Recipes are saved as generated, along with the inventory details shown when you saved them.</p>
      </header>

      {loading && <p style={styles.status}>Loading favourites…</p>}
      {error && <p role="alert" style={styles.error}>{error}</p>}
      {!loading && !error && favorites.length === 0 && (
        <p style={styles.status}>No favourites yet. Save a recipe with the heart in Health.</p>
      )}

      {!loading && favorites.map((favorite) => {
        const recipe = favorite.recipe;
        const inventoryById = new Map(
          (favorite.inventorySnapshot ?? []).map((food) => [Number(food.id), food])
        );
        return (
          <article key={favorite.id} style={styles.card}>
            <div style={styles.recipeHeading}>
              <h3 style={styles.recipeTitle}>{recipe.name}</h3>
              <button
                type="button"
                style={styles.heartButton}
                aria-label={`Remove ${recipe.name} from Favourites`}
                disabled={busyId === favorite.id}
                onClick={() => removeFavorite(favorite.id)}
              >
                {busyId === favorite.id ? "…" : "♥"}
              </button>
            </div>
            {recipe.description && <p style={styles.description}>{recipe.description}</p>}
            <h4 style={styles.subheading}>Uses from your inventory</h4>
            <ul style={styles.list}>
              {(recipe.usesInventory ?? []).map((used, index) => {
                const food = inventoryById.get(Number(used.foodId));
                if (!food) return <li key={`${used.foodId}-${index}`}>{used.quantity} {used.unit}</li>;
                const days = daysUntil(food.expirationDate);
                const price = food.receiptLineTotal == null
                  ? ""
                  : ` · receipt row $${Number(food.receiptLineTotal).toFixed(2)}`;
                return (
                  <li key={`${used.foodId}-${index}`}>
                    {used.quantity} {used.unit} {food.name}
                    {expirationLabel(days)}{price}
                  </li>
                );
              })}
            </ul>
            {(recipe.additionalIngredients ?? []).length > 0 && (
              <p><strong>Also needed:</strong> {recipe.additionalIngredients.join(", ")}</p>
            )}
            <h4 style={styles.subheading}>Steps</h4>
            <ol style={styles.list}>
              {(recipe.instructions ?? []).map((instruction, index) => (
                <li key={index}>{instruction}</li>
              ))}
            </ol>
          </article>
        );
      })}
    </div>
  );
}

const styles = {
  page: { textAlign: "left", maxWidth: "760px", margin: "auto", color: "#222" },
  header: { marginBottom: "20px" },
  eyebrow: { margin: "0 0 6px", color: "#756a80", fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em" },
  title: { margin: 0 },
  description: { color: "#666", margin: "8px 0" },
  status: { color: "#666" },
  error: { color: "crimson" },
  card: { background: "#fff", padding: "20px", borderRadius: "8px", border: "1px solid #e5e4e7", marginBottom: "16px" },
  recipeHeading: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
  recipeTitle: { margin: 0, fontSize: "18px" },
  heartButton: { border: "1px solid #e6a6b9", borderRadius: "999px", background: "#fff3f6", color: "#c13d68", cursor: "pointer", fontSize: "24px", lineHeight: 1, minWidth: "42px", minHeight: "42px" },
  subheading: { margin: "14px 0 6px" },
  list: { paddingLeft: "22px", margin: "6px 0", lineHeight: 1.6 },
};
