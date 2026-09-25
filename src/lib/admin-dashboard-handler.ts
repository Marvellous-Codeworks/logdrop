import { getAdminEmails } from "./admin-allowlist";
import { getSessionEmail } from "./session";
import { listPastes } from "./storage";
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

/** Bulk-action toolbar + selection/filter wiring for the dashboard table. Runs once per page load. */
function adminBulkActionsScript(): string {
  return `<script>
    (function () {
      var rowChecks = function () { return Array.from(document.querySelectorAll(".row-check")); };
      var visibleChecks = function () {
        return rowChecks().filter(function (c) { return c.closest("tr").style.display !== "none"; });
      };
      var selectAll = document.getElementById("select-all");
      var deleteBtn = document.getElementById("bulk-delete-btn");
      var copyBtn = document.getElementById("bulk-copy-btn");
      var filterInput = document.getElementById("admin-filter");
      var bulkForm = document.getElementById("bulk-form");
      var hideAnalyzed = document.getElementById("hide-analyzed");

      function updateToolbar() {
        var checked = rowChecks().filter(function (c) { return c.checked; });
        var n = checked.length;
        if (deleteBtn) {
          deleteBtn.disabled = n === 0;
          deleteBtn.textContent = n > 0 ? "Delete selected (" + n + ")" : "Delete selected";
        }
        if (copyBtn) {
          copyBtn.disabled = n === 0;
          copyBtn.textContent = n > 0 ? "Copy links (" + n + ")" : "Copy links";
        }
        if (selectAll) {
          var visible = visibleChecks();
          var visibleChecked = visible.filter(function (c) { return c.checked; });
          selectAll.checked = visible.length > 0 && visibleChecked.length === visible.length;
          selectAll.indeterminate = visibleChecked.length > 0 && visibleChecked.length < visible.length;
        }
      }

      rowChecks().forEach(function (c) { c.addEventListener("change", updateToolbar); });

      if (selectAll) {
        selectAll.addEventListener("change", function () {
          visibleChecks().forEach(function (c) { c.checked = selectAll.checked; });
          updateToolbar();
        });
      }

      function applyFilters() {
        var q = filterInput ? filterInput.value.trim().toLowerCase() : "";
        var hide = !!(hideAnalyzed && hideAnalyzed.checked);
        document.querySelectorAll("table.pastes tbody tr").forEach(function (tr) {
          var haystack = (tr.getAttribute("data-search") || "").toLowerCase();
          var matchesText = q === "" || haystack.indexOf(q) !== -1;
          var matchesAnalyzed = !hide || tr.getAttribute("data-analyzed") !== "1";
          tr.style.display = matchesText && matchesAnalyzed ? "" : "none";
        });
        updateToolbar();
      }

      if (filterInput) filterInput.addEventListener("input", applyFilters);
      if (hideAnalyzed) hideAnalyzed.addEventListener("change", applyFilters);

      if (copyBtn) {
        copyBtn.addEventListener("click", async function () {
          var links = rowChecks()
            .filter(function (c) { return c.checked; })
            .map(function (c) { return window.location.origin + "/r/" + c.value; });
          if (links.length === 0) return;
          await navigator.clipboard.writeText(links.join("\\n"));
          copyBtn.textContent = "✓ Copied";
          copyBtn.classList.add("flash-success");
          setTimeout(function () {
            copyBtn.classList.remove("flash-success");
            updateToolbar();
          }, 1500);
        });
      }

      var deleteDialog = document.getElementById("delete-confirm-dialog");
      var deleteMessage = document.getElementById("delete-confirm-message");
      var deleteCancelBtn = document.getElementById("delete-confirm-cancel");
      var deleteOkBtn = document.getElementById("delete-confirm-ok");
      var pendingSubmitter = null;
      var confirmedSubmit = false;

      if (bulkForm && deleteDialog) {
        bulkForm.addEventListener("submit", function (e) {
          if (confirmedSubmit) {
            confirmedSubmit = false;
            return;
          }
          var submitter = e.submitter;
          if (!submitter) return;
          var isBulk = submitter === deleteBtn;
          var isRowDelete = !isBulk && submitter.getAttribute("formaction") === "/api/admin/delete";
          if (!isBulk && !isRowDelete) return;

          if (isBulk) {
            var n = rowChecks().filter(function (c) { return c.checked; }).length;
            if (n === 0) {
              e.preventDefault();
              return;
            }
            deleteMessage.textContent = "Delete " + n + " upload(s)? This can't be undone.";
          } else {
            deleteMessage.textContent = "Delete \\"" + submitter.value + "\\"? This can't be undone.";
          }

          e.preventDefault();
          pendingSubmitter = submitter;
          deleteDialog.showModal();
        });

        deleteCancelBtn.addEventListener("click", function () {
          pendingSubmitter = null;
          deleteDialog.close();
        });

        deleteOkBtn.addEventListener("click", function () {
          deleteDialog.close();
          if (pendingSubmitter) {
            confirmedSubmit = true;
            bulkForm.requestSubmit(pendingSubmitter);
            pendingSubmitter = null;
          }
        });

        deleteDialog.addEventListener("cancel", function () {
          pendingSubmitter = null;
        });
      }

      updateToolbar();
    })();
  </script>`;
}

export async function handleAdminDashboard(request: Request, secret: string): Promise<Response> {
  const url = new URL(request.url);
  const email = getSessionEmail(request, secret, getAdminEmails());
  if (!email) {
    return Response.redirect(new URL("/admin/login?next=/admin", url.origin).toString(), 302);
  }

  const pastes = await listPastes();
  const rows = pastes
    .map((p) => {
      const searchText = [p.slug, p.label ?? "", p.uploaderCountry ?? ""].join(" ");
      return `<tr data-search="${escapeHtml(searchText)}" data-analyzed="${p.analyzed ? "1" : "0"}">
        <td><input type="checkbox" class="row-check" name="selected" value="${escapeHtml(p.slug)}" aria-label="Select ${escapeHtml(p.slug)}" /></td>
        <td class="col-slug">${
          p.analyzed
            ? `<svg class="analyzed-badge" role="img" aria-label="Analyzed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`
            : ""
        }<a href="/r/${escapeHtml(p.slug)}">${escapeHtml(p.slug)}</a></td>
        <td><time data-iso="${escapeHtml(p.createdAt)}">${escapeHtml(formatDateFallback(p.createdAt))}</time></td>
        <td><time data-iso="${escapeHtml(p.expiresAt)}">${escapeHtml(formatDateFallback(p.expiresAt))}</time></td>
        <td class="tabular">${escapeHtml(String(p.sizeBytes))}</td>
        <td>${escapeHtml(p.uploaderCountry ?? "")}</td>
        <td class="col-label">${escapeHtml(p.label ?? "")}</td>
        <td>${
          p.issueUrl
            ? `<a class="chip chip--link" href="${escapeHtml(p.issueUrl)}">${escapeHtml(issueNumberFromUrl(p.issueUrl))}</a>`
            : ""
        }</td>
        <td><button class="btn btn--danger" type="submit" name="slug" value="${escapeHtml(p.slug)}" formaction="/api/admin/delete">Delete</button></td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>${pageHead("logdrop — admin")}</head>
<body>
  <div class="shell">
    ${navHtml(false)}
    <main class="page page--wide">
      <h1>Admin</h1>
      <p class="lede">Signed in as ${escapeHtml(email)}.</p>
      ${
        pastes.length === 0
          ? `<p class="lede">No uploads yet.</p>`
          : `<form id="bulk-form" method="POST" action="/api/admin/delete-bulk">
        <div class="table-toolbar">
          <input type="search" id="admin-filter" class="input" placeholder="Filter by slug, label, or country" style="max-width: 24rem;" />
          <label class="filter-toggle"><input type="checkbox" id="hide-analyzed" /> Hide analyzed</label>
          <div class="table-toolbar__actions">
            <button type="button" id="bulk-copy-btn" class="btn btn--secondary" disabled>Copy links</button>
            <button type="submit" id="bulk-delete-btn" class="btn btn--danger" disabled>Delete selected</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="pastes">
            <thead><tr>
              <th><input type="checkbox" id="select-all" aria-label="Select all" /></th>
              <th>Slug</th><th>Created</th><th>Expires</th><th>Bytes</th><th>Country</th><th>Label</th><th>Issue</th><th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </form>`
      }
    </main>
    ${footerHtml()}
  </div>
  ${
    pastes.length > 0
      ? `<dialog id="delete-confirm-dialog" class="result-dialog">
        <p class="result-dialog__kicker">Confirm delete</p>
        <h2 id="delete-confirm-message">Delete this upload?</h2>
        <p class="lede">This can't be undone.</p>
        <div class="result-dialog__actions">
          <button type="button" class="btn btn--secondary" id="delete-confirm-cancel">Cancel</button>
          <button type="button" class="btn btn--danger" id="delete-confirm-ok">Delete</button>
        </div>
      </dialog>`
      : ""
  }
  ${localizeDatesScript()}
  ${themeToggleWireScript()}
  ${pastes.length > 0 ? adminBulkActionsScript() : ""}
</body>
</html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
