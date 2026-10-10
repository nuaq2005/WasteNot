import React from "react";

const recipes = [
  { name: "Spinach Chicken Stir-fry", uses: "Chicken, Spinach", time: "20 min", kcal: 420 },
  { name: "Tomato Egg Scramble", uses: "Eggs, Tomatoes", time: "10 min", kcal: 280 },
  { name: "Yogurt Fruit Bowl", uses: "Yogurt", time: "5 min", kcal: 190 },
];

const nutrition = [
  { name: "Calories", value: 1450, goal: 2000, unit: "kcal" },
  { name: "Protein", value: 78, goal: 100, unit: "g" },
  { name: "Carbs", value: 160, goal: 250, unit: "g" },
  { name: "Fat", value: 48, goal: 65, unit: "g" },
];

export default function Health() {
  return (
    <div style={styles.page}>
      <h2>Health</h2>
      <p>Presage SDK + Snowflake placeholder: recipe recommendation + nutrition info will appear here.</p>

      <div style={styles.box}>
        <p>Get personalized recipe recommendations and nutrition insights based on your fridge data.</p>
        <p><strong>Placeholder:</strong> Presage SDK will analyze health data; Snowflake powers recipe analytics.</p>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Food Recipe</h3>
        {recipes.map((r) => (
          <div key={r.name} style={styles.recipe}>
            <strong>{r.name}</strong>
            <div style={styles.meta}>
              Uses: {r.uses} · {r.time} · {r.kcal} kcal
            </div>
          </div>
        ))}
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Today's Nutrition</h3>
        {nutrition.map((n) => {
          const pct = Math.min((n.value / n.goal) * 100, 100);
          return (
            <div key={n.name} style={{ marginBottom: "12px" }}>
              <div style={styles.row}>
                <span>{n.name}</span>
                <span>{n.value} / {n.goal} {n.unit}</span>
              </div>
              <div style={styles.barBg}>
                <div style={{ ...styles.barFill, width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  page: { textAlign: "left", maxWidth: "700px", margin: "auto", color: "#222" },
  box: {
    background: "#f4f8fb",
    padding: "20px",
    borderRadius: "8px",
    border: "1px solid #cfe0f5",
    marginBottom: "20px",
  },
  card: {
    background: "#fff",
    padding: "20px",
    borderRadius: "8px",
    border: "1px solid #e5e4e7",
    marginBottom: "20px",
  },
  cardTitle: { margin: "0 0 12px" },
  recipe: { padding: "10px 0", borderBottom: "1px solid #eef2f7" },
  meta: { fontSize: "14px", color: "#666", marginTop: "4px" },
  row: { display: "flex", justifyContent: "space-between", padding: "4px 0" },
  barBg: { background: "#eef2f7", borderRadius: "6px", height: "8px" },
  barFill: { background: "#a7c7e7", borderRadius: "6px", height: "8px" },
};