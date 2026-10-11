// client/src/pages/CheckFridge.jsx
import React, { useEffect, useState } from "react";
import { getFoods } from "../api";

function daysLeft(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

export default function CheckFridge() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getFoods()
      .then((rows) =>
        setItems(rows.map((r) => ({ ...r, daysLeft: daysLeft(r.expiration_date) })))
      )
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const expireSoon = items
    .filter((i) => i.daysLeft !== null && i.daysLeft <= 5)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  if (loading) return <p>Loading fridge...</p>;
  if (error) return <p style={{ color: "crimson" }}>Error: {error}</p>;

  return (
    <div style={styles.page}>
      <h2>Check Fridge</h2>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Expire Soon</h3>
        {expireSoon.length === 0 && <p>Nothing is expiring soon.</p>}
        {expireSoon.map((i) => (
          <div key={i.id} style={styles.row}>
            <span>{i.name}</span>
            <span style={{ ...styles.badge, background: i.daysLeft <= 3 ? "#ffd6d6" : "#fff0c2" }}>
              {i.daysLeft < 0 ? "Expired" : `${i.daysLeft} days left`}
              {i.expiration_is_estimated && " (est.)"}
            </span>
          </div>
        ))}
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Food Quantity</h3>
        {items.map((i) => (
          <div key={i.id} style={styles.row}>
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