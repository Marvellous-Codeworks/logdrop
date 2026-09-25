import { getAdminEmails } from "./admin-allowlist";
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
      const text = document.getElementById("paste-content").textContent;
      await navigator.clipboard.writeText(text);
      const btn = e.currentTarget;
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

    const analyzedBtn = document.getElementById("analyzed-btn");
    analyzedBtn.addEventListener("click", () => {
      const isAnalyzed = analyzedBtn.dataset.analyzed === "1";
      const next = !isAnalyzed;
      openConfirm(
        next ? "Mark this upload as analyzed?" : "Unmark this upload as analyzed?",
        async () => {
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
              analyzedBtn.dataset.analyzed = next ? "1" : "0";
              analyzedBtn.textContent = next ? "Unmark as analyzed" : "Mark as analyzed";
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
        },
        { okLabel: next ? "Mark" : "Unmark" },
      );
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
