// client/src/api.js
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const getFoods = () => request("/api/foods");
export const getWeeklyInsights = () => request("/api/insights/weekly");
export const getRecipeRecommendations = () =>
  request("/api/recommendations/recipes", { method: "POST" });
export const createVitalsSession = () =>
  request("/api/vitals/sessions", { method: "POST" });
export const stopVitalsSession = (token) =>
  fetch(`${BASE}/api/vitals/sessions/${encodeURIComponent(token)}`, { method: "DELETE" });

export function getVitalsWebSocketUrl(token) {
  const url = new URL(BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/vitals/stream";
  url.search = new URLSearchParams({ token }).toString();
  return url.toString();
}

export const addFood = (food) =>
  request("/api/foods", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(food),
  });

export const scanReceipt = (file) => {
  const form = new FormData();
  form.append("receipt", file); // must match upload.single("receipt")
  return request("/api/scan-receipt", { method: "POST", body: form });
};
