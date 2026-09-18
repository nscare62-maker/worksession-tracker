import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as LocateMod from "leaflet.locatecontrol";
const locateFactory: (opts: unknown) => { addTo(map: L.Map): void } =
  (LocateMod as any).locate;

import { RoutePoint, WorkerPosition } from "../types";
import { deriveStatus, STATUS_COLORS } from "../status";
import { MapPinIcon, RouteIcon, ClockIcon, NavigationIcon } from "./Icons";

// ── Leaflet default-icon fix (Vite asset paths) ───────────────────────────
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ── Glow colours per status ───────────────────────────────────────────────
const GLOW: Record<string, string> = {
  live:    "rgba(22,163,74,0.65)",
  delayed: "rgba(245,158,11,0.55)",
  stale:   "rgba(234,179,8,0.45)",
  offline: "rgba(107,114,128,0.35)",
  ended:   "rgba(59,130,246,0.45)",
};

const isMobileDevice = () => typeof window !== "undefined" && window.innerWidth <= 768;

// ── Build animated marker HTML ────────────────────────────────────────────
function markerHtml(
  color: string,
  glow: string,
  isLive: boolean,
  isManager: boolean,
  label: string,
): string {
  const pulse = isLive
    ? `<span style="position:absolute;inset:0;border-radius:${isManager ? "4px" : "50%"};border:2px solid ${color};opacity:0;animation:pulse-ring 1.5s ease-out infinite;"></span>
       <span style="position:absolute;inset:0;border-radius:${isManager ? "4px" : "50%"};border:2px solid ${color};opacity:0;animation:pulse-ring 1.5s ease-out infinite;animation-delay:0.7s;"></span>`
    : "";

  const dot = isManager
    ? `<span style="
        display:block;width:13px;height:13px;
        background:${color};
        border:2.5px solid rgba(255,255,255,0.95);
        box-shadow:0 0 12px 4px ${glow},0 2px 8px rgba(0,0,0,0.55);
        transform:rotate(45deg);
        position:relative;z-index:1;
        animation:${isLive ? "pulse-dot 2s ease-in-out infinite" : "none"};
      "></span>`
    : `<span style="
        display:block;width:13px;height:13px;border-radius:50%;
        background:${color};
        border:2.5px solid rgba(255,255,255,0.95);
        box-shadow:0 0 12px 4px ${glow},0 2px 8px rgba(0,0,0,0.55);
        position:relative;z-index:1;
        animation:${isLive ? "pulse-dot 2s ease-in-out infinite" : "none"};
      "></span>`;

  return `<div title="${label}" style="position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;">${pulse}${dot}</div>`;
}

// ── Inject animated route + stats CSS once ───────────────────────────────
function ensureRouteCSS() {
  if (document.getElementById("ws-route-css")) return;
  const s = document.createElement("style");
  s.id = "ws-route-css";
  s.textContent = `
    @keyframes dash-march { to { stroke-dashoffset: -24; } }
    .ws-route-march { animation: dash-march 0.6s linear infinite; }
    .ws-time-label {
      background: rgba(2,6,23,0.82);
      border: 1px solid rgba(56,189,248,0.4);
      color: #38bdf8;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      white-space: nowrap;
      backdrop-filter: blur(6px);
      pointer-events: none;
    }
  `;
  document.head.appendChild(s);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function minsAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)  return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

function pickLabelPoints(pts: RoutePoint[]): Set<number> {
  const s = new Set<number>();
  let lastMs = 0;
  pts.forEach((p, idx) => {
    const ms = new Date(p.captured_at).getTime();
    if (ms - lastMs >= 5 * 60 * 1000) {
      s.add(idx);
      lastMs = ms;
    }
  });
  return s;
}

function haversineM(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface RouteStats {
  totalDistanceM: number;
  elapsedMs: number;
  avgSpeedKph: number;
  pointCount: number;
  isLive: boolean;
}

function computeRouteStats(route: RoutePoint[]): RouteStats | null {
  if (route.length < 2) return null;

  let totalM = 0;
  for (let i = 1; i < route.length; i++) {
    totalM += haversineM(
      Number(route[i - 1].latitude), Number(route[i - 1].longitude),
      Number(route[i].latitude),     Number(route[i].longitude),
    );
  }

  const first = new Date(route[0].captured_at).getTime();
  const last  = new Date(route[route.length - 1].captured_at).getTime();
  const elapsedMs = last - first;
  const elapsedHours = elapsedMs / 3_600_000;
  const avgSpeedKph = elapsedHours > 0 ? (totalM / 1000) / elapsedHours : 0;
  const isLive = Date.now() - last < 3 * 60 * 1000;

  return { totalDistanceM: totalM, elapsedMs, avgSpeedKph, pointCount: route.length, isLive };
}

function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function fmtDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ───────────────────────────────────────────────────────────────────────────
export function MapView({
  positions,
  selectedWorkerId,
  route,
  onWorkerClick,
}: {
  positions: WorkerPosition[];
  selectedWorkerId: string | null;
  route: RoutePoint[] | null;
  onWorkerClick?: (workerId: string) => void;
}) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<L.Map | null>(null);
  const markersRef    = useRef<Record<string, L.Marker>>({});
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef     = useRef(false);

  // Mobile scroll & interaction state
  const [mapInteract, setMapInteract] = useState(!isMobileDevice());
  const [statsDismissed, setStatsDismissed] = useState(false);
  const [statsMinimized, setStatsMinimized] = useState(isMobileDevice());

  // ── INIT MAP ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if ((container as any)._leaflet_id) delete (container as any)._leaflet_id;
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

    ensureRouteCSS();

    const isMob = isMobileDevice();
    const map = L.map(container, {
      zoomControl: false,
      dragging: !isMob, // On mobile, dragging is off by default to allow smooth page scroll!
    }).setView([20.5937, 78.9629], 5);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    locateFactory({
      position: "bottomright",
      flyTo: true,
      setView: "untilPanOrZoom",
      drawCircle: true,
      drawMarker: true,
      strings: { title: "Show my current location" },
      locateOptions: { enableHighAccuracy: true, watch: true, maxZoom: 16 },
      circleStyle: { color: "#2563eb", fillColor: "#38bdf8", fillOpacity: 0.08, weight: 1.5 },
      markerStyle: { color: "#38bdf8", fillColor: "#2563eb", fillOpacity: 0.9, radius: 8, weight: 2 },
    }).addTo(map);

    routeLayerRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;
    fittedRef.current = false;

    return () => {
      map.remove();
      mapRef.current     = null;
      markersRef.current = {};
      routeLayerRef.current = null;
    };
  }, []);

  // ── Reset route stats visibility when route or worker changes ─────────────
  useEffect(() => {
    setStatsDismissed(false);
    if (isMobileDevice()) {
      setStatsMinimized(true);
    }
  }, [route, selectedWorkerId]);

  // ── Pan to selected worker marker cleanly ────────────────────────────────
  useEffect(() => {
    if (!selectedWorkerId || !mapRef.current) return;
    const targetPos = positions.find(p => p.worker_id === selectedWorkerId);
    if (targetPos && targetPos.latitude != null && targetPos.longitude != null) {
      const wLat = Number(targetPos.latitude);
      const wLng = Number(targetPos.longitude);
      if (!isNaN(wLat) && !isNaN(wLng)) {
        if (!route || route.length <= 1) {
          mapRef.current.setView([wLat, wLng], 15, { animate: true });
        }
      }
    }
  }, [selectedWorkerId, positions, route]);

  // ── WORKER / MANAGER MARKERS ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();

    for (const pos of positions) {
      const role = pos.role || "worker";
      if (role !== "worker" && role !== "manager") continue;
      if (pos.latitude == null || pos.longitude == null) continue;
      const numLat = Number(pos.latitude);
      const numLng = Number(pos.longitude);
      if (isNaN(numLat) || isNaN(numLng)) continue;
      if (Math.abs(numLat) > 90 || Math.abs(numLng) > 180) continue;

      seen.add(pos.worker_id);
      const status    = deriveStatus(pos, false);
      const color     = STATUS_COLORS[status];
      const glow      = GLOW[status] ?? GLOW.stale;
      const isLive    = status === "live";
      const isManager = role === "manager";
      const selected  = pos.worker_id === selectedWorkerId;
      const sz: [number, number] = selected ? [44, 44] : [36, 36];
      const displayName = pos.full_name || (pos as any).worker_name || "Worker";

      const icon = L.divIcon({
        className: "",
        html: markerHtml(color, glow, isLive, isManager, displayName),
        iconSize: sz,
        iconAnchor: [sz[0] / 2, sz[1] / 2],
      });

      const roleTag = isManager ? "Manager" : "Employee";
      const popupHtml =
        `<div style="font-weight:700;font-size:13px;margin-bottom:3px;color:#f8fafc">${displayName}</div>` +
        `<div style="font-size:11px;color:#94a3b8;margin-bottom:3px">${roleTag} • ${pos.team_name ?? "General"}</div>` +
        `<div style="font-size:11px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.06em">${status}</div>` +
        (pos.captured_at
          ? `<div style="font-size:10px;color:#64748b;margin-top:3px">Updated ${minsAgo(pos.captured_at)}<br>${fmtTime(pos.captured_at)}</div>`
          : "");

      let marker = markersRef.current[pos.worker_id];
      if (!marker) {
        marker = L.marker([numLat, numLng], {
          icon,
          zIndexOffset: selected ? 1000 : isManager ? 500 : 0,
        }).bindPopup(popupHtml).addTo(map);
        if (onWorkerClick) {
          const wid = pos.worker_id;
          marker.on("click", () => onWorkerClick(wid));
        }
        markersRef.current[pos.worker_id] = marker;
      } else {
        marker.setLatLng([numLat, numLng]);
        marker.setIcon(icon);
        marker.setZIndexOffset(selected ? 1000 : isManager ? 500 : 0);
        marker.getPopup()?.setContent(popupHtml);
      }
      if (selected) {
        marker.openPopup();
      }
    }

    // Auto-fit first batch of markers
    const pts = positions
      .filter(p => p.latitude != null && p.longitude != null &&
                   !isNaN(Number(p.latitude)) && !isNaN(Number(p.longitude)))
      .map(p => [Number(p.latitude), Number(p.longitude)] as [number, number]);
    if (!fittedRef.current && pts.length > 0) {
      map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 14 });
      fittedRef.current = true;
    }

    // Remove stale markers
    for (const wid of Object.keys(markersRef.current)) {
      if (!seen.has(wid)) {
        markersRef.current[wid].remove();
        delete markersRef.current[wid];
      }
    }
  }, [positions, selectedWorkerId, onWorkerClick]);

  // ── ROUTE WITH TIMESTAMPED WAYPOINTS ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = routeLayerRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    const validPoints = (route ?? []).filter(
      p => p.latitude != null && p.longitude != null &&
           !isNaN(Number(p.latitude)) && !isNaN(Number(p.longitude))
    );
    const pts = validPoints.map(
      p => [Number(p.latitude), Number(p.longitude)] as [number, number]
    );

    if (pts.length === 0) return;

    const lastPt = route![route!.length - 1];
    const sessionIsLive = Date.now() - new Date(lastPt.captured_at).getTime() < 3 * 60 * 1000;

    // Base glow polyline
    L.polyline(pts, {
      color: "#1d4ed8", weight: 6, opacity: 0.35,
      lineCap: "round", lineJoin: "round",
    }).addTo(layerGroup);

    // Animated marching-ants overlay
    (L.polyline as any)(pts, {
      color: "#38bdf8", weight: 3, opacity: 0.95,
      lineCap: "round", dashArray: "10 14",
      className: "ws-route-march",
    }).addTo(layerGroup);

    // Start marker (green)
    L.circleMarker(pts[0], {
      radius: 9, color: "#166534", fillColor: "#22c55e", fillOpacity: 1, weight: 2.5,
    }).bindTooltip(
      `<b>Start Point</b><br>${fmtTime(route![0].captured_at)}`,
      { permanent: false, className: "ws-time-label" }
    ).addTo(layerGroup);

    // End / latest marker
    const selectedWorker = positions.find(p => p.worker_id === selectedWorkerId);
    const workerName = selectedWorker?.full_name || "Worker";
    const endLabel = sessionIsLive ? "Live Location" : "Last Recorded Location";
    const endColor  = sessionIsLive ? "#38bdf8" : "#ef4444";
    const endFill   = sessionIsLive ? "#0ea5e9" : "#ef4444";
    const endBorder = sessionIsLive ? "#0c4a6e" : "#7f1d1d";
    L.circleMarker(pts[pts.length - 1], {
      radius: 10, color: endBorder, fillColor: endFill, fillOpacity: 1, weight: 2.5,
    }).bindTooltip(
      `<div style="font-weight:700;color:#f8fafc">${workerName}</div>` +
      `<div style="font-size:10px;color:${sessionIsLive ? "#22c55e" : "#fca5a5"};font-weight:600">${endLabel}</div>` +
      `<div style="font-size:10px;color:#94a3b8">${fmtTime(lastPt.captured_at)} (${minsAgo(lastPt.captured_at)})</div>`,
      { permanent: true, direction: "top", className: "ws-time-label" }
    ).addTo(layerGroup);

    // Intermediate timestamped waypoint dots
    const labelSet = pickLabelPoints(route!);
    route!.forEach((point, idx) => {
      if (idx === 0 || idx === route!.length - 1) return;
      if (!labelSet.has(idx)) return;
      L.circleMarker([Number(point.latitude), Number(point.longitude)], {
        radius: 5, color: "#38bdf8", fillColor: "#0f172a", fillOpacity: 1, weight: 2,
      }).bindTooltip(
        `${fmtTime(point.captured_at)}<br><span style="color:#94a3b8">${minsAgo(point.captured_at)}</span>`,
        { permanent: false, direction: "top", className: "ws-time-label" }
      ).addTo(layerGroup);
    });

    // Fit route bounds with generous padding so the marker pin is never hidden under overlays!
    map.fitBounds(L.latLngBounds(pts), {
      paddingTopLeft: [50, 60],
      paddingBottomRight: [50, statsMinimized ? 70 : 180],
      maxZoom: 16,
    });
  }, [route, selectedWorkerId, statsMinimized]);

  // ── DERIVE STATS ──────────────────────────────────────────────────────────
  const liveCount = positions.filter(
    p => p.latitude != null && deriveStatus(p, false) === "live"
  ).length;

  const routeStats = route && route.length >= 2 ? computeRouteStats(route) : null;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>

      {/* ── Top-left HUD ─────────────────────────────────────────────────── */}
      <div style={{
        position: "absolute", top: 10, left: 10, zIndex: 1000,
        display: "flex", flexDirection: "column", gap: 5, pointerEvents: "none",
      }}>
        <div style={hudBadge}>● Live Tracking</div>

        {liveCount > 0 && (
          <div style={{ ...hudBadge, color: "#22c55e", borderColor: "rgba(34,197,94,0.3)" }}>
            ⚡ {liveCount} live
          </div>
        )}

        {/* Legend */}
        <div style={{ ...hudBadge, display: "flex", gap: 8, marginTop: 1, fontSize: 10 }}>
          <span>
            <span style={{ display: "inline-block", width: 8, height: 8, background: "#38bdf8", transform: "rotate(45deg)", marginRight: 4 }} />
            Manager
          </span>
          <span>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#22c55e", marginRight: 4 }} />
            Employee
          </span>
        </div>
      </div>

      {/* ── Mobile Touch Mode Toggle (Scroll Mode vs Pan Map) ────────────── */}
      {isMobileDevice() && (
        <button
          type="button"
          onClick={() => {
            const next = !mapInteract;
            setMapInteract(next);
            if (mapRef.current) {
              if (next) {
                mapRef.current.dragging.enable();
              } else {
                mapRef.current.dragging.disable();
              }
            }
          }}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 1000,
            background: mapInteract ? "rgba(37, 99, 235, 0.95)" : "rgba(15, 23, 42, 0.85)",
            border: `1px solid ${mapInteract ? "#60a5fa" : "rgba(148, 163, 184, 0.3)"}`,
            color: mapInteract ? "#ffffff" : "#cbd5e1",
            borderRadius: 8,
            padding: "5px 9px",
            fontSize: 10,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            backdropFilter: "blur(8px)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
          }}
          title={mapInteract ? "Map dragging active. Tap to switch to Page Scroll Mode." : "Scroll Mode active. Tap to pan/zoom map."}
        >
          {mapInteract ? (
            <>
              <NavigationIcon size={12} color="#ffffff" />
              <span>Pan: ON</span>
            </>
          ) : (
            <span>Scroll Mode</span>
          )}
        </button>
      )}

      {/* ── Route / Path stats card (collapsible & dismissible) ─────────── */}
      {routeStats && !statsDismissed && (
        <div style={{
          position: "absolute",
          bottom: 12,
          left: 10,
          zIndex: 1000,
          background: "rgba(2,6,23,0.94)",
          border: `1px solid ${routeStats.isLive ? "rgba(34,197,94,0.4)" : "rgba(56,189,248,0.3)"}`,
          backdropFilter: "blur(12px)",
          borderRadius: 10,
          padding: statsMinimized ? "6px 10px" : "10px 14px",
          minWidth: statsMinimized ? "auto" : 200,
          maxWidth: 250,
          boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
        }}>
          {/* Header row with Minimize & Close buttons */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: statsMinimized ? 0 : 8,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: routeStats.isLive ? "#22c55e" : "#38bdf8",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <RouteIcon size={12} color={routeStats.isLive ? "#22c55e" : "#38bdf8"} />
              <span>{routeStats.isLive ? "Live Path" : "Travelled Path"}</span>
              {statsMinimized && (
                <span style={{ fontSize: 10, color: "#cbd5e1", fontWeight: 700, textTransform: "none", marginLeft: 4 }}>
                  • {fmtDistance(routeStats.totalDistanceM)}
                </span>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setStatsMinimized(!statsMinimized); }}
                title={statsMinimized ? "Expand path details" : "Minimize path details"}
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 4,
                  color: "#cbd5e1",
                  cursor: "pointer",
                  fontSize: 10,
                  padding: "2px 6px",
                  fontWeight: 700,
                }}
              >
                {statsMinimized ? "Expand ▾" : "Hide ▴"}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setStatsDismissed(true); }}
                title="Close path card"
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 4,
                  color: "#f87171",
                  cursor: "pointer",
                  fontSize: 10,
                  padding: "2px 6px",
                  fontWeight: 800,
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Stats grid only when expanded */}
          {!statsMinimized && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 10px" }}>
                <StatEntry
                  icon={<NavigationIcon size={11} color="#38bdf8" />}
                  label="Distance"
                  value={fmtDistance(routeStats.totalDistanceM)}
                  accent="#38bdf8"
                />
                <StatEntry
                  icon={<ClockIcon size={11} color="#a78bfa" />}
                  label="Duration"
                  value={fmtDuration(routeStats.elapsedMs)}
                  accent="#a78bfa"
                />
                <StatEntry
                  icon={<RouteIcon size={11} color="#f59e0b" />}
                  label="Avg speed"
                  value={`${routeStats.avgSpeedKph.toFixed(1)} km/h`}
                  accent="#f59e0b"
                />
                <StatEntry
                  icon={<MapPinIcon size={11} color="#94a3b8" />}
                  label="Points"
                  value={String(routeStats.pointCount)}
                  accent="#94a3b8"
                />
              </div>

              {/* Time range bar */}
              <div style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: "1px solid rgba(255,255,255,0.07)",
                display: "flex", justifyContent: "space-between",
                fontSize: 9, color: "#64748b", letterSpacing: "0.05em",
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
                  <span>{fmtTime(route![0].captured_at)}</span>
                </span>
                <span style={{ color: "#334155" }}>→</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span>{fmtTime(route![route!.length - 1].captured_at)}</span>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: routeStats.isLive ? "#22c55e" : "#ef4444" }} />
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tiny reopen button when path stats card is closed */}
      {routeStats && statsDismissed && (
        <button
          type="button"
          onClick={() => { setStatsDismissed(false); setStatsMinimized(false); }}
          style={{
            position: "absolute",
            bottom: 12,
            left: 10,
            zIndex: 1000,
            background: "rgba(2,6,23,0.92)",
            border: "1px solid rgba(56,189,248,0.4)",
            color: "#38bdf8",
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            backdropFilter: "blur(8px)",
            boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
          }}
          title="Click to view full route distance & duration"
        >
          <RouteIcon size={13} color="#38bdf8" />
          <span>Path Info ({fmtDistance(routeStats.totalDistanceM)})</span>
        </button>
      )}

      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          touchAction: mapInteract ? "none" : "pan-y",
        }}
      />
    </div>
  );
}

// ── Small stat entry inside the path stats card ───────────────────────────
function StatEntry({
  icon, label, value, accent,
}: {
  icon: React.ReactNode; label: string; value: string; accent: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2, display: "flex", alignItems: "center", gap: 4 }}>
        {icon}
        <span>{label}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: accent, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}

const hudBadge: React.CSSProperties = {
  background: "rgba(2,6,23,0.82)",
  border: "1px solid rgba(51,65,85,0.7)",
  backdropFilter: "blur(10px)",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 10,
  fontWeight: 600,
  color: "#94a3b8",
  letterSpacing: "0.07em",
  textTransform: "uppercase",
};
