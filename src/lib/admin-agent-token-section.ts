import type { AgentTokenRecord } from "./agent-tokens";
import { maskAgentToken } from "./agent-tokens";
import { formatDateFallback, robotIconSvg } from "./html-shell";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function timeHtml(iso: string): string {
  return `<time data-iso="${escapeHtml(iso)}">${escapeHtml(formatDateFallback(iso))}</time>`;
}

/**
 * "AI agent access" block of the dashboard, right under "Signed in as": a
 * show/hide line whose summary doubles as the agent access notice, revealing
 * the signed-in admin's own token (masked) plus generate / regenerate /
 * revoke. The plaintext token is only shown in the reveal dialog right after
 * generation.
 */
export function agentTokenSectionHtml(record: AgentTokenRecord | null, legacyTokenSet: boolean): string {
  const enabled = record !== null || legacyTokenSet;
  const status = record
    ? `<p class="lede">Your token: <span class="mono">${escapeHtml(maskAgentToken(record.hint))}</span> · created ${timeHtml(record.createdAt)} · ${
        record.lastUsedAt ? `last used ${timeHtml(record.lastUsedAt)}` : "never used"
      }</p>
      <div class="agent-access__actions">
        <button type="button" class="btn btn--secondary" id="agent-token-generate">Regenerate</button>
        <button type="button" class="btn btn--danger" id="agent-token-revoke">Revoke</button>
      </div>`
    : `<p class="lede">You don't have an agent token yet.</p>
      <div class="agent-access__actions">
        <button type="button" class="btn btn--primary" id="agent-token-generate">Generate token</button>
      </div>`;

  return `<details class="agent-access" id="agent-access">
      <summary class="lede${enabled ? " agent-notice" : ""}">${robotIconSvg("agent-badge")}${
        enabled ? "AI agent access enabled." : "AI agent access not set up."
      } <span class="agent-access__toggle">Manage your token</span></summary>
      <div class="agent-access__body">
        <p class="lede">A personal token lets your AI agent read uploads through <span class="mono">GET /api/agent/paste/&lt;slug&gt;</span> with <span class="mono">Authorization: Bearer &lt;token&gt;</span>. Reads are attributed to you. The token stops working if you're removed from the admins.</p>
        ${status}
        ${
          legacyTokenSet
            ? `<p class="lede agent-access__legacy">The instance-wide <span class="mono">AGENT_API_TOKEN</span> is also set. It's deprecated: move agents to personal tokens, then remove it.</p>`
            : ""
        }
      </div>
    </details>
    <dialog id="agent-token-dialog" class="result-dialog">
      <p class="result-dialog__kicker">Agent token</p>
      <h2>Copy your token now</h2>
      <p class="lede">You won't be able to see it again. If you lose it, regenerate it.</p>
      <div class="result-dialog__url"><span class="mono" id="agent-token-value"></span></div>
      <div class="result-dialog__actions">
        <button type="button" class="btn btn--primary" id="agent-token-copy">Copy token</button>
        <button type="button" class="btn btn--secondary" id="agent-token-done">Done</button>
      </div>
    </dialog>
    <dialog id="agent-token-confirm-dialog" class="result-dialog">
      <p class="result-dialog__kicker">Confirm</p>
      <h2 id="agent-token-confirm-message">Revoke your agent token?</h2>
      <p class="lede">Agents using it will stop working immediately.</p>
      <div class="result-dialog__actions">
        <button type="button" class="btn btn--secondary" id="agent-token-confirm-cancel">Cancel</button>
        <button type="button" class="btn btn--danger" id="agent-token-confirm-ok">Confirm</button>
      </div>
    </dialog>`;
}

/** Wires the section's buttons to POST /api/admin/agent-token. */
export function agentTokenScript(hasToken: boolean): string {
  return `<script>
    (function () {
      var hasToken = ${hasToken ? "true" : "false"};
      var generateBtn = document.getElementById("agent-token-generate");
      var revokeBtn = document.getElementById("agent-token-revoke");
      var dialog = document.getElementById("agent-token-dialog");
      var valueEl = document.getElementById("agent-token-value");
      var copyBtn = document.getElementById("agent-token-copy");
      var doneBtn = document.getElementById("agent-token-done");
      var confirmDialog = document.getElementById("agent-token-confirm-dialog");
      var confirmMessage = document.getElementById("agent-token-confirm-message");
      var confirmOk = document.getElementById("agent-token-confirm-ok");
      var confirmCancel = document.getElementById("agent-token-confirm-cancel");
      var pendingAction = null;
      var details = document.getElementById("agent-access");

      // Reload to show the new state, reopening the block afterwards.
      function reloadOpen() {
        window.location.hash = "agent-access";
        window.location.reload();
      }
      if (details && window.location.hash === "#agent-access") details.open = true;

      function post(action) {
        return fetch("/api/admin/agent-token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: action }),
        }).then(function (res) {
          if (!res.ok) throw new Error("Request failed: " + res.status);
          return res.json();
        });
      }

      function generate() {
        generateBtn.disabled = true;
        post("generate").then(function (data) {
          valueEl.textContent = data.token;
          dialog.showModal();
        }).catch(function () {
          generateBtn.disabled = false;
          generateBtn.textContent = "Failed, try again";
        });
      }

      function revoke() {
        revokeBtn.disabled = true;
        post("revoke").then(reloadOpen).catch(function () {
          revokeBtn.disabled = false;
          revokeBtn.textContent = "Failed, try again";
        });
      }

      function confirmThen(action, message) {
        pendingAction = action;
        confirmMessage.textContent = message;
        confirmDialog.showModal();
      }

      if (generateBtn) {
        generateBtn.addEventListener("click", function () {
          if (hasToken) confirmThen(generate, "Regenerate your agent token? The current one stops working.");
          else generate();
        });
      }
      if (revokeBtn) {
        revokeBtn.addEventListener("click", function () {
          confirmThen(revoke, "Revoke your agent token?");
        });
      }
      confirmCancel.addEventListener("click", function () {
        pendingAction = null;
        confirmDialog.close();
      });
      confirmOk.addEventListener("click", function () {
        confirmDialog.close();
        var action = pendingAction;
        pendingAction = null;
        if (action) action();
      });
      confirmDialog.addEventListener("cancel", function () { pendingAction = null; });

      copyBtn.addEventListener("click", async function () {
        await navigator.clipboard.writeText(valueEl.textContent || "");
        copyBtn.textContent = "Copied";
      });
      // Drop the plaintext from the DOM as soon as the dialog closes, then
      // reload so the section shows the new masked token.
      dialog.addEventListener("close", function () {
        valueEl.textContent = "";
        reloadOpen();
      });
      doneBtn.addEventListener("click", function () { dialog.close(); });
    })();
  </script>`;
}
