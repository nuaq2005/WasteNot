import React from "react";

const items = [
  { name: "Milk", quantity: 1, unit: "carton", daysLeft: 2 },
  { name: "Chicken Breast", quantity: 2, unit: "pack", daysLeft: 3 },
  { name: "Spinach", quantity: 1, unit: "bag", daysLeft: 5 },
  { name: "Eggs", quantity: 10, unit: "pcs", daysLeft: 12 },
  { name: "Yogurt", quantity: 4, unit: "cup", daysLeft: 10 },
  { name: "Tomatoes", quantity: 6, unit: "pcs", daysLeft: 7 },
];

export default function CheckFridge() {
  const expireSoon = items
    .filter((i) => i.daysLeft <= 5)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  return (
    <div style={styles.page}>
      <h2>Check Fridge</h2>
      <p>TigerData placeholder: expire soon + food quantity will appear here.</p>

      <div style={styles.box}>
        <p>View items that are expiring soon and manage your fridge inventory.</p>
        <p><strong>Placeholder:</strong> TigerData will sync fridge data and track food quantity.</p>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Expire Soon</h3>
        {expireSoon.length === 0 && <p>Nothing is expiring soon.</p>}
        {expireSoon.map((i) => (
          <div key={i.name} style={styles.row}>
            <span>{i.name}</span>
            <span style={{ ...styles.badge, background: i.daysLeft <= 3 ? "#ffd6d6" : "#fff0c2" }}>
              {i.daysLeft} days left
            </span>
          </div>
        ))}
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Food Quantity</h3>
        {items.map((i) => (
          <div key={i.name} style={styles.row}>
            <span>{i.name}</span>
            <span>{i.quantity} {i.unit}</span>
          </div>
        ))}
        <p style={styles.total}>Total items: {items.length}</p>
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
  badge: { padding: "2px 10px", borderRadius: "10px", fontSize: "13px" },
  total: { marginTop: "12px", fontWeight: "bold" },
};