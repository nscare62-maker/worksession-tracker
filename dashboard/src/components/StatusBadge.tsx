import React from "react";
import { motion } from "framer-motion";
import { LiveStatus } from "../types";
import { STATUS_COLORS, STATUS_LABELS } from "../status";

const STATUS_BG: Record<LiveStatus, string> = {
  live:    "var(--green-dim)",
  delayed: "var(--amber-dim)",
  stale:   "rgba(234,179,8,0.10)",
  offline: "rgba(100,116,139,0.10)",
  ended:   "var(--blue-dim)",
};

const STATUS_BORDER: Record<LiveStatus, string> = {
  live:    "rgba(0,214,143,0.35)",
  delayed: "rgba(245,158,11,0.3)",
  stale:   "rgba(234,179,8,0.25)",
  offline: "rgba(100,116,139,0.25)",
  ended:   "rgba(59,130,246,0.3)",
};

export function StatusBadge({ status }: { status: LiveStatus }) {
  const color = STATUS_COLORS[status];
  const isLive = status === "live";

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        padding: "3px 9px",
        borderRadius: 99,
        color,
        background: STATUS_BG[status],
        border: `1px solid ${STATUS_BORDER[status]}`,
      }}
    >
      {/* Animated dot */}
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          backgroundColor: color,
          display: "inline-block",
          flexShrink: 0,
          // live: pulsing ring; delayed: gentle pulse; others: static
          animation: isLive
            ? "status-live-ring 1.8s ease-in-out infinite"
            : status === "delayed"
            ? "pulse-dot 1.5s ease-in-out infinite"
            : "none",
        }}
      />
      {STATUS_LABELS[status]}
    </motion.span>
  );
}
