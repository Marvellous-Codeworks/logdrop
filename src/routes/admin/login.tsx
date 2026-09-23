import { createFileRoute, useSearch, Link } from "@tanstack/react-router";
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
    <div className="shell">
      <nav className="nav">
        <Link className="wordmark" to="/">
          logdrop
        </Link>
      </nav>

      <main className="page">
        <div className="card card--centered">
          <h1 style={{ fontSize: "var(--text-2xl)" }}>Admin sign-in</h1>
          {error === "expired" && (
            <p className="error-text">That link expired. Request a new one below.</p>
          )}
          {error === "missing" && <p className="error-text">Missing login token.</p>}
          {sent ? (
            <p className="lede">
              If that email is registered, a login link is on its way. It expires in 15 minutes.
            </p>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="admin-email">Email</label>
                <input
                  id="admin-email"
                  className="input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <button className="btn btn--primary" type="submit" style={{ width: "100%" }}>
                Send login link
              </button>
            </form>
          )}
        </div>
      </main>

      <footer className="footer">
        <span>logdrop</span>
      </footer>
    </div>
  );
}
