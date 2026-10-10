import React from "react";

const expiredItems = [
  { name: "Milk", date: "2026-10-12", daysLeft: 2 },
  { name: "Chicken Breast", date: "2026-10-13", daysLeft: 3 },
  { name: "Spinach", date: "2026-10-15", daysLeft: 5 },
  { name: "Yogurt", date: "2026-10-20", daysLeft: 10 },
];

const monthlyCost = {
  total: 286.4,
  categories: [
    { name: "Produce", amount: 82.5 },
    { name: "Meat & Seafood", amount: 96.9 },
    { name: "Dairy & Eggs", amount: 48.0 },
    { name: "Others", amount: 59.0 },
  ],
};

export default function ScanReceipt() {
  const max = Math.max(...monthlyCost.categories.map((c) => c.amount));

  return (
    <div style={styles.page}>
      <h2>Scan Your Receipt</h2>
      <p>Gemini API placeholder: monthly cost + expire dates will appear here.</p>

      <div style={styles.box}>
        <p>Upload or scan your grocery receipt to extract item names, prices, and expiry dates.</p>
        <p><strong>Placeholder:</strong> Gemini API will process receipt images and return structured data.</p>
        <input type="file" accept="image/*" style={{ marginTop: "10px" }} />
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Expired Date</h3>
        {expiredItems.map((item) => (
          <div key={item.name} style={styles.row}>
            <span>{item.name}</span>
            <span>
              {item.date}
              <span style={{ ...styles.badge, background: item.daysLeft <= 3 ? "#ffd6d6" : "#d9f2e0" }}>
                {item.daysLeft} days
              </span>
            </span>
          </div>
        ))}
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Monthly Cost</h3>
        <p style={styles.total}>${monthlyCost.total.toFixed(2)}</p>
        {monthlyCost.categories.map((c) => (
          <div key={c.name} style={{ marginBottom: "10px" }}>
            <div style={styles.row}>
              <span>{c.name}</span>
              <span>${c.amount.toFixed(2)}</span>
            </div>
            <div style={styles.barBg}>
              <div style={{ ...styles.barFill, width: `${(c.amount / max) * 100}%` }} />
            </div>
          </div>
        ))}
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
  row: { display: "flex", justifyContent: "space-between", padding: "6px 0" },
  badge: { marginLeft: "10px", padding: "2px 8px", borderRadius: "10px", fontSize: "13px" },
  total: { fontSize: "32px", fontWeight: "bold", margin: "0 0 12px" },
  barBg: { background: "#eef2f7", borderRadius: "6px", height: "8px" },
  barFill: { background: "#a7c7e7", borderRadius: "6px", height: "8px" },
};