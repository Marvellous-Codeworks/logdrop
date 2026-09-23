import { describe, test, expect, mock, afterEach, afterAll } from "bun:test";

// Same mock-leakage risk as Task 14/15 — ./storage has more exports than
// this file overrides, and mock.module() patches the module namespace in
// place, so a plain captured reference goes stale as soon as mocking
// starts. Destructure every real export before mocking, and reconstruct
// the full export list (real consts + the one override) both when mocking
// and when restoring in afterAll.
const {
  savePaste: realSavePaste,
  getPasteContent: realGetPasteContent,
  getPasteMeta: realGetPasteMeta,
  listPastes: realListPastes,
  deletePaste: realDeletePaste,
  deleteExpiredPastes: realDeleteExpiredPastes,
} = await import("./storage");

const deleteExpiredPastesMock = mock(async (_now: Date) => [] as string[]);
mock.module("./storage", () => ({
  savePaste: realSavePaste,
  getPasteContent: realGetPasteContent,
  getPasteMeta: realGetPasteMeta,
  listPastes: realListPastes,
  deletePaste: realDeletePaste,
  deleteExpiredPastes: deleteExpiredPastesMock,
}));

const { handleCronCleanup } = await import("./cron-cleanup-handler");

const SECRET = "cron-secret";

describe("handleCronCleanup", () => {
  afterEach(() => {
    deleteExpiredPastesMock.mockClear();
  });

  afterAll(() => {
    mock.module("./storage", () => ({
      savePaste: realSavePaste,
      getPasteContent: realGetPasteContent,
      getPasteMeta: realGetPasteMeta,
      listPastes: realListPastes,
      deletePaste: realDeletePaste,
      deleteExpiredPastes: realDeleteExpiredPastes,
    }));
  });

  test("rejects requests with a missing Authorization header", async () => {
    const res = await handleCronCleanup(new Request("https://logdrop.example/api/cron/cleanup"), SECRET);
    expect(res.status).toBe(401);
    expect(deleteExpiredPastesMock).not.toHaveBeenCalled();
  });

  test("rejects requests with the wrong Authorization header", async () => {
    const request = new Request("https://logdrop.example/api/cron/cleanup", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    const res = await handleCronCleanup(request, SECRET);
    expect(res.status).toBe(401);
    expect(deleteExpiredPastesMock).not.toHaveBeenCalled();
  });

  test("deletes expired pastes and returns them when authorized", async () => {
    deleteExpiredPastesMock.mockImplementation(async () => ["expired-1", "expired-2"]);
    const request = new Request("https://logdrop.example/api/cron/cleanup", {
      headers: { authorization: `Bearer ${SECRET}` },
    });

    const res = await handleCronCleanup(request, SECRET);
    const json = (await res.json()) as { deleted: string[] };

    expect(res.status).toBe(200);
    expect(json.deleted).toEqual(["expired-1", "expired-2"]);
    expect(deleteExpiredPastesMock).toHaveBeenCalledTimes(1);
  });
});
