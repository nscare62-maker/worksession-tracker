import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../api";
import {
  EyeIcon,
  EyeOffIcon,
  TrashIcon,
  CopyIcon,
  CheckIcon,
  SearchIcon,
  RefreshIcon,
  LockIcon,
  UserIcon,
  UsersIcon,
  KeyIcon,
} from "./Icons";

interface Credential {
  id: string;
  user_id: string;
  email: string;
  plain_password: string;
  role: string;
  full_name: string;
  team_name: string | null;
  created_by_email: string | null;
  created_by_role: string | null;
  created_at: string;
}

const ROLE_COLOR: Record<string, { color: string; bg: string; border: string }> = {
  admin:   { color: "#f59e0b", bg: "rgba(245,158,11,0.10)",  border: "rgba(245,158,11,0.30)"  },
  manager: { color: "#38bdf8", bg: "rgba(56,189,248,0.10)",  border: "rgba(56,189,248,0.30)"  },
  worker:  { color: "#22c55e", bg: "rgba(34,197,94,0.10)",   border: "rgba(34,197,94,0.30)"   },
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function RoleBadge({ role }: { role: string }) {
  const s = ROLE_COLOR[role] ?? ROLE_COLOR.worker;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
      color: s.color, background: s.bg, border: `1px solid ${s.border}`,
      textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap",
    }}>
      {role === "worker" ? "Employee" : role}
    </span>
  );
}

export function CredentialsPanel({ refreshKey }: { refreshKey?: number } = {}) {
  const [rows, setRows]         = useState<Credential[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [visiblePw, setVisiblePw]   = useState<Set<string>>(new Set());
  const [copied, setCopied]         = useState<string | null>(null);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [confirmId, setConfirmId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getCredentials();
      const list = res?.credentials ?? (Array.isArray(res) ? res : []);
      setRows(Array.isArray(list) ? list : []);
      setError(null);
    } catch (e: any) {
      setRows([]);
      setError(e?.message ?? "Could not load credentials");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  function togglePw(id: string) {
    setVisiblePw(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function copyRow(row: Credential) {
    const text = `${row.full_name}\nEmail: ${row.email}\nPassword: ${row.plain_password}\nRole: ${row.role}${row.team_name ? `\nTeam: ${row.team_name}` : ""}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(row.id);
      setTimeout(() => setCopied(null), 1800);
    });
  }

  function copyAll() {
    const text = filtered.map(r =>
      `${r.full_name.padEnd(20)} ${r.role.padEnd(9)} ${r.email.padEnd(30)} ${r.plain_password}`
    ).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied("all");
      setTimeout(() => setCopied(null), 1800);
    });
  }

  async function handleDelete(row: Credential) {
    if (confirmId !== row.user_id) {
      setConfirmId(row.user_id);
      setTimeout(() => setConfirmId(c => c === row.user_id ? null : c), 4000);
      return;
    }
    setConfirmId(null);
    setDeleting(row.user_id);
    try {
      await api.deleteUser(row.user_id);
      setRows(prev => prev.filter(r => r.user_id !== row.user_id));
    } catch (e: any) {
      setError(e.message ?? "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  const safeRows = Array.isArray(rows) ? rows : [];
  const filtered = safeRows.filter(r => {
    if (!r) return false;
    if (roleFilter !== "all" && r.role !== roleFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.email.toLowerCase().includes(q) && !r.full_name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const managerCount  = safeRows.filter(r => r.role === "manager").length;
  const employeeCount = safeRows.filter(r => r.role === "worker").length;

  const selectStyle: React.CSSProperties = {
    background: "rgba(2,6,23,0.7)", border: "1px solid rgba(51,65,85,0.6)",
    borderRadius: 6, color: "#94a3b8", fontSize: 11, padding: "6px 10px", outline: "none",
  };

  return (
    <div style={{ height: "100%", minHeight: 450, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header strip */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(51,65,85,0.35)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 10 }}>
            <SummaryChip icon={<UserIcon size={14} color="#38bdf8" />} label="Managers" value={managerCount} color="#38bdf8" />
            <SummaryChip icon={<UsersIcon size={14} color="#22c55e" />} label="Employees" value={employeeCount} color="#22c55e" />
            <SummaryChip icon={<KeyIcon size={14} color="#f59e0b" />} label="Total" value={rows.length} color="#f59e0b" />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={load}
              style={{
                ...selectStyle,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 600,
              }}
              title="Refresh credentials"
            >
              <RefreshIcon size={13} color="#94a3b8" />
              <span>Refresh</span>
            </button>
            <button
              onClick={copyAll}
              style={{
                background: copied === "all" ? "rgba(34,197,94,0.15)" : "rgba(37,99,235,0.15)",
                border: `1px solid ${copied === "all" ? "rgba(34,197,94,0.4)" : "rgba(37,99,235,0.4)"}`,
                borderRadius: 6,
                color: copied === "all" ? "#22c55e" : "#38bdf8",
                fontSize: 11,
                padding: "6px 12px",
                cursor: "pointer",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.15s",
              }}
            >
              {copied === "all" ? (
                <>
                  <CheckIcon size={13} color="#22c55e" />
                  <span>Copied All</span>
                </>
              ) : (
                <>
                  <CopyIcon size={13} color="#38bdf8" />
                  <span>Copy All</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <SearchIcon
              size={14}
              color="#64748b"
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}
            />
            <input
              placeholder="Search name or email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...selectStyle, width: "100%", paddingLeft: 30, boxSizing: "border-box" }}
            />
          </div>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={selectStyle}>
            <option value="all">All roles</option>
            <option value="manager">Managers</option>
            <option value="worker">Employees</option>
          </select>
        </div>
      </div>

      {/* Table header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 120px 80px 32px 32px 70px",
        gap: 8, padding: "8px 14px",
        fontSize: 10, fontWeight: 700, color: "#64748b",
        letterSpacing: "0.08em", textTransform: "uppercase",
        borderBottom: "1px solid rgba(51,65,85,0.3)", flexShrink: 0,
      }}>
        <span>Name / Team</span>
        <span>Email</span>
        <span>Password</span>
        <span>Role</span>
        <span />
        <span />
        <span style={{ textAlign: "right" }}>Action</span>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px" }}>
            {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 48, borderRadius: 8 }} />)}
          </div>
        )}

        {error && (
          <div className="alert-strip error" style={{ margin: 12 }}>{error}</div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 16px", color: "#64748b", fontSize: 13 }}>
            <div style={{ display: "inline-flex", padding: 12, borderRadius: "50%", background: "rgba(51,65,85,0.2)", marginBottom: 12 }}>
              <LockIcon size={24} color="#94a3b8" />
            </div>
            <div>No credentials found. Add a manager or employee to generate credentials.</div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {filtered.map((row, i) => {
            const pwVisible  = visiblePw.has(row.id);
            const isCopied   = copied === row.id;
            const isDeleting = deleting === row.user_id;
            const isConfirm  = confirmId === row.user_id;

            return (
              <motion.div
                key={row.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 120px 80px 32px 32px 70px",
                  gap: 8, padding: "10px 14px",
                  borderBottom: "1px solid rgba(51,65,85,0.2)",
                  alignItems: "center",
                  transition: "background 0.15s",
                  background: isDeleting ? "rgba(239,68,68,0.06)" : "transparent",
                }}
                onMouseEnter={e => { if (!isDeleting) (e.currentTarget as HTMLDivElement).style.background = "rgba(37,99,235,0.05)"; }}
                onMouseLeave={e => { if (!isDeleting) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
              >
                {/* Name + team */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.full_name}
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
                    {row.team_name ?? "No team"} · by {row.created_by_email?.split("@")[0] ?? "admin"}
                  </div>
                  <div style={{ fontSize: 10, color: "#475569" }}>{fmtTime(row.created_at)}</div>
                </div>

                {/* Email */}
                <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.email}
                </div>

                {/* Password */}
                <div style={{
                  fontFamily: "monospace",
                  fontSize: pwVisible ? 12 : 14,
                  color: pwVisible ? "#22c55e" : "#64748b",
                  letterSpacing: pwVisible ? "0.04em" : "0.2em",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {pwVisible ? row.plain_password : "••••••••"}
                </div>

                {/* Role badge */}
                <div><RoleBadge role={row.role} /></div>

                {/* Show/hide password button */}
                <button
                  type="button"
                  onClick={() => togglePw(row.id)}
                  title={pwVisible ? "Hide password" : "Show password"}
                  style={{
                    background: pwVisible ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${pwVisible ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)"}`,
                    borderRadius: 6,
                    cursor: "pointer",
                    color: pwVisible ? "#22c55e" : "#94a3b8",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    padding: 0,
                    transition: "all 0.15s",
                  }}
                >
                  {pwVisible ? <EyeOffIcon size={14} color="#22c55e" /> : <EyeIcon size={14} color="#94a3b8" />}
                </button>

                {/* Copy button */}
                <button
                  type="button"
                  onClick={() => copyRow(row)}
                  title="Copy credentials"
                  style={{
                    background: isCopied ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${isCopied ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.08)"}`,
                    borderRadius: 6,
                    cursor: "pointer",
                    color: isCopied ? "#22c55e" : "#94a3b8",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    padding: 0,
                    transition: "all 0.15s",
                  }}
                >
                  {isCopied ? <CheckIcon size={13} color="#22c55e" /> : <CopyIcon size={13} color="#94a3b8" />}
                </button>

                {/* Delete button */}
                <div style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => handleDelete(row)}
                    disabled={isDeleting}
                    title={isConfirm ? "Click again to confirm delete" : "Delete account"}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "5px 8px",
                      borderRadius: 6,
                      border: `1px solid ${isConfirm ? "rgba(239,68,68,0.7)" : "rgba(239,68,68,0.25)"}`,
                      background: isConfirm ? "rgba(239,68,68,0.25)" : "rgba(239,68,68,0.08)",
                      color: isConfirm ? "#fca5a5" : "#ef4444",
                      cursor: isDeleting ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all 0.15s",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <TrashIcon size={12} color={isConfirm ? "#fca5a5" : "#ef4444"} />
                    <span>{isDeleting ? "..." : isConfirm ? "Confirm" : "Delete"}</span>
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Footer note */}
      <div style={{
        padding: "8px 14px", borderTop: "1px solid rgba(51,65,85,0.3)",
        fontSize: 10, color: "#64748b", flexShrink: 0,
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <LockIcon size={12} color="#64748b" />
        <span>Visible to Admin only · Encrypted credentials vault · Deleting an account revokes portal access</span>
      </div>
    </div>
  );
}

function SummaryChip({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: "rgba(15,23,42,0.65)", border: "1px solid rgba(51,65,85,0.4)",
      borderRadius: 8, padding: "5px 12px",
    }}>
      <div style={{ display: "flex", alignItems: "center" }}>{icon}</div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}
