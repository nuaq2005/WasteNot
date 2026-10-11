// client/src/api.js

// API functions for interacting with the WasteNot backend changed for vercel
// client/src/api.js
const BASE = "";

export async function request(path, options = {}) {
  const isJsonString = typeof options.body === "string";

  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(isJsonString ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try { message = JSON.parse(text).error || text; } catch {}
    throw new Error(message || `API request failed: ${response.status}`);
  }

  return response.json();
}

export const getFoods = () => request("/api/foods");
export const getWeeklyInsights = () => request("/api/insights/weekly");
export const getRecipeRecommendations = () =>
  request("/api/recommendations/recipes", { method: "POST" });
export const getRecipeFavorites = () =>
  request("/api/recipe-recommendation-favorites");
export const saveRecipeFavorite = (favorite) =>
  request("/api/recipe-recommendation-favorites", {
    method: "POST",
    body: JSON.stringify(favorite),
  });
export const deleteRecipeFavorite = (id) =>
  request(`/api/recipe-recommendation-favorites/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
export const createVitalsSession = () =>
  request("/api/vitals/sessions", { method: "POST" });
export const stopVitalsSession = (token) =>
  request(`/api/vitals/sessions/${encodeURIComponent(token)}`, { method: "DELETE" });

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
