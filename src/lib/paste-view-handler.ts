import { getAdminEmails } from "./admin-allowlist";
import { INSTANCE_TOKEN_ACTOR } from "./agent-tokens";
import { getSessionEmail } from "./session";
import { getPasteContent, getPasteMeta } from "./storage";
import {
  pageHead,
  navHtml,
  footerHtml,
  issueNumberFromUrl,
  formatDateFallback,
  localizeDatesScript,
  themeToggleWireScript,
  robotIconSvg,
} from "./html-shell";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function handlePasteView(
  request: Request,
  slug: string,
  secret: string,
): Promise<Response> {
  const url = new URL(request.url);
  const email = getSessionEmail(request, secret, getAdminEmails());
  if (!email) {
    const next = encodeURIComponent(url.pathname);
    return Response.redirect(new URL(`/admin/login?next=${next}`, url.origin).toString(), 302);
  }

  const [content, meta] = await Promise.all([getPasteContent(slug), getPasteMeta(slug)]);
  if (content === null || meta === null) {
    return new Response("Not found", { status: 404 });
  }

  const html = `<!doctype html>
<html lang="en">
<head>${pageHead(`logdrop — ${escapeHtml(slug)}`)}</head>
<body>
  <div class="shell">
    ${navHtml(true)}
    <main class="page page--wide">
      <a class="icon-btn" href="/admin" aria-label="Back to admin">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
      </a>
      <p class="lede">
        Uploaded <time data-iso="${escapeHtml(meta.createdAt)}">${escapeHtml(formatDateFallback(meta.createdAt))}</time>
        · expires <time data-iso="${escapeHtml(meta.expiresAt)}">${escapeHtml(formatDateFallback(meta.expiresAt))}</time>
        ${meta.label ? ` · ${escapeHtml(meta.label)}` : ""}
        ${
          meta.issueUrl
            ? ` · <a class="chip chip--link" href="${escapeHtml(meta.issueUrl)}">${escapeHtml(issueNumberFromUrl(meta.issueUrl))}</a>`
            : ""
        }
      </p>
      <ul class="paste-activity">
        <li id="analyzed-activity"${meta.analyzed ? "" : " hidden"}>
          <svg class="analyzed-badge" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
          <span>Analyzed<span id="analyzed-by-wrap"${meta.analyzedBy ? "" : " hidden"}> by <span id="analyzed-by">${escapeHtml(meta.analyzedBy ?? "")}</span></span><span id="analyzed-at-wrap"${meta.analyzedAt ? "" : " hidden"}> on <time id="analyzed-at" data-iso="${escapeHtml(meta.analyzedAt ?? "")}">${escapeHtml(meta.analyzedAt ? formatDateFallback(meta.analyzedAt) : "")}</time></span></span>
        </li>
        ${
          meta.agentAccessCount > 0
            ? `<li id="agent-activity">
          ${robotIconSvg("agent-badge")}
          <span>Read by AI agent ${meta.agentAccessCount} ${meta.agentAccessCount === 1 ? "time" : "times"}${
            meta.agentLastAccessAt
              ? ` · last <time data-iso="${escapeHtml(meta.agentLastAccessAt)}">${escapeHtml(formatDateFallback(meta.agentLastAccessAt))}</time>`
              : ""
          }${
            meta.agentLastAccessBy
              ? ` by ${meta.agentLastAccessBy === INSTANCE_TOKEN_ACTOR ? "the instance token" : escapeHtml(meta.agentLastAccessBy)}`
              : ""
          }</span>
        </li>`
            : ""
        }
      </ul>
      <div class="code-card">
        <div class="code-card__bar">
          <span class="code-card__label">${escapeHtml(slug)}</span>
          <button class="btn btn--secondary copy-btn" type="button" id="copy-btn" style="height: 1.75rem; padding: 0 var(--space-sm); font-size: var(--text-xs);">
            <span class="copy-btn__default">Copy</span>
          </button>
        </div>
        <pre id="paste-content" class="code-card__body">${escapeHtml(content)}</pre>
      </div>
      <div style="margin-top: var(--space-md); display: flex; gap: var(--space-sm);">
        <button class="btn btn--secondary" id="download-btn" type="button">Download as .txt</button>
        <button class="btn btn--secondary" id="analyzed-btn" type="button" data-analyzed="${meta.analyzed ? "1" : "0"}">${meta.analyzed ? "Unmark as analyzed" : "Mark as analyzed"}</button>
        <form id="delete-form" method="POST" action="/api/admin/delete" style="display: inline;">
          <input type="hidden" name="slug" value="${escapeHtml(slug)}" />
          <button class="btn btn--danger" id="delete-btn" type="button">Delete</button>
        </form>
      </div>
    </main>
    ${footerHtml()}
  </div>
  <dialog id="confirm-dialog" class="result-dialog">
    <p class="result-dialog__kicker">Confirm</p>
    <h2 id="confirm-message">Are you sure?</h2>
    <div class="result-dialog__actions">
      <button type="button" class="btn btn--secondary" id="confirm-cancel">Cancel</button>
      <button type="button" class="btn" id="confirm-ok">Confirm</button>
    </div>
  </dialog>
  <script>
    document.getElementById("download-btn").addEventListener("click", () => {
      const text = document.getElementById("paste-content").textContent;
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "logdrop-${slug}.txt";
      a.click();
      URL.revokeObjectURL(url);
    });
    document.getElementById("copy-btn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const text = document.getElementById("paste-content").textContent;
      await navigator.clipboard.writeText(text);
      btn.dataset.state = "copied";
      btn.classList.add("flash-success");
      setTimeout(() => {
        delete btn.dataset.state;
        btn.classList.remove("flash-success");
      }, 1500);
    });

    const confirmDialog = document.getElementById("confirm-dialog");
    const confirmMessage = document.getElementById("confirm-message");
    const confirmCancelBtn = document.getElementById("confirm-cancel");
    const confirmOkBtn = document.getElementById("confirm-ok");
    let pendingAction = null;

    function openConfirm(message, onConfirm, options) {
      confirmMessage.textContent = message;
      pendingAction = onConfirm;
      confirmOkBtn.textContent = (options && options.okLabel) || "Confirm";
      confirmOkBtn.classList.toggle("btn--danger", !!(options && options.danger));
      confirmOkBtn.classList.toggle("btn--secondary", !(options && options.danger));
      confirmDialog.showModal();
    }

    confirmCancelBtn.addEventListener("click", () => {
      pendingAction = null;
      confirmDialog.close();
    });
    confirmDialog.addEventListener("cancel", () => {
      pendingAction = null;
    });
    confirmOkBtn.addEventListener("click", () => {
      confirmDialog.close();
      const action = pendingAction;
      pendingAction = null;
      if (action) action();
    });

    function updateAnalyzedActivity(analyzed, by, at) {
      document.getElementById("analyzed-activity").hidden = !analyzed;
      document.getElementById("analyzed-by-wrap").hidden = !by;
      document.getElementById("analyzed-by").textContent = by || "";
      document.getElementById("analyzed-at-wrap").hidden = !at;
      const atEl = document.getElementById("analyzed-at");
      atEl.setAttribute("data-iso", at || "");
      atEl.textContent = at
        ? new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : "";
    }

    const analyzedBtn = document.getElementById("analyzed-btn");
    analyzedBtn.addEventListener("click", async () => {
      const isAnalyzed = analyzedBtn.dataset.analyzed === "1";
      const next = !isAnalyzed;
      try {
        const res = await fetch("/api/admin/analyzed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "${slug}", analyzed: next }),
        });
        if (res.status === 401) {
          const nextParam = encodeURIComponent(window.location.pathname);
          window.location.href = "/admin/login?next=" + nextParam;
          return;
        }
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          analyzedBtn.dataset.analyzed = next ? "1" : "0";
          analyzedBtn.textContent = next ? "Unmark as analyzed" : "Mark as analyzed";
          updateAnalyzedActivity(next, data.analyzedBy || null, data.analyzedAt || null);
          return;
        }
        throw new Error("analyzed toggle failed");
      } catch (e) {
        const originalText = analyzedBtn.textContent;
        analyzedBtn.textContent = "Error — try again";
        setTimeout(() => {
          analyzedBtn.textContent = originalText;
        }, 2000);
      }
    });

    const deleteForm = document.getElementById("delete-form");
    const deleteBtn = document.getElementById("delete-btn");
    deleteBtn.addEventListener("click", () => {
      openConfirm(
        "Delete \\"${slug}\\"? This can't be undone.",
        () => {
          deleteForm.requestSubmit();
        },
        { danger: true, okLabel: "Delete" },
      );
    });
  </script>
  ${localizeDatesScript()}
  ${themeToggleWireScript()}
</body>
</html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
