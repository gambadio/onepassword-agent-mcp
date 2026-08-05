const statusLine = document.querySelector("#statusLine");
const grantCount = document.querySelector("#grantCount");
const grantsEl = document.querySelector("#grants");
const sourceCandidatesEl = document.querySelector("#sourceCandidates");
const mcpCandidatesEl = document.querySelector("#mcpCandidates");
const sourceSummary = document.querySelector("#sourceSummary");
const mcpSummary = document.querySelector("#mcpSummary");
const auditEl = document.querySelector("#audit");
const settingsForm = document.querySelector("#settingsForm");
const manualForm = document.querySelector("#manualForm");
const sourceSearchInput = document.querySelector("#sourceSearchInput");
const sourceVaultSelect = document.querySelector("#sourceVaultSelect");
const sourceLimitInput = document.querySelector("#sourceLimitInput");
const mcpSearchInput = document.querySelector("#mcpSearchInput");
const mcpLimitInput = document.querySelector("#mcpLimitInput");
const mcpVaultNameLabel = document.querySelector("#mcpVaultNameLabel");
const mcpVaultStatus = document.querySelector("#mcpVaultStatus");
const createVaultBtn = document.querySelector("#createVaultBtn");
const messageEl = document.querySelector("#message");
const dropTargets = document.querySelectorAll("[data-drop-mode]");

let sourceSearchTimer;
let mcpSearchTimer;
let currentStatus;
let sourceCandidateMap = new Map();
let selectedCandidateId = "";

document.querySelector("#refreshBtn").addEventListener("click", () => runAction(refresh));
document.querySelector("#loadSourceBtn").addEventListener("click", () => runAction(loadSourceCandidates));
document.querySelector("#loadMcpBtn").addEventListener("click", () => runAction(loadMcpCandidates));
createVaultBtn.addEventListener("click", () => runAction(ensureMcpVault));
for (const target of dropTargets) {
  target.addEventListener("dragover", onDropTargetDragOver);
  target.addEventListener("dragenter", onDropTargetDragEnter);
  target.addEventListener("dragleave", onDropTargetDragLeave);
  target.addEventListener("drop", onDropTargetDrop);
  target.addEventListener("click", () => runAction(() => transferSelectedCandidate(target.dataset.dropMode)));
  target.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      runAction(() => transferSelectedCandidate(target.dataset.dropMode));
    }
  });
}

sourceSearchInput.addEventListener("input", () => {
  window.clearTimeout(sourceSearchTimer);
  sourceSearchTimer = window.setTimeout(() => runAction(loadSourceCandidates, { quiet: true }), 350);
});
sourceVaultSelect.addEventListener("change", () => runAction(loadSourceCandidates));
mcpSearchInput.addEventListener("input", () => {
  window.clearTimeout(mcpSearchTimer);
  mcpSearchTimer = window.setTimeout(() => runAction(loadMcpCandidates, { quiet: true }), 350);
});
settingsForm.addEventListener("submit", saveSettings);
manualForm.addEventListener("submit", addManualGrant);

await runAction(async () => {
  await refresh();
  await loadMcpCandidates();
}, { quiet: true });

async function refresh() {
  const [status, grants] = await Promise.all([api("/api/status"), api("/api/grants")]);
  currentStatus = status;
  renderStatus(status);
  renderSettings(status.settings);
  renderVaultOptions(status.cli?.vaults || [], status.settings.mcpVaultName);
  renderGrants(grants);
  renderAudit(status.audit);
}

function renderStatus(status) {
  const cli = status.cli || {};
  const mcpVault = cli.mcpVault || { name: status.settings.mcpVaultName, exists: false };
  const cliText = !cli.installed
    ? `1Password CLI unavailable: ${cli.error}`
    : cli.authenticated
      ? `1Password CLI ${cli.version || ""} ready`
      : `1Password CLI ${cli.version || ""} needs sign-in`;
  statusLine.textContent = `${cliText}. ${status.enabledGrants}/${status.grants} entries allowed.`;

  mcpVaultNameLabel.textContent = mcpVault.name || status.settings.mcpVaultName || "MCPVAULT";
  createVaultBtn.textContent = `Create ${mcpVault.name || "MCPVAULT"}`;
  for (const target of dropTargets) {
    const title = target.querySelector("span");
    if (!title) continue;
    title.textContent = `${target.dataset.dropMode === "move" ? "Move" : "Copy"} Into ${mcpVault.name || "MCPVAULT"}`;
  }
  createVaultBtn.hidden = Boolean(mcpVault.exists);
  createVaultBtn.disabled = !cli.installed || !cli.authenticated;
  if (mcpVault.exists) {
    const count = typeof mcpVault.items === "number" ? `${mcpVault.items} item${mcpVault.items === 1 ? "" : "s"}` : "ready";
    mcpVaultStatus.textContent = `${mcpVault.name} exists and is the only vault agents can use (${count}).`;
  } else if (cli.authError) {
    mcpVaultStatus.textContent = "1Password CLI cannot list vaults. Open and unlock 1Password, then confirm CLI integration is enabled.";
  } else if (cli.installed && cli.authenticated) {
    mcpVaultStatus.textContent = `${mcpVault.name} does not exist yet. Create it before approving logins for agents.`;
  } else {
    mcpVaultStatus.textContent = "Sign in to 1Password CLI before creating or searching the agent vault.";
  }
}

function renderSettings(settings) {
  settingsForm.mcpVaultName.value = settings.mcpVaultName || "MCPVAULT";
  settingsForm.opPath.value = settings.opPath || "op";
  settingsForm.account.value = settings.account || "";
  settingsForm.clipboardClearSeconds.value = settings.clipboardClearSeconds || 20;
  settingsForm.allowPasteWithoutSite.checked = Boolean(settings.allowPasteWithoutSite);
}

function renderVaultOptions(vaults, mcpVaultName) {
  const selected = sourceVaultSelect.value;
  const mcpKey = normalize(mcpVaultName);
  sourceVaultSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = currentStatus?.cli?.authError ? "1Password unavailable" : "Choose a source vault";
  sourceVaultSelect.append(placeholder);
  sourceVaultSelect.disabled = Boolean(currentStatus?.cli?.authError);

  for (const vault of vaults) {
    const value = vault.id || vault.name;
    if (!value) continue;
    if (normalize(vault.name) === mcpKey || normalize(vault.id) === mcpKey) continue;
    const option = document.createElement("option");
    option.value = value;
    const count = typeof vault.items === "number" ? ` (${vault.items})` : "";
    option.textContent = `${vault.name || vault.id}${count}`;
    sourceVaultSelect.append(option);
  }

  const stillExists = [...sourceVaultSelect.options].some((option) => option.value === selected);
  if (stillExists) {
    sourceVaultSelect.value = selected;
  } else if (sourceVaultSelect.options.length > 1) {
    sourceVaultSelect.selectedIndex = 1;
  }
}

function renderGrants(grants) {
  grantCount.textContent = `${grants.length} total`;
  grantsEl.innerHTML = "";
  if (!grants.length) {
    grantsEl.append(empty("No agent approvals yet. Copy a login into MCPVAULT, then approve it with allowed sites."));
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
    node.querySelector(".saveBtn").addEventListener("click", () => runAction(async () => {
      await api(`/api/grants/${grant.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          sites: splitCsv(sitesInput.value),
          enabled: enabledInput.checked,
        }),
      });
      await refresh();
      setMessage(`Saved ${grant.title}.`);
    }));
    node.querySelector(".deleteBtn").addEventListener("click", () => runAction(async () => {
      await api(`/api/grants/${grant.id}`, { method: "DELETE" });
      await refresh();
      setMessage(`Deleted ${grant.title}.`);
    }));
    grantsEl.append(node);
  }
}

async function ensureMcpVault() {
  const name = currentStatus?.settings?.mcpVaultName || "MCPVAULT";
  const ok = window.confirm(`Create an empty 1Password vault named "${name}"?\n\nNothing is moved or copied until you choose items.`);
  if (!ok) return;
  const result = await api("/api/op/mcp-vault", { method: "POST" });
  await refresh();
  await loadMcpCandidates();
  setMessage(result.created ? `Created ${name}.` : `${name} already exists.`);
}

async function loadSourceCandidates() {
  sourceCandidatesEl.innerHTML = "";
  sourceSummary.textContent = "";
  if (currentStatus?.cli?.authError) {
    sourceCandidatesEl.append(empty("1Password CLI cannot reach the desktop app. Open and unlock 1Password, then refresh."));
    return;
  }
  const vault = sourceVaultSelect.value.trim();
  if (!vault) {
    sourceCandidatesEl.append(empty("Choose a source vault to search."));
    return;
  }
  sourceCandidatesEl.append(empty("Searching 1Password..."));

  const params = new URLSearchParams({
    vault,
    limit: sourceLimitInput.value || "100",
  });
  const query = sourceSearchInput.value.trim();
  if (query) params.set("q", query);

  const result = await api(`/api/op/candidates?${params}`);
  renderSourceCandidates(result);
}

function renderSourceCandidates(result) {
  const candidates = result.items || [];
  sourceCandidateMap = new Map();
  selectedCandidateId = "";
  sourceCandidatesEl.innerHTML = "";
  sourceSummary.textContent = `${result.shown} shown of ${result.matched} matches (${result.total} total in this vault).`;
  if (!candidates.length) {
    sourceCandidatesEl.append(empty("No matching Login or Password items found in this source vault."));
    return;
  }
  const template = document.querySelector("#sourceCandidateTemplate");
  for (const [index, candidate] of candidates.entries()) {
    const dragId = `source-${Date.now()}-${index}`;
    sourceCandidateMap.set(dragId, candidate);
    const node = template.content.cloneNode(true);
    const article = node.querySelector("article");
    article.draggable = true;
    article.dataset.dragId = dragId;
    article.setAttribute("aria-label", `${candidate.title}. Drag or click to select.`);
    article.querySelector("h3").textContent = candidate.title;
    article.querySelector(".meta").textContent = [
      candidate.vaultName ? `vault: ${candidate.vaultName}` : "",
      candidate.sites.length ? `site: ${candidate.sites.join(", ")}` : "no website saved",
      `field: ${candidate.fieldLabel}`,
    ].filter(Boolean).join(" | ");
    article.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("button")) return;
      selectSourceCandidate(dragId);
    });
    article.addEventListener("dragstart", (event) => {
      selectedCandidateId = dragId;
      event.dataTransfer.setData("application/x-opmcp-candidate", dragId);
      event.dataTransfer.setData("text/plain", candidate.title);
      event.dataTransfer.effectAllowed = "copyMove";
      article.classList.add("dragging");
      document.body.classList.add("isDragging");
    });
    article.addEventListener("dragend", () => {
      article.classList.remove("dragging");
      document.body.classList.remove("isDragging");
      clearDropHighlights();
    });
    node.querySelector(".copyBtn").addEventListener("click", () => runAction(async () => {
      selectSourceCandidate(dragId);
      await transferCandidate(candidate, "copy");
    }));
    node.querySelector(".moveBtn").addEventListener("click", () => runAction(async () => {
      selectSourceCandidate(dragId);
      const name = currentStatus?.settings?.mcpVaultName || "MCPVAULT";
      const ok = window.confirm(`Move "${candidate.title}" into ${name}?\n\n1Password will remove it from the source vault and create a new item in ${name}.`);
      if (!ok) return;
      await transferCandidate(candidate, "move");
    }));
    sourceCandidatesEl.append(node);
  }
}

function selectSourceCandidate(dragId) {
  selectedCandidateId = dragId;
  for (const item of sourceCandidatesEl.querySelectorAll(".item")) {
    item.classList.toggle("selected", item.dataset.dragId === dragId);
  }
  const candidate = sourceCandidateMap.get(dragId);
  if (candidate) setMessage(`Selected ${candidate.title}. Drop it into MCPVAULT or click a drop target.`);
}

async function transferSelectedCandidate(mode = "copy") {
  const candidate = sourceCandidateMap.get(selectedCandidateId);
  if (!candidate) {
    setMessage("Select or drag a source login first.", true);
    return;
  }
  if (mode === "move") {
    const name = currentStatus?.settings?.mcpVaultName || "MCPVAULT";
    const ok = window.confirm(`Move "${candidate.title}" into ${name}?\n\n1Password will remove it from the source vault and create a new item in ${name}.`);
    if (!ok) return;
  }
  await transferCandidate(candidate, mode);
}

async function transferCandidate(candidate, mode) {
  const name = currentStatus?.settings?.mcpVaultName || "MCPVAULT";
  await api("/api/op/transfer", {
    method: "POST",
    body: JSON.stringify({ token: candidate.token, mode }),
  });
  await refresh();
  await Promise.all([loadSourceCandidates(), loadMcpCandidates()]);
  setMessage(`${mode === "move" ? "Moved" : "Copied"} ${candidate.title} into ${name}.`);
}

function onDropTargetDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = event.currentTarget.dataset.dropMode === "move" ? "move" : "copy";
}

function onDropTargetDragEnter(event) {
  event.preventDefault();
  event.currentTarget.classList.add("dragOver");
}

function onDropTargetDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    event.currentTarget.classList.remove("dragOver");
  }
}

function onDropTargetDrop(event) {
  event.preventDefault();
  const dragId = event.dataTransfer.getData("application/x-opmcp-candidate") || selectedCandidateId;
  selectedCandidateId = dragId;
  clearDropHighlights();
  runAction(() => transferSelectedCandidate(event.currentTarget.dataset.dropMode));
}

function clearDropHighlights() {
  for (const target of dropTargets) {
    target.classList.remove("dragOver");
  }
}

async function loadMcpCandidates() {
  mcpCandidatesEl.innerHTML = "";
  mcpSummary.textContent = "";
  const mcpVault = currentStatus?.cli?.mcpVault;
  const name = currentStatus?.settings?.mcpVaultName || "MCPVAULT";
  if (currentStatus?.cli?.authError) {
    mcpCandidatesEl.append(empty("1Password CLI cannot reach the desktop app. Open and unlock 1Password, then refresh."));
    return;
  }
  if (!mcpVault?.exists) {
    mcpCandidatesEl.append(empty(`Create ${name} first, then copy logins into it.`));
    return;
  }
  mcpCandidatesEl.append(empty(`Searching ${name}...`));

  const params = new URLSearchParams({
    vault: mcpVault.name || name,
    limit: mcpLimitInput.value || "100",
  });
  const query = mcpSearchInput.value.trim();
  if (query) params.set("q", query);

  const result = await api(`/api/op/candidates?${params}`);
  renderMcpCandidates(result);
}

function renderMcpCandidates(result) {
  const candidates = result.items || [];
  mcpCandidatesEl.innerHTML = "";
  mcpSummary.textContent = `${result.shown} shown of ${result.matched} matches (${result.total} total in agent vault).`;
  if (!candidates.length) {
    mcpCandidatesEl.append(empty("No matching Login or Password items found in the agent vault."));
    return;
  }
  const template = document.querySelector("#mcpCandidateTemplate");
  for (const candidate of candidates) {
    const node = template.content.cloneNode(true);
    node.querySelector("h3").textContent = candidate.title;
    node.querySelector(".meta").textContent = [
      candidate.vaultName ? `vault: ${candidate.vaultName}` : "",
      candidate.sites.length ? `site: ${candidate.sites.join(", ")}` : "add allowed sites before approving",
      `field: ${candidate.fieldLabel}`,
    ].filter(Boolean).join(" | ");
    const sitesInput = node.querySelector(".sitesInput");
    sitesInput.value = candidate.sites.join(", ");
    node.querySelector(".approveBtn").addEventListener("click", () => runAction(async () => {
      const sites = splitCsv(sitesInput.value);
      if (!sites.length) {
        setMessage("Add at least one allowed site before approving.", true);
        sitesInput.focus();
        return;
      }
      await api("/api/grants/import", {
        method: "POST",
        body: JSON.stringify({
          token: candidate.token,
          sites,
        }),
      });
      await refresh();
      await loadMcpCandidates();
      setMessage(`Approved ${candidate.title} for agents.`);
    }));
    mcpCandidatesEl.append(node);
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
  await runAction(async () => {
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        mcpVaultName: settingsForm.mcpVaultName.value,
        opPath: settingsForm.opPath.value,
        account: settingsForm.account.value,
        clipboardClearSeconds: Number(settingsForm.clipboardClearSeconds.value),
        allowPasteWithoutSite: settingsForm.allowPasteWithoutSite.checked,
      }),
    });
    await refresh();
    await loadMcpCandidates();
    setMessage("Saved local settings.");
  });
}

async function addManualGrant(event) {
  event.preventDefault();
  await runAction(async () => {
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
    setMessage("Added manual access.");
  });
}

async function runAction(action, options = {}) {
  try {
    if (!options.quiet) setMessage("");
    await action();
  } catch (error) {
    setMessage(error.message || String(error), true);
  }
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

function setMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle("error", Boolean(isError));
  messageEl.hidden = !text;
}

function splitCsv(value) {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function normalize(value) {
  return (value || "").trim().toLowerCase();
}

function empty(text) {
  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = text;
  return div;
}
