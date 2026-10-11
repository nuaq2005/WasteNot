// client/src/pages/ScanReceipt.jsx
import React, { useState } from "react";
import { scanReceipt, addFood } from "../api";

export default function ScanReceipt() {
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError(""); setMessage(""); setScanning(true);
    try {
      const data = await scanReceipt(file);
      setItems((data.items ?? []).map((i) => ({
        ...i,
        expiration_date: i.expiration_date ?? "",
        expiration_is_estimated: Boolean(i.expiration_date),
      })));
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }

  function updateItem(index, field, value) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value, 
      ...(field === "expiration_date" && { expiration_is_estimated: false }),
    } : it)));
  }

  async function saveAll() {
    setSaving(true); setError("");
    try {
      for (const item of items) {
        await addFood({
          name: item.name,
          quantity: Number(item.quantity) || 1,
          unit: item.unit,
          expiration_date: item.expiration_date || null,
          expiration_is_estimated: item.expiration_date ? item.expiration_is_estimated : false,
        });
      }
      setMessage(`Saved ${items.length} items to your fridge.`);
      setItems([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.page}>
      <h2>Scan Your Receipt</h2>

      <div style={styles.box}>
        <p>Upload a photo of your grocery receipt (JPG, PNG, or WebP).</p>
        <input type="file" accept="image/jpeg,image/png,image/webp"
               onChange={handleFile} style={{ marginTop: "10px" }} />
        {scanning && <p>Reading receipt with Gemini...</p>}
        {error && <p style={{ color: "crimson" }}>{error}</p>}
        {message && <p style={{ color: "green" }}>{message}</p>}
      </div>

      {items.length > 0 && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Review Items</h3>
          {items.map((item, i) => (
            <div key={i} style={{ ...styles.row, gap: "8px" }}>
              <input value={item.name} onChange={(e) => updateItem(i, "name", e.target.value)} />
              <input type="number" value={item.quantity} style={{ width: 60 }}
                     onChange={(e) => updateItem(i, "quantity", e.target.value)} />
              <input value={item.unit} style={{ width: 70 }}
                     onChange={(e) => updateItem(i, "unit", e.target.value)} />
              <input type="date" value={item.expiration_date}
                     onChange={(e) => updateItem(i, "expiration_date", e.target.value)} />
            </div>
          ))}
          <button onClick={saveAll} disabled={saving} style={{ marginTop: 12 }}>
            {saving ? "Saving..." : "Save to Fridge"}
          </button>
        </div>
      )}

      {/* Monthly Cost card: keep as placeholder, see note below */}
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