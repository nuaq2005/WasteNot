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

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const isHtml = contentType.includes("text/html");
    throw new Error(isHtml
      ? `The API returned a web page instead of JSON (${response.status}). Check that the backend is running on port 3001 and restart the client dev server.`
      : `The API returned an unexpected response (${response.status}).`);
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `API request failed: ${response.status}`);
  }
  return data;
}

export const getFoods = () => request("/api/foods");
export const getWeeklyInsights = () => request("/api/insights/weekly");
export const getRecipeRecommendations = () =>
  request("/api/recommendations/recipes", { method: "POST" });
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
