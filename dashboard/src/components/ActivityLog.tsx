import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../api";
import {
  KeyIcon,
  ClockIcon,
  MapPinIcon,
  ClipboardIcon,
  RefreshIcon,
  SearchIcon,
  LogOutIcon,
  ActivityIcon,
  CheckIcon,
  ShieldIcon,
  UserIcon,
} from "./Icons";

interface ActivityRow {
  id: number;
  event_type: string;
  user_email: string | null;
  user_name:  string | null;
  user_role:  string | null;
  session_id: string | null;
  latitude:   string | null;
  longitude:  string | null;
  accuracy_m: string | null;
  ip_address: string | null;
  metadata:   Record<string, unknown> | null;
  created_at: string;
}

// ── Event type config ─────────────────────────────────────────────────────
const EVENT_META: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
  login:           { icon: <KeyIcon size={13} color="#38bdf8" />,       label: "Login",           color: "#38bdf8", bg: "rgba(56,189,248,0.10)" },
  punch_in:        { icon: <ClockIcon size={13} color="#22c55e" />,     label: "Punch In",        color: "#22c55e", bg: "rgba(34,197,94,0.10)"  },
  punch_out:       { icon: <LogOutIcon size={13} color="#f87171" />,    label: "Punch Out",       color: "#f87171", bg: "rgba(248,113,113,0.10)"},
  location_update: { icon: <MapPinIcon size={13} color="#a78bfa" />,    label: "Location Update", color: "#a78bfa", bg: "rgba(167,139,250,0.10)"},
  task_assigned:   { icon: <ClipboardIcon size={13} color="#f59e0b" />, label: "Task Assigned",   color: "#f59e0b", bg: "rgba(245,158,11,0.10)" },
  task_started:    { icon: <ActivityIcon size={13} color="#38bdf8" />,  label: "Task Started",   color: "#38bdf8", bg: "rgba(56,189,248,0.10)" },
  task_completed:  { icon: <CheckIcon size={13} color="#22c55e" />,     label: "Task Completed",  color: "#22c55e", bg: "rgba(34,197,94,0.10)"  },
  consent_ack:     { icon: <ShieldIcon size={13} color="#94a3b8" />,    label: "Consent",         color: "#94a3b8", bg: "rgba(148,163,184,0.08)"},
  user_created:    { icon: <UserIcon size={13} color="#f59e0b" />,      label: "User Created",    color: "#f59e0b", bg: "rgba(245,158,11,0.10)" },
};

const ROLE_COLOR: Record<string, string> = {
  admin:   "#f59e0b",
  manager: "#38bdf8",
  worker:  "#22c55e",
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function minsAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// Pull a readable summary out of the metadata blob
function metaSummary(type: string, meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  switch (type) {
    case "login":
      return meta.success === false ? "⚠ Failed login attempt" : `Login at ${meta.loginTime ? new Date(meta.loginTime as string).toLocaleTimeString() : ""}`;
    case "punch_in":
      return `Method: ${meta.clockMethod ?? "gps"} · interval ${meta.updateIntervalSec ?? "?"}s`;
    case "punch_out":
      return meta.durationMinutes != null ? `Shift: ${meta.durationMinutes} min` : "";
    case "location_update":
      return `${meta.updateType ?? ""} · delayed: ${meta.isDelayed ? "yes" : "no"}`;
    case "task_assigned":
      return `"${meta.taskTitle}" → ${meta.assigneeName ?? meta.assignedTo}`;
    case "task_completed":
      return `"${meta.taskTitle}"`;
    default:
      return "";
  }
}

// ── Filter bar ────────────────────────────────────────────────────────────
const EVENT_TYPES = ["all", "login", "punch_in", "punch_out", "location_update", "task_assigned", "task_completed"];
const ROLE_TYPES  = ["all", "admin", "manager", "worker"];

// ═══════════════════════════════════════════════════════════════════════════
export function ActivityLog() {
  const [rows, setRows]           = useState<ActivityRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState("all");
  const [roleFilter, setRoleFilter]   = useState("all");
  const [search, setSearch]           = useState("");
  const [expanded, setExpanded]       = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await (api as any).getActivity(300);
      const list = res?.logs ?? res?.activities ?? (Array.isArray(res) ? res : []);
      setRows(Array.isArray(list) ? list : []);
      setError(null);
    } catch (e: any) {
      setRows([]);
      setError(e?.message ?? "Could not load activity log");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 10_000); return () => clearInterval(id); }, [load]);

  const safeRows = Array.isArray(rows) ? rows : [];
  const filtered = safeRows.filter(r => {
    if (!r) return false;
    if (eventFilter !== "all" && r.event_type !== eventFilter) return false;
    if (roleFilter  !== "all" && r.user_role  !== roleFilter)  return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !r.user_email?.toLowerCase().includes(q) &&
        !r.user_name?.toLowerCase().includes(q)  &&
        !r.event_type.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  // Summary counts
  const loginCount   = safeRows.filter(r => r.event_type === "login"    && r.metadata?.success !== false).length;
  const punchInCount = safeRows.filter(r => r.event_type === "punch_in").length;
  const locCount     = safeRows.filter(r => r.event_type === "location_update").length;

  const selectStyle: React.CSSProperties = {
    background: "rgba(2,6,23,0.7)", border: "1px solid rgba(51,65,85,0.6)",
    borderRadius: 6, color: "#94a3b8", fontSize: 11, padding: "5px 8px", outline: "none",
  };

  return (
    <div style={{ height: "100%", minHeight: 450, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* ── Summary strip ── */}
      <div style={{ display: "flex", gap: 10, padding: "10px 14px", borderBottom: "1px solid rgba(51,65,85,0.35)", flexShrink: 0, flexWrap: "wrap" }}>
        <SummaryPill icon={<KeyIcon size={14} color="#38bdf8" />} label="Logins"    value={loginCount}   color="#38bdf8" />
        <SummaryPill icon={<ClockIcon size={14} color="#22c55e" />} label="Punch-ins" value={punchInCount} color="#22c55e" />
        <SummaryPill icon={<MapPinIcon size={14} color="#a78bfa" />} label="Locations" value={locCount}     color="#a78bfa" />
        <SummaryPill icon={<ClipboardIcon size={14} color="#f59e0b" />} label="Total"     value={rows.length}  color="#f59e0b" />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            onClick={load}
            style={{
              background: "transparent",
              border: "1px solid rgba(51,65,85,0.5)",
              borderRadius: 6,
              color: "#94a3b8",
              fontSize: 11,
              padding: "5px 10px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <RefreshIcon size={12} color="#94a3b8" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: "1px solid rgba(51,65,85,0.3)", flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 120 }}>
          <SearchIcon size={13} color="#64748b" style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)" }} />
          <input
            placeholder="Search name or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...selectStyle, width: "100%", paddingLeft: 26, boxSizing: "border-box" }}
          />
        </div>
        <select value={eventFilter} onChange={e => setEventFilter(e.target.value)} style={selectStyle}>
          {EVENT_TYPES.map(t => <option key={t} value={t}>{t === "all" ? "All events" : EVENT_META[t]?.label ?? t}</option>)}
        </select>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={selectStyle}>
          {ROLE_TYPES.map(r => <option key={r} value={r}>{r === "all" ? "All roles" : r}</option>)}
        </select>
      </div>

      {/* ── Log rows ── */}
      <div style={{ flex: 1, minHeight: 300, overflowY: "auto", padding: "6px 0" }}>
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "10px 12px" }}>
            {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height: 48, borderRadius: 8 }} />)}
          </div>
        )}

        {error && (
          <div className="alert-strip error" style={{ margin: 12 }}>⚠ {error}</div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 32, color: "#334155", fontSize: 13 }}>
            No activity records found.
          </div>
        )}

        <AnimatePresence initial={false}>
          {filtered.map((row, i) => {
            const meta  = EVENT_META[row.event_type] ?? { icon: <ActivityIcon size={13} color="#64748b" />, label: row.event_type, color: "#64748b", bg: "rgba(100,116,139,0.08)" };
            const isExp = expanded === row.id;
            const summary = metaSummary(row.event_type, row.metadata);

            return (
              <motion.div
                key={row.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.015, 0.3) }}
                onClick={() => setExpanded(isExp ? null : row.id)}
                style={{
                  padding: "8px 14px",
                  borderBottom: "1px solid rgba(51,65,85,0.2)",
                  cursor: "pointer",
                  background: isExp ? "rgba(37,99,235,0.06)" : "transparent",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => { if (!isExp) (e.currentTarget as HTMLDivElement).style.background = "rgba(51,65,85,0.1)"; }}
                onMouseLeave={e => { if (!isExp) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
              >
                {/* Main row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {/* Event badge */}
                  <span style={{ fontSize: 13, flexShrink: 0, width: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>{meta.icon}</span>

                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                    color: meta.color, background: meta.bg, whiteSpace: "nowrap",
                    border: `1px solid ${meta.color}30`, letterSpacing: "0.05em", flexShrink: 0,
                  }}>
                    {meta.label}
                  </span>

                  {/* User */}
                  <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "nowrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {row.user_name ?? row.user_email ?? "Unknown"}
                      </span>
                      {row.user_role && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 99, color: ROLE_COLOR[row.user_role] ?? "#64748b", background: `${ROLE_COLOR[row.user_role] ?? "#64748b"}15`, border: `1px solid ${ROLE_COLOR[row.user_role] ?? "#64748b"}30`, flexShrink: 0 }}>
                          {row.user_role}
                        </span>
                      )}
                    </div>
                    {summary && (
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</div>
                    )}
                  </div>

                  {/* Time */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 11, color: "#475569", whiteSpace: "nowrap" }}>{minsAgo(row.created_at)}</div>
                  </div>
                </div>

                {/* Expanded detail */}
                <AnimatePresence>
                  {isExp && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      style={{ overflow: "hidden" }}
                    >
                      <div style={{ marginTop: 10, padding: "10px 12px", background: "rgba(2,6,23,0.6)", borderRadius: 8, border: "1px solid rgba(51,65,85,0.4)", fontSize: 11 }}>
                        <DetailRow label="Time"    value={fmtTime(row.created_at)} />
                        {row.user_email  && <DetailRow label="Email"   value={row.user_email} />}
                        {row.ip_address  && <DetailRow label="IP"      value={row.ip_address} />}
                        {row.session_id  && <DetailRow label="Session" value={row.session_id.slice(0,8) + "…"} />}
                        {row.latitude    && <DetailRow label="GPS"     value={`${Number(row.latitude).toFixed(5)}, ${Number(row.longitude).toFixed(5)} (±${row.accuracy_m ? Math.round(Number(row.accuracy_m)) : "?"}m)`} />}
                        {row.metadata && Object.keys(row.metadata).length > 0 && (
                          <div style={{ marginTop: 6, padding: "6px 8px", background: "rgba(51,65,85,0.2)", borderRadius: 6 }}>
                            <div style={{ color: "#475569", fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>Metadata</div>
                            {Object.entries(row.metadata).map(([k, v]) => (
                              <DetailRow key={k} label={k} value={String(v)} />
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SummaryPill({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(15,23,42,0.6)", border: "1px solid rgba(51,65,85,0.4)", borderRadius: 8, padding: "4px 10px" }}>
      <span style={{ display: "flex", alignItems: "center" }}>{icon}</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0", borderBottom: "1px solid rgba(51,65,85,0.2)" }}>
      <span style={{ color: "#64748b", fontWeight: 600, textTransform: "capitalize" }}>{label}</span>
      <span style={{ color: "#e2e8f0", textAlign: "right", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}
