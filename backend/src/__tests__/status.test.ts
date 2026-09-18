import { describe, expect, it } from "vitest";

// Pure helper mirrored from dashboard logic, tested here so both sides of the
// contract are covered without spinning up a browser. Kept in sync manually;
// see dashboard/src/status.ts for the source of truth used by the UI.
type Status = "live" | "delayed" | "stale" | "offline" | "ended";

function deriveStatus(params: {
  sessionStatus: "active" | "ended" | "force_ended";
  lastUpdateAt: string | null;
  updateIntervalSec: number;
  staleThresholdSec: number;
  isDelayed: boolean;
  reportedOffline: boolean;
}): Status {
  if (params.sessionStatus !== "active") return "ended";
  if (params.reportedOffline) return "offline";
  if (!params.lastUpdateAt) return "stale";

  const ageSec = (Date.now() - new Date(params.lastUpdateAt).getTime()) / 1000;
  if (ageSec > params.staleThresholdSec) return "stale";
  if (params.isDelayed) return "delayed";
  if (ageSec <= params.updateIntervalSec * 2) return "live";
  return "stale";
}

describe("deriveStatus", () => {
  it("returns ended when session is not active, regardless of recency", () => {
    expect(
      deriveStatus({
        sessionStatus: "ended",
        lastUpdateAt: new Date().toISOString(),
        updateIntervalSec: 60,
        staleThresholdSec: 180,
        isDelayed: false,
        reportedOffline: false,
      })
    ).toBe("ended");
  });

  it("returns live for a recent, non-delayed update within 2x interval", () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(
      deriveStatus({
        sessionStatus: "active",
        lastUpdateAt: recent,
        updateIntervalSec: 60,
        staleThresholdSec: 180,
        isDelayed: false,
        reportedOffline: false,
      })
    ).toBe("live");
  });

  it("returns delayed for a flagged queued-offline update even if recent", () => {
    const recent = new Date(Date.now() - 5_000).toISOString();
    expect(
      deriveStatus({
        sessionStatus: "active",
        lastUpdateAt: recent,
        updateIntervalSec: 60,
        staleThresholdSec: 180,
        isDelayed: true,
        reportedOffline: false,
      })
    ).toBe("delayed");
  });

  it("returns stale when no update within the stale threshold", () => {
    const old = new Date(Date.now() - 300_000).toISOString();
    expect(
      deriveStatus({
        sessionStatus: "active",
        lastUpdateAt: old,
        updateIntervalSec: 60,
        staleThresholdSec: 180,
        isDelayed: false,
        reportedOffline: false,
      })
    ).toBe("stale");
  });

  it("returns offline when device explicitly reports connectivity loss", () => {
    expect(
      deriveStatus({
        sessionStatus: "active",
        lastUpdateAt: new Date().toISOString(),
        updateIntervalSec: 60,
        staleThresholdSec: 180,
        isDelayed: false,
        reportedOffline: true,
      })
    ).toBe("offline");
  });

  it("never infers a location: stale with no lastUpdateAt is not treated as live", () => {
    expect(
      deriveStatus({
        sessionStatus: "active",
        lastUpdateAt: null,
        updateIntervalSec: 60,
        staleThresholdSec: 180,
        isDelayed: false,
        reportedOffline: false,
      })
    ).toBe("stale");
  });
});
