// API base: on Netlify (any device), use /api prefix (Netlify Function).
// Locally, fall back to http://localhost:4000.
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://worksession-tracker.netlify.app/api";

let authToken: string | null = localStorage.getItem("worksession.token");

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) localStorage.setItem("worksession.token", token);
  else localStorage.removeItem("worksession.token");
}
export function getAuthToken() { return authToken; }

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
  if (!res.ok) throw new Error(body.error ?? body.message ?? `Request failed: ${res.status}`);
  return body;
}

export const api = {
  // ── Auth ────────────────────────────────────────────────────────────────
  login: (email: string, password: string) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  getConsentStatus: () => request("/auth/consent"),

  acknowledgeConsent: (policyTextHash: string) =>
    request("/auth/consent", { method: "POST", body: JSON.stringify({ policyTextHash }) }),

  // ── Sessions ─────────────────────────────────────────────────────────────
  punchIn: (clockMethod: "gps" | "manual_no_location" = "gps") =>
    request("/sessions/start", { method: "POST", body: JSON.stringify({ clockMethod }) }),

  punchOut: (sessionId: string) =>
    request(`/sessions/${sessionId}/end`, { method: "POST" }),

  getMyActiveSession: () => request("/sessions/mine/active"),

  getSessionRoute: (sessionId: string) => request(`/sessions/${sessionId}/route`),

  // ── Location ─────────────────────────────────────────────────────────────
  postLocationUpdate: (input: {
    sessionId: string;
    latitude: number;
    longitude: number;
    accuracyM?: number;
    speedMps?: number;
    headingDeg?: number;
    capturedAt: string;
    updateType: string;
  }) => request("/locations", { method: "POST", body: JSON.stringify(input) }),

  // ── Manager ──────────────────────────────────────────────────────────────
  getLivePositions: () => request("/manager/positions/live"),

  listWorkers: (params: { q?: string; status?: string } = {}) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request(`/manager/workers${qs ? `?${qs}` : ""}`);
  },

  listWorkerSessions: (workerId: string) => request(`/manager/workers/${workerId}/sessions`),

  createUser: (input: { email: string; password: string; fullName: string; role: "worker" | "manager"; teamId?: string }) =>
    request("/manager/users", { method: "POST", body: JSON.stringify(input) }),

  listTeams: () => request("/manager/teams"),

  // ── Tasks ─────────────────────────────────────────────────────────────────
  getTasks: () => request("/tasks/mine"),

  createTask: (input: { title: string; description?: string; assignedTo: string }) =>
    request("/tasks", { method: "POST", body: JSON.stringify(input) }),

  startTask: (taskId: string) =>
    request(`/tasks/${taskId}/start`, { method: "POST" }),

  completeTask: (taskId: string, report: string) =>
    request(`/tasks/${taskId}/complete`, { method: "POST", body: JSON.stringify({ report }) }),

  // ── Activity log (admin only) ─────────────────────────────────────────────
  getActivity: (limit = 200) => request(`/activity?limit=${limit}`),

  // ── Credentials (admin only) ──────────────────────────────────────────────
  getCredentials: () => request("/manager/credentials"),

  deleteUser: (userId: string) =>
    request(`/manager/users/${userId}`, { method: "DELETE" }),
};
