import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LOGDROP_VERSION } from "@/lib/version";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [issueUrl, setIssueUrl] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const resultDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (resultUrl) {
      setCopied(false);
      resultDialogRef.current?.showModal();
    } else {
      resultDialogRef.current?.close();
    }
  }, [resultUrl]);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    document.body.appendChild(script);
    script.onload = () => {
      const turnstile = (
        window as unknown as {
          turnstile?: {
            render: (el: HTMLElement, opts: { sitekey: string; theme?: "light" | "dark" | "auto" }) => string;
          };
        }
      ).turnstile;
      if (turnstile && turnstileRef.current) {
        widgetIdRef.current = turnstile.render(turnstileRef.current, {
          sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
          // logdrop's theme is always light — force the widget to match rather
          // than following the visitor's OS-level dark-mode preference.
          theme: "light",
        });
      }
    };
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResultUrl(null);

    const turnstile = (
      window as unknown as {
        turnstile?: { getResponse: (id: string) => string; reset: (id: string) => void };
      }
    ).turnstile;
    const turnstileToken = widgetIdRef.current ? turnstile?.getResponse(widgetIdRef.current) : undefined;
    if (!turnstileToken) {
      setError("Please complete the verification widget.");
      return;
    }

    const formData = new FormData();
    formData.set("turnstileToken", turnstileToken);
    if (label.trim()) formData.set("label", label.trim());
    if (issueUrl.trim()) formData.set("issueUrl", issueUrl.trim());
    if (file) {
      formData.set("file", file);
    } else {
      formData.set("content", text);
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Upload failed");
        return;
      }
      setResultUrl(data.url);
      setText("");
      setFile(null);
      setLabel("");
      setIssueUrl("");
    } catch {
      setError("Upload failed");
    } finally {
      setSubmitting(false);
      // Turnstile tokens are single-use: reset the widget after every attempt
      // (success or failure) so the next upload gets a fresh token.
      if (widgetIdRef.current) turnstile?.reset(widgetIdRef.current);
    }
  }

  return (
    <div className="shell">
      <nav className="nav">
        <Link className="wordmark" to="/">
          <img className="wordmark__icon" src="/favicon.svg" alt="" />
          logdrop
        </Link>
        <div className="nav__end">
          {/*
            /admin has no React component — it's a raw server handler (see
            src/routes/admin/index.tsx). A client-side TanStack Router
            navigation has nothing to render for it and shows "Not Found";
            reloadDocument forces a real browser navigation so the server
            handler actually runs.
          */}
          <Link className="nav__link" to="/admin" reloadDocument>
            Admin
          </Link>
          <ThemeToggle />
        </div>
      </nav>

      <main className="page page--wide">
        <h1>Drop a log, get a link</h1>
        <p className="lede" style={{ fontSize: "var(--text-md)", maxWidth: "48ch" }}>
          Paste a log, a config, or a snippet below. Every upload disappears on its own after
          the retention window.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="split">
            <div className="split__content">
              <div className="field">
                <div className="field__header">
                  <label htmlFor="paste-text">Text</label>
                  <label className="file-field file-field--compact" htmlFor="paste-file">
                    <span>Upload .txt instead</span>
                    <input
                      id="paste-file"
                      type="file"
                      accept=".txt,text/plain"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
                <p className="helper" style={{ marginTop: 0 }}>
                  Paste directly below, or upload a .txt file — either works the same way.
                </p>

                {file ? (
                  <div className="file-chosen">
                    <span className="mono">{file.name}</span>
                    <button className="btn btn--secondary" type="button" onClick={() => setFile(null)}>
                      Remove, paste text instead
                    </button>
                  </div>
                ) : (
                  <textarea
                    id="paste-text"
                    className="textarea"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={18}
                    placeholder="Paste text here…"
                  />
                )}
              </div>
            </div>

            <div className="split__side">
              <div className="field">
                <label htmlFor="paste-label">Label (optional)</label>
                <input
                  id="paste-label"
                  className="input"
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="What this is"
                />
              </div>

              <div className="field">
                <label htmlFor="paste-issue-url">GitHub issue link (optional)</label>
                <input
                  id="paste-issue-url"
                  className="input"
                  type="url"
                  value={issueUrl}
                  onChange={(e) => setIssueUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo/issues/123"
                />
                <p className="helper">If this capture is for a bug report, link the issue.</p>
              </div>

              <div className="card" style={{ padding: "var(--space-md)" }}>
                <div ref={turnstileRef} style={{ marginBottom: "var(--space-md)" }} />

                <button
                  className="btn btn--primary"
                  type="submit"
                  style={{ width: "100%" }}
                  disabled={submitting || (!text.trim() && !file)}
                >
                  {submitting ? "Uploading…" : "Upload"}
                </button>

                {!submitting && !text.trim() && !file && (
                  <p className="helper" style={{ marginBottom: 0 }}>
                    Paste some text or choose a file above to enable this.
                  </p>
                )}
                {error && <p className="error-text" style={{ marginBottom: 0 }}>{error}</p>}
              </div>

            </div>
          </div>
        </form>

        <dialog ref={resultDialogRef} className="result-dialog" onClose={() => setResultUrl(null)}>
          {resultUrl && (
            <div>
              <p className="result-dialog__kicker">Uploaded</p>
              <h2>Your link is ready</h2>
              <p className="lede">
                Share it wherever you need to. Only an allow-listed maintainer can open it.
              </p>
              <div className="result-dialog__url">
                <span className="mono">{resultUrl}</span>
              </div>
              <div className="result-dialog__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(resultUrl);
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button type="button" className="btn btn--secondary" onClick={() => setResultUrl(null)}>
                  Done
                </button>
              </div>
            </div>
          )}
        </dialog>
      </main>

      <footer className="footer">
        <span>logdrop v{LOGDROP_VERSION} — a plain-text drop-off, gone in a week</span>
        <span className="footer__links">
          <a href="https://github.com/Marvellous-Codeworks/logdrop">Source</a>
          <a href="https://github.com/Marvellous-Codeworks/logdrop/issues/new">Report an issue</a>
        </span>
      </footer>
    </div>
  );
}
