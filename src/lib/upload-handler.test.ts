import { describe, test, expect, mock, afterEach, afterAll } from "bun:test";

// mock.module() patches the shared module namespace object in place rather
// than swapping the reference (see storage.test.ts for the same caveat with
// @vercel/blob), so the real exports must be destructured into standalone
// variables *before* mock.module() runs. Holding onto the namespace object
// itself and spreading it later would just re-observe the mocked values.
const realKillSwitch = await import("./kill-switch");
const { areUploadsDisabled: realAreUploadsDisabled } = realKillSwitch;
const areUploadsDisabledMock = mock(async () => false);
mock.module("./kill-switch", () => ({ ...realKillSwitch, areUploadsDisabled: areUploadsDisabledMock }));

const realTurnstile = await import("./turnstile");
const { verifyTurnstileToken: realVerifyTurnstileToken } = realTurnstile;
const verifyTurnstileTokenMock = mock(async () => true);
mock.module("./turnstile", () => ({ ...realTurnstile, verifyTurnstileToken: verifyTurnstileTokenMock }));

const realStorage = await import("./storage");
const {
  savePaste: realSavePaste,
  getPasteContent: realGetPasteContent,
  getPasteMeta: realGetPasteMeta,
  listPastes: realListPastes,
  deletePaste: realDeletePaste,
  deleteExpiredPastes: realDeleteExpiredPastes,
} = realStorage;
const savePasteMock = mock(async () => undefined);
mock.module("./storage", () => ({ ...realStorage, savePaste: savePasteMock }));

afterAll(() => {
  mock.module("./kill-switch", () => ({ ...realKillSwitch, areUploadsDisabled: realAreUploadsDisabled }));
  mock.module("./turnstile", () => ({ ...realTurnstile, verifyTurnstileToken: realVerifyTurnstileToken }));
  mock.module("./storage", () => ({
    ...realStorage,
    savePaste: realSavePaste,
    getPasteContent: realGetPasteContent,
    getPasteMeta: realGetPasteMeta,
    listPastes: realListPastes,
    deletePaste: realDeletePaste,
    deleteExpiredPastes: realDeleteExpiredPastes,
  }));
});

const { handleUpload } = await import("./upload-handler");

function uploadRequest(fields: Record<string, string>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("https://logdrop.example/api/upload", { method: "POST", body: form });
}

describe("handleUpload", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    areUploadsDisabledMock.mockClear();
    verifyTurnstileTokenMock.mockClear();
    savePasteMock.mockClear();
  });

  function setBaseEnv() {
    process.env.TURNSTILE_SECRET_KEY = "ts-secret";
    process.env.SITE_URL = "https://logdrop.example";
    // Reset shared mocks back to their happy-path defaults before each test,
    // since a prior test may have overridden one to exercise a failure path.
    areUploadsDisabledMock.mockImplementation(async () => false);
    verifyTurnstileTokenMock.mockImplementation(async () => true);
    savePasteMock.mockImplementation(async () => undefined);
  }

  test("returns 503 when uploads are disabled", async () => {
    setBaseEnv();
    areUploadsDisabledMock.mockImplementation(async () => true);

    const res = await handleUpload(uploadRequest({ turnstileToken: "tok", content: "hello" }));

    expect(res.status).toBe(503);
    expect(savePasteMock).not.toHaveBeenCalled();
  });

  test("returns 400 when the turnstile token is missing", async () => {
    setBaseEnv();
    const res = await handleUpload(uploadRequest({ content: "hello" }));
    expect(res.status).toBe(400);
  });

  test("returns 400 when turnstile verification fails", async () => {
    setBaseEnv();
    verifyTurnstileTokenMock.mockImplementation(async () => false);

    const res = await handleUpload(uploadRequest({ turnstileToken: "bad", content: "hello" }));

    expect(res.status).toBe(400);
    expect(savePasteMock).not.toHaveBeenCalled();
  });

  test("returns 400 when no content is provided", async () => {
    setBaseEnv();
    const res = await handleUpload(uploadRequest({ turnstileToken: "tok" }));
    expect(res.status).toBe(400);
  });

  test("returns 400 when content exceeds MAX_UPLOAD_BYTES", async () => {
    setBaseEnv();
    process.env.MAX_UPLOAD_BYTES = "10";
    const res = await handleUpload(
      uploadRequest({ turnstileToken: "tok", content: "this is way more than 10 bytes" }),
    );
    expect(res.status).toBe(400);
    expect(savePasteMock).not.toHaveBeenCalled();
  });

  test("returns 400 when content is not plain text", async () => {
    setBaseEnv();
    const form = new FormData();
    form.set("turnstileToken", "tok");
    form.set("file", new File([new Uint8Array([0xff, 0xfe, 0x00, 0x01])], "dump.txt"));
    const request = new Request("https://logdrop.example/api/upload", { method: "POST", body: form });

    const res = await handleUpload(request);

    expect(res.status).toBe(400);
    expect(savePasteMock).not.toHaveBeenCalled();
  });

  test("on success, saves the paste and returns its share URL", async () => {
    setBaseEnv();
    process.env.RETENTION_DAYS = "7";

    const res = await handleUpload(
      uploadRequest({ turnstileToken: "tok", content: "hello world", label: "my label" }),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { url: string };
    expect(json.url.startsWith("https://logdrop.example/r/")).toBe(true);
    expect(savePasteMock).toHaveBeenCalledTimes(1);
    const call = savePasteMock.mock.calls[0][0] as {
      content: string;
      meta: { label: string | null; sizeBytes: number };
    };
    expect(call.content).toBe("hello world");
    expect(call.meta.label).toBe("my label");
    expect(call.meta.sizeBytes).toBe(11);
  });

  test("passes through a well-formed GitHub issue URL and drops an invalid one", async () => {
    setBaseEnv();

    const goodRes = await handleUpload(
      uploadRequest({
        turnstileToken: "tok",
        content: "hello",
        issueUrl: "https://github.com/gioxx/logdrop/issues/7",
      }),
    );
    expect(goodRes.status).toBe(200);
    const goodCall = savePasteMock.mock.calls[0][0] as { meta: { issueUrl: string | null } };
    expect(goodCall.meta.issueUrl).toBe("https://github.com/gioxx/logdrop/issues/7");

    savePasteMock.mockClear();

    const badRes = await handleUpload(
      uploadRequest({ turnstileToken: "tok", content: "hello", issueUrl: "https://example.com/not-an-issue" }),
    );
    expect(badRes.status).toBe(200);
    const badCall = savePasteMock.mock.calls[0][0] as { meta: { issueUrl: string | null } };
    expect(badCall.meta.issueUrl).toBeNull();
  });
});
