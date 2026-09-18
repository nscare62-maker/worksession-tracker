import Constants from "expo-constants";
import { QueuedLocationUpdate } from "../types";

const API_BASE_URL: string = Constants.expoConfig?.extra?.apiBaseUrl ?? "http://localhost:4000";

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return body;
}

export const api = {
  login: (email: string, password: string) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  getConsentStatus: () => request("/auth/consent"),
  acknowledgeConsent: (policyTextHash: string) =>
    request("/auth/consent", { method: "POST", body: JSON.stringify({ policyTextHash }) }),

  punchIn: (clockMethod: "gps" | "manual_no_location") =>
    request("/sessions/start", { method: "POST", body: JSON.stringify({ clockMethod }) }),

  punchOut: (sessionId: string) => request(`/sessions/${sessionId}/end`, { method: "POST" }),

  getMyActiveSession: () => request("/sessions/mine/active"),

  postLocationUpdate: (
    update: QueuedLocationUpdate & { updateType: "interval" | "distance" | "manual_ping" }
  ) => request("/locations", { method: "POST", body: JSON.stringify(update) }),

  postLocationBatch: (updates: QueuedLocationUpdate[]) =>
    request("/locations/batch", { method: "POST", body: JSON.stringify({ updates }) }),
};
