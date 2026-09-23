import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

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
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    document.body.appendChild(script);
    script.onload = () => {
      const turnstile = (window as unknown as { turnstile?: { render: (el: HTMLElement, opts: { sitekey: string }) => string } }).turnstile;
      if (turnstile && turnstileRef.current) {
        widgetIdRef.current = turnstile.render(turnstileRef.current, {
          sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
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
          logdrop
        </Link>
        <Link className="nav__link" to="/admin/login" search={{ error: undefined, next: undefined }}>
          Admin
        </Link>
      </nav>

      <main className="page page--wide">
        <div className="split">
          <div className="split__form">
            <h1>logdrop</h1>
            <p className="lede">
              Paste text or upload a .txt file. Only an allow-listed maintainer can read it back.
            </p>

            <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="paste-text">Text</label>
            <textarea
              id="paste-text"
              className="textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!!file}
              rows={12}
              placeholder="Paste text here…"
            />
          </div>

          <div className="divider">or</div>

          <div className="field">
            <label htmlFor="paste-file">File</label>
            <label className="file-field" htmlFor="paste-file">
              <span>{file ? file.name : "Choose a .txt file"}</span>
              <input
                id="paste-file"
                type="file"
                accept=".txt,text/plain"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

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

          <div ref={turnstileRef} style={{ marginBottom: "var(--space-md)" }} />

          <button className="btn btn--primary" type="submit" disabled={submitting || (!text.trim() && !file)}>
            {submitting ? "Uploading…" : "Upload"}
          </button>
            </form>

            {error && <p className="error-text">{error}</p>}
            {resultUrl && (
              <p style={{ marginTop: "var(--space-md)" }}>
                Share this link: <a href={resultUrl}>{resultUrl}</a>
              </p>
            )}
          </div>

          <div className="split__demo">
            <div className="code-card">
              <div className="code-card__bar">
                <span className="code-card__label">example.sh</span>
              </div>
              <pre className="code-card__body">
                <span className="prompt">$ </span>cat panic.log | curl -F content=@- \{"\n"}
                {"    "}https://logdrop.example/api/upload{"\n\n"}
                <span className="out">{"{"}"url":</span>
                <span className="accent">"https://logdrop.example/r/x7k2p9"</span>
                <span className="out">{"}"}</span>
              </pre>
            </div>
            <p className="helper" style={{ marginTop: "var(--space-sm)" }}>
              Every upload gets a link like this — readable only after signing in as an
              allow-listed maintainer.
            </p>
          </div>
        </div>
      </main>

      <footer className="footer">
        <span>logdrop — a plain-text drop-off, gone in a week</span>
        <a href="https://github.com/Marvellous-Codeworks/logdrop">Source</a>
      </footer>
    </div>
  );
}
