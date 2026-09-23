import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { requestAdminMagicLink } from "@/lib/admin-login.functions";

export const Route = createFileRoute("/admin/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === "string" ? search.error : undefined,
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const { error, next } = useSearch({ from: "/admin/login" });
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await requestAdminMagicLink({ data: { email, next } });
    } catch {
      // Swallowed on purpose: the user always sees the same generic message,
      // whether the email was allow-listed, rejected, or delivery failed, so
      // the outcome can't be used to enumerate admin addresses.
    }
    setSent(true);
  }

  return (
    <main style={{ maxWidth: "24rem", margin: "4rem auto", padding: "0 1rem", fontFamily: "sans-serif" }}>
      <h1>logdrop admin</h1>
      {error === "expired" && <p style={{ color: "red" }}>That link expired. Request a new one below.</p>}
      {error === "missing" && <p style={{ color: "red" }}>Missing login token.</p>}
      {sent ? (
        <p>If that email is registered, a login link is on its way. It expires in 15 minutes.</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{ width: "100%" }}
          />
          <button type="submit">Send login link</button>
        </form>
      )}
    </main>
  );
}
