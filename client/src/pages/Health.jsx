import { useEffect, useState } from "react";
import { getFoods, getWeeklyInsights } from "../api";

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
  const [topNutritionCategories, setTopNutritionCategories] = useState([]);
  const [period, setPeriod] = useState(null);
  const [loadingNutrition, setLoadingNutrition] = useState(true);
  const [loadingFoods, setLoadingFoods] = useState(true);
  const [nutritionError, setNutritionError] = useState("");
  const [foodsError, setFoodsError] = useState("");

  useEffect(() => {
    getWeeklyInsights()
      .then((insights) => {
        setExpiringFoods(insights.expiringFoods);
        setTopNutritionCategories(insights.topNutritionCategories);
        setPeriod(insights.period);
      })
      .catch((requestError) => {
        setNutritionError(requestError.message);
        // Expiration visibility remains available if Snowflake is unavailable.
        return getFoods().then((foods) => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          setExpiringFoods(
            foods
              .map((food) => {
                if (!food.expiration_date) return { ...food, expiryDay: null };
                const [year, month, day] = food.expiration_date.slice(0, 10).split("-").map(Number);
                return { ...food, expiryDay: new Date(year, month - 1, day) };
              })
              .filter((food) => food.expiryDay && (food.expiryDay - today) / DAY_MS <= 7)
              .sort((a, b) => a.expiryDay - b.expiryDay)
          );
        }).catch((foodsRequestError) => setFoodsError(foodsRequestError.message));
      })
      .finally(() => {
        setLoadingNutrition(false);
        setLoadingFoods(false);
      });
  }, []);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>WEEKLY OVERVIEW</p>
          <h2>Food insights</h2>
          <p style={styles.description}>
            See foods that need using soon and estimated nutrition totals from
            recipes marked as made.
          </p>
        </div>
        {period && (
          <span style={styles.connectionBadge}>
            {period.start} – {period.end}
          </span>
        )}
      </header>

      <section aria-labelledby="recipe-nutrition-title" style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <p style={styles.eyebrow}>RECIPE USAGE · TODAY + PRIOR 7 DAYS</p>
            <h3 id="recipe-nutrition-title" style={styles.cardTitle}>
              Top nutrition categories
            </h3>
          </div>
          <span style={styles.sourceBadge}>AI estimates · Snowflake Cortex</span>
        </div>
        {loadingNutrition && <p style={styles.status}>Loading nutrition insights…</p>}
        {!loadingNutrition && nutritionError && (
          <p role="alert" style={styles.error}>Nutrition insights unavailable: {nutritionError}</p>
        )}
        {!loadingNutrition && !nutritionError && topNutritionCategories.length === 0 && (
          <p style={styles.status}>No made recipes have nutrition estimates in this period.</p>
        )}
        {!loadingNutrition && !nutritionError && topNutritionCategories.length > 0 && (
          <ul style={styles.foodList}>
            {topNutritionCategories.map((item) => (
              <li key={item.category} style={styles.foodRow}>
                <strong>{item.category}</strong>
                <span style={styles.quantity}>{item.amountGrams.toLocaleString()} g · estimated</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="expiring-foods-title" style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <p style={styles.eyebrow}>FROM YOUR CURRENT INVENTORY</p>
            <h3 id="expiring-foods-title" style={styles.cardTitle}>
              Expiring foods
            </h3>
          </div>
          <span style={styles.sourceBadge}>Expired + 7 days</span>
        </div>

        {loadingFoods && <p style={styles.status}>Loading inventory…</p>}
        {!loadingFoods && foodsError && (
          <p role="alert" style={styles.error}>
            Could not load expiring foods: {foodsError}
          </p>
        )}
        {!loadingFoods && !foodsError && expiringFoods.length === 0 && (
          <p style={styles.status}>
            No foods are expired or expiring within the next 7 days.
          </p>
        )}
        {!loadingFoods && !foodsError && expiringFoods.length > 0 && (
          <ul style={styles.foodList}>
            {expiringFoods.map((food) => (
              <li
                key={food.id ?? `${food.name}-${food.expiration_date}`}
                style={styles.foodRow}
              >
                <span>
                  <strong>{food.name}</strong>
                  <span style={styles.quantity}>
                    {food.quantity} {food.unit}
                  </span>
                </span>
                <span
                  style={{
                    ...styles.expiration,
                    ...(daysUntil(food.expiration_date) < 0 ? styles.expired : {}),
                  }}
                >
                  {expirationLabel(daysUntil(food.expiration_date))}
                  {food.expiration_is_estimated ? " · estimated" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const styles = {
  page: { textAlign: "left", maxWidth: "760px", margin: "auto", color: "#222" },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "16px",
    flexWrap: "wrap",
    marginBottom: "20px",
  },
  eyebrow: {
    margin: "0 0 6px",
    color: "#756a80",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.08em",
  },
  description: { marginTop: "8px", color: "#666", maxWidth: "580px" },
  connectionBadge: {
    border: "1px solid #e5c98c",
    borderRadius: "999px",
    background: "#fff8e7",
    color: "#775915",
    padding: "6px 10px",
    fontSize: "13px",
    whiteSpace: "nowrap",
  },
  card: {
    background: "#fff",
    padding: "20px",
    borderRadius: "8px",
    border: "1px solid #e5e4e7",
    marginBottom: "20px",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
    marginBottom: "16px",
  },
  cardTitle: { margin: 0 },
  sourceBadge: {
    borderRadius: "999px",
    background: "#f1e8fa",
    color: "#62338a",
    padding: "5px 9px",
    fontSize: "12px",
  },
  emptyState: {
    border: "1px dashed #d8c6e7",
    borderRadius: "8px",
    background: "#fcf9ff",
    padding: "16px",
    color: "#51445c",
  },
  status: { color: "#666", margin: "8px 0" },
  error: { color: "crimson", margin: "8px 0" },
  foodList: { listStyle: "none", padding: 0, margin: 0 },
  foodRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
    padding: "12px 0",
    borderTop: "1px solid #eef2f7",
  },
  quantity: { display: "block", color: "#777", fontSize: "14px" },
  expiration: {
    borderRadius: "999px",
    background: "#fff0c2",
    padding: "4px 10px",
    fontSize: "13px",
  },
  expired: { background: "#ffd6d6", color: "#8d2222" },
};
