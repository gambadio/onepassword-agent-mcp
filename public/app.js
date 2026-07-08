const statusLine = document.querySelector("#statusLine");
const grantCount = document.querySelector("#grantCount");
const grantsEl = document.querySelector("#grants");
const candidatesEl = document.querySelector("#candidates");
const candidateSummary = document.querySelector("#candidateSummary");
const auditEl = document.querySelector("#audit");
const settingsForm = document.querySelector("#settingsForm");
const manualForm = document.querySelector("#manualForm");
const candidateSearchInput = document.querySelector("#candidateSearchInput");
const vaultInput = document.querySelector("#vaultInput");
const limitInput = document.querySelector("#limitInput");
const vaultOptions = document.querySelector("#vaultOptions");

let candidateSearchTimer;

document.querySelector("#refreshBtn").addEventListener("click", refresh);
document.querySelector("#loadCandidatesBtn").addEventListener("click", loadCandidates);
candidateSearchInput.addEventListener("input", () => {
  window.clearTimeout(candidateSearchTimer);
  candidateSearchTimer = window.setTimeout(loadCandidates, 350);
});
vaultInput.addEventListener("change", loadCandidates);
settingsForm.addEventListener("submit", saveSettings);
manualForm.addEventListener("submit", addManualGrant);

await refresh();

async function refresh() {
  const [status, grants] = await Promise.all([api("/api/status"), api("/api/grants")]);
  renderStatus(status);
  renderSettings(status.settings);
  renderVaultOptions(status.cli.vaults || []);
  renderGrants(grants);
  renderAudit(status.audit);
}

function renderStatus(status) {
  const cli = !status.cli.installed
    ? `1Password CLI unavailable: ${status.cli.error}`
    : status.cli.authenticated
      ? `1Password CLI ${status.cli.version || ""} ready`
      : `1Password CLI ${status.cli.version || ""} needs sign-in`;
  statusLine.textContent = `${cli}. ${status.enabledGrants}/${status.grants} entries allowed.`;
}

function renderSettings(settings) {
  settingsForm.opPath.value = settings.opPath || "op";
  settingsForm.account.value = settings.account || "";
  settingsForm.defaultVault.value = settings.defaultVault || "";
  settingsForm.clipboardClearSeconds.value = settings.clipboardClearSeconds || 20;
  settingsForm.allowPasteWithoutSite.checked = Boolean(settings.allowPasteWithoutSite);
}

function renderVaultOptions(vaults) {
  vaultOptions.innerHTML = "";
  for (const vault of vaults) {
    const option = document.createElement("option");
    option.value = vault.name || vault.id;
    vaultOptions.append(option);
  }
}

function renderGrants(grants) {
  grantCount.textContent = `${grants.length} total`;
  grantsEl.innerHTML = "";
  if (!grants.length) {
    grantsEl.append(empty("No entries allowed yet. Search 1Password and approve only the logins your agents may use."));
    return;
  }
  const template = document.querySelector("#grantTemplate");
  for (const grant of grants) {
    const node = template.content.cloneNode(true);
    node.querySelector("h3").textContent = grant.title;
    node.querySelector(".meta").textContent = [
      grant.username ? `user: ${grant.username}` : "",
      grant.vaultName ? `vault: ${grant.vaultName}` : "",
      `field: ${grant.fieldLabel}`,
    ].filter(Boolean).join(" | ");
    const sitesInput = node.querySelector(".sitesInput");
    sitesInput.value = grant.sites.join(", ");
    const enabledInput = node.querySelector(".enabledInput");
    enabledInput.checked = grant.enabled;
    node.querySelector(".saveBtn").addEventListener("click", async () => {
      await api(`/api/grants/${grant.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          sites: splitCsv(sitesInput.value),
          enabled: enabledInput.checked,
        }),
      });
      await refresh();
    });
    node.querySelector(".deleteBtn").addEventListener("click", async () => {
      await api(`/api/grants/${grant.id}`, { method: "DELETE" });
      await refresh();
    });
    grantsEl.append(node);
  }
}

async function loadCandidates() {
  candidatesEl.innerHTML = "";
  candidatesEl.append(empty("Searching 1Password..."));
  candidateSummary.textContent = "";

  const params = new URLSearchParams({
    limit: limitInput.value || "100",
  });
  const vault = vaultInput.value.trim();
  const query = candidateSearchInput.value.trim();
  if (vault) params.set("vault", vault);
  if (query) params.set("q", query);

  const result = await api(`/api/op/candidates?${params}`);
  renderCandidates(result);
}

function renderCandidates(result) {
  const candidates = Array.isArray(result) ? result : result.items;
  candidatesEl.innerHTML = "";
  if (!Array.isArray(result)) {
    candidateSummary.textContent = `${result.shown} shown of ${result.matched} matches (${result.total} total in scope).`;
  }
  if (!candidates.length) {
    candidatesEl.append(empty("No matching Login or Password items found."));
    return;
  }
  const template = document.querySelector("#candidateTemplate");
  for (const candidate of candidates) {
    const node = template.content.cloneNode(true);
    node.querySelector("h3").textContent = candidate.title;
    node.querySelector(".meta").textContent = [
      candidate.vaultName ? `vault: ${candidate.vaultName}` : "",
      candidate.sites.length ? `site: ${candidate.sites.join(", ")}` : "",
      `field: ${candidate.fieldLabel}`,
    ].filter(Boolean).join(" | ");
    const sitesInput = node.querySelector(".sitesInput");
    sitesInput.value = candidate.sites.join(", ");
    node.querySelector(".approveBtn").addEventListener("click", async () => {
      await api("/api/grants/import", {
        method: "POST",
        body: JSON.stringify({
          token: candidate.token,
          sites: splitCsv(sitesInput.value),
        }),
      });
      candidateSearchInput.focus();
      await refresh();
      await loadCandidates();
    });
    candidatesEl.append(node);
  }
}

function renderAudit(events) {
  auditEl.innerHTML = "";
  if (!events.length) {
    auditEl.append(empty("No activity yet."));
    return;
  }
  for (const event of events) {
    const div = document.createElement("div");
    div.textContent = `${new Date(event.createdAt).toLocaleString()} - ${event.message}`;
    auditEl.append(div);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify({
      opPath: settingsForm.opPath.value,
      account: settingsForm.account.value,
      defaultVault: settingsForm.defaultVault.value,
      clipboardClearSeconds: Number(settingsForm.clipboardClearSeconds.value),
      allowPasteWithoutSite: settingsForm.allowPasteWithoutSite.checked,
    }),
  });
  await refresh();
}

async function addManualGrant(event) {
  event.preventDefault();
  const data = new FormData(manualForm);
  await api("/api/grants/manual", {
    method: "POST",
    body: JSON.stringify({
      title: data.get("title"),
      secretRef: data.get("secretRef"),
      sites: splitCsv(String(data.get("sites") || "")),
      username: data.get("username"),
    }),
  });
  manualForm.reset();
  await refresh();
}

async function api(path, options = {}) {
  const adminToken = localStorage.getItem("adminToken") || "";
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { "x-admin-token": adminToken } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    if (response.status === 401) {
      const token = prompt("Admin token");
      if (token) {
        localStorage.setItem("adminToken", token);
        return await api(path, options);
      }
    }
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).error || text;
    } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return await response.json();
}

function splitCsv(value) {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function empty(text) {
  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = text;
  return div;
}
