import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { WorkerPosition } from "../types";
import { deriveStatus } from "../status";
import { SearchIcon, TrashIcon, CheckIcon } from "./Icons";

const AVATAR_COLORS = ["blue", "green", "purple", "cyan", "amber"] as const;
function avatarColor(name: string): string {
  const n = name || "W";
  return AVATAR_COLORS[n.charCodeAt(0) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  if (!name) return "W";
  return name.split(" ").map(n => n[0] ?? "").filter(Boolean).join("").toUpperCase().slice(0, 2) || "W";
}

export function WorkerList({
  positions,
  allWorkers,
  selectedWorkerId,
  onSelect,
  onDelete,
}: {
  positions: WorkerPosition[];
  allWorkers: { id: string; full_name: string; team_name: string | null; active_session_id: string | null; role: string }[];
  selectedWorkerId: string | null;
  onSelect: (workerId: string) => void;
  onDelete?: (workerId: string, name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const positionsByWorker = useMemo(() => {
    const map = new Map<string, WorkerPosition>();
    for (const p of positions) map.set(p.worker_id, p);
    return map;
  }, [positions]);

  const teams = useMemo(
    () => Array.from(new Set(allWorkers.map((w) => w.team_name).filter(Boolean))) as string[],
    [allWorkers]
  );

  const filtered = allWorkers.filter((w) => {
    const name = w.full_name || "Worker";
    if (query && !name.toLowerCase().includes(query.toLowerCase())) return false;
    if (teamFilter !== "all" && w.team_name !== teamFilter) return false;
    if (statusFilter === "active" && !w.active_session_id) return false;
    if (statusFilter === "inactive" && w.active_session_id) return false;
    return true;
  });

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "7px 10px 7px 30px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "var(--text-primary)",
    fontSize: 12,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
    fontFamily: "inherit",
  };

  const selectStyle: React.CSSProperties = {
    flex: 1,
    padding: "6px 8px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "var(--text-primary)",
    fontSize: 11,
    outline: "none",
    fontFamily: "inherit",
  };

  function handleDeleteClick(e: React.MouseEvent, w: { id: string; full_name: string }) {
    e.stopPropagation();
    if (confirmDeleteId !== w.id) {
      setConfirmDeleteId(w.id);
      setTimeout(() => setConfirmDeleteId(c => c === w.id ? null : c), 4000);
      return;
    }
    setConfirmDeleteId(null);
    onDelete?.(w.id, w.full_name);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-sidebar)" }}>
      {/* Search & filters */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0, borderBottom: "1px solid var(--border)" }}
      >
        <div style={{ position: "relative" }}>
          <SearchIcon
            size={13}
            color="#64748b"
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}
          />
          <input
            placeholder="Search workers..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={selectStyle}>
            <option value="all">All teams</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={selectStyle}>
            <option value="all">All statuses</option>
            <option value="active">Clocked in</option>
            <option value="inactive">Clocked out</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>
            {filtered.length} worker{filtered.length !== 1 ? "s" : ""}
          </span>
          {filtered.filter((w) => w.active_session_id).length > 0 && (
            <span style={{ fontSize: 10, background: "var(--green-dim)", color: "var(--green)", border: "1px solid rgba(0,214,143,0.25)", borderRadius: 99, padding: "1px 7px", fontWeight: 700 }}>
              ● {filtered.filter((w) => w.active_session_id).length} live
            </span>
          )}
        </div>
      </motion.div>

      {/* Worker list */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        <AnimatePresence initial={false}>
          {filtered.length === 0 && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ padding: "28px 16px", textAlign: "center", color: "#64748b", fontSize: 13 }}
            >
              No workers match your filters.
            </motion.div>
          )}

          {filtered.map((w, i) => {
            const pos = positionsByWorker.get(w.id);
            const status = pos ? deriveStatus(pos, !w.active_session_id) : "ended";
            const isSelected = selectedWorkerId === w.id;
            const isLive = status === "live";
            const isConfirm = confirmDeleteId === w.id;
            const displayName = w.full_name || "Worker";

            return (
              <motion.div
                key={w.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.25) }}
                onClick={() => onSelect(w.id)}
                className={`worker-row${isSelected ? " selected" : ""}`}
              >
                {/* Avatar with status dot */}
                <div className={`worker-avatar ${avatarColor(displayName)}`} style={{ position: "relative" }}>
                  {initials(displayName)}
                  <span className={`status-dot ${isLive ? "online" : w.active_session_id ? "break" : "offline"}`} />
                </div>

                <div className="worker-row-info">
                  <div className="worker-row-name">{displayName}</div>
                  <div className="worker-row-sub">
                    <span style={{ color: isLive ? "var(--green)" : w.active_session_id ? "var(--amber)" : "var(--text-muted)" }}>
                      {isLive ? "● On Site" : w.active_session_id ? "● On Break" : "Offline"}
                    </span>
                    {w.team_name && <> · {w.team_name}</>}
                  </div>
                </div>

                {pos?.captured_at && (
                  <div className="worker-row-time">
                    {new Date(pos.captured_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}

                {onDelete ? (
                  <button
                    type="button"
                    onClick={(e) => handleDeleteClick(e, w)}
                    title={isConfirm ? "Click again to confirm delete" : "Delete worker"}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: `1px solid ${isConfirm ? "rgba(239,68,68,0.7)" : "rgba(239,68,68,0.2)"}`,
                      background: isConfirm ? "rgba(239,68,68,0.25)" : "transparent",
                      color: isConfirm ? "var(--red)" : "rgba(239,68,68,0.5)",
                      cursor: "pointer",
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    {isConfirm ? (
                      <>
                        <CheckIcon size={11} color="#ef4444" />
                        <span>Confirm</span>
                      </>
                    ) : (
                      <TrashIcon size={12} color="currentColor" />
                    )}
                  </button>
                ) : (
                  <span className="worker-row-arrow">›</span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
