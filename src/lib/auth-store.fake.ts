import { mock } from "bun:test";

// In-memory stand-in for ./auth-store, for tests of the modules built on it
// (login, verify, session). auth-store.test.ts covers the real Blob logic.
//
// Usage: `const fake = await installFakeAuthStore();` before importing the
// module under test, `fake.reset()` between tests, `fake.restore()` in
// afterAll. mock.module() patches the module namespace for the whole bun test
// process, so the real exports are copied BEFORE mocking and handed back on
// restore.
export async function installFakeAuthStore() {
  const real = { ...(await import("./auth-store")) };
  const links = new Map<string, string>(); // token -> email
  const sessions = new Map<string, string>(); // email -> active session ID
  let counter = 0;

  const fake = {
    ...real,
    createMagicLink: mock(async (email: string) => {
      const normalized = email.trim().toLowerCase();
      for (const [token, owner] of links) if (owner === normalized) links.delete(token);
      const token = `link${String(++counter).padStart(39, "0")}`;
      links.set(token, normalized);
      return token;
    }),
    consumeMagicLink: mock(async (token: string, adminEmails: readonly string[]) => {
      const email = links.get(token);
      links.delete(token);
      return email && adminEmails.some((e) => e.trim().toLowerCase() === email) ? email : null;
    }),
    createSession: mock(async (email: string) => {
      const sid = `sess${String(++counter).padStart(39, "0")}`;
      sessions.set(email.trim().toLowerCase(), sid);
      return sid;
    }),
    isSessionActive: mock(async (email: string, sid: string) => sessions.get(email.trim().toLowerCase()) === sid),
    deleteSession: mock(async (email: string, sid: string) => {
      if (sessions.get(email.trim().toLowerCase()) === sid) sessions.delete(email.trim().toLowerCase());
    }),
    deleteExpiredAuthRecords: mock(async (_now: Date) => 0),
  };
  const mocks = [
    fake.createMagicLink,
    fake.consumeMagicLink,
    fake.createSession,
    fake.isSessionActive,
    fake.deleteSession,
    fake.deleteExpiredAuthRecords,
  ];
  mock.module("./auth-store", () => fake);

  return {
    fake,
    reset() {
      links.clear();
      sessions.clear();
      for (const m of mocks) m.mockClear();
    },
    restore() {
      mock.module("./auth-store", () => real);
    },
  };
}
