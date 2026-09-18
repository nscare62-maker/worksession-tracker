import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the pg pool before importing the service under test.
const { queryMock, releaseMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  releaseMock: vi.fn(),
}));
vi.mock("../db/pool", () => ({
  pool: {
    connect: async () => ({ query: queryMock, release: releaseMock }),
    query: queryMock,
  },
}));

import { startSession, ConsentRequiredError, SessionConflictError } from "../services/session.service";

describe("startSession", () => {
  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
  });

  it("throws ConsentRequiredError when no current consent ack exists", async () => {
    queryMock
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // consent lookup

    await expect(startSession({ workerId: "w1", clockMethod: "gps" })).rejects.toThrow(ConsentRequiredError);
    expect(queryMock).toHaveBeenCalledWith("ROLLBACK");
  });

  it("throws SessionConflictError when worker already has an active session", async () => {
    queryMock
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "consent-1" }] }) // consent lookup
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "existing-session" }] }); // active session check

    await expect(startSession({ workerId: "w1", clockMethod: "gps" })).rejects.toThrow(SessionConflictError);
    expect(queryMock).toHaveBeenCalledWith("ROLLBACK");
  });

  it("creates a session when consent exists and no active session is present", async () => {
    queryMock
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "consent-1" }] }) // consent lookup
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // no active session
      .mockResolvedValueOnce({ rows: [{ id: "new-session", worker_id: "w1", status: "active" }] }) // insert
      .mockResolvedValueOnce(undefined); // COMMIT

    const session = await startSession({ workerId: "w1", clockMethod: "gps" });
    expect(session.id).toBe("new-session");
    expect(queryMock).toHaveBeenCalledWith("COMMIT");
  });
});
