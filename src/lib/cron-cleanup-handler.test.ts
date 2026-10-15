import { describe, test, expect, mock, afterEach, afterAll } from "bun:test";
import { installFakeAuthStore } from "./auth-store.fake";

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

const authStore = await installFakeAuthStore();

const { handleCronCleanup } = await import("./cron-cleanup-handler");

const SECRET = "cron-secret";

describe("handleCronCleanup", () => {
  afterEach(() => {
    deleteExpiredPastesMock.mockClear();
    authStore.reset();
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
    authStore.restore();
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

  test("deletes expired pastes and auth records when authorized", async () => {
    deleteExpiredPastesMock.mockImplementation(async () => ["expired-1", "expired-2"]);
    authStore.fake.deleteExpiredAuthRecords.mockImplementation(async () => 3);
    const request = new Request("https://logdrop.example/api/cron/cleanup", {
      headers: { authorization: `Bearer ${SECRET}` },
    });

    const res = await handleCronCleanup(request, SECRET);
    const json = (await res.json()) as { deleted: string[]; authRecordsDeleted: number };

    expect(res.status).toBe(200);
    expect(json.deleted).toEqual(["expired-1", "expired-2"]);
    expect(json.authRecordsDeleted).toBe(3);
    expect(deleteExpiredPastesMock).toHaveBeenCalledTimes(1);
  });
});
