import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
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
    <main style={{ maxWidth: "40rem", margin: "2rem auto", padding: "0 1rem", fontFamily: "sans-serif" }}>
      <h1>logdrop</h1>
      <p>Paste text or upload a .txt file. Only an allow-listed maintainer can read it back.</p>
      <form onSubmit={handleSubmit}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!!file}
          rows={12}
          style={{ width: "100%" }}
          placeholder="Paste text here..."
        />
        <p>— or —</p>
        <input
          type="file"
          accept=".txt,text/plain"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Optional label"
            style={{ width: "100%" }}
          />
        </p>
        <div ref={turnstileRef} />
        <button type="submit" disabled={submitting || (!text.trim() && !file)}>
          {submitting ? "Uploading…" : "Upload"}
        </button>
      </form>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {resultUrl && (
        <p>
          Share this link: <a href={resultUrl}>{resultUrl}</a>
        </p>
      )}
    </main>
  );
}
