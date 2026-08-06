const statusLine = document.querySelector("#statusLine");
const grantCount = document.querySelector("#grantCount");
const grantsEl = document.querySelector("#grants");
const sourceCandidatesEl = document.querySelector("#sourceCandidates");
const mcpCandidatesEl = document.querySelector("#mcpCandidates");
const sourceSummary = document.querySelector("#sourceSummary");
const mcpSummary = document.querySelector("#mcpSummary");
const auditEl = document.querySelector("#audit");
const profileEntriesEl = document.querySelector("#profileEntries");
const settingsForm = document.querySelector("#settingsForm");
const manualForm = document.querySelector("#manualForm");
const profileForm = document.querySelector("#profileForm");
const sourceSearchInput = document.querySelector("#sourceSearchInput");
const sourceVaultSelect = document.querySelector("#sourceVaultSelect");
const sourceGroupSelect = document.querySelector("#sourceGroupSelect");
const sourceLimitInput = document.querySelector("#sourceLimitInput");
const mcpSearchInput = document.querySelector("#mcpSearchInput");
const mcpLimitInput = document.querySelector("#mcpLimitInput");
const secretGroupButtons = document.querySelectorAll("[data-secret-group]");
const mcpVaultNameLabel = document.querySelector("#mcpVaultNameLabel");
const mcpVaultStatus = document.querySelector("#mcpVaultStatus");
const createVaultBtn = document.querySelector("#createVaultBtn");
const messageEl = document.querySelector("#message");
const mcpVaultDrop = document.querySelector("#mcpVaultDrop");
const transferDialog = document.querySelector("#transferDialog");
const transferDialogText = document.querySelector("#transferDialogText");
const transferCopyBtn = document.querySelector("#transferCopyBtn");
const transferMoveBtn = document.querySelector("#transferMoveBtn");
const transferCancelBtn = document.querySelector("#transferCancelBtn");
const menuBarStatus = document.querySelector("#menuBarStatus");
const menuBarDescription = document.querySelector("#menuBarDescription");
const menuBarToggle = document.querySelector("#menuBarToggle");
const menuBarLoginToggle = document.querySelector("#menuBarLoginToggle");
const menuBarLaunchBtn = document.querySelector("#menuBarLaunchBtn");
const menuBarUpdateBtn = document.querySelector("#menuBarUpdateBtn");

let sourceSearchTimer;
let mcpSearchTimer;
let currentStatus;
let currentGrants = [];
let sourceCandidateMap = new Map();
let lastSourceResult = null;
let selectedCandidateId = "";
let pendingTransferCandidate = null;
let activeSecretGroup = "all";
let expandedApprovalItems = new Set();

document.querySelector("#refreshBtn").addEventListener("click", () => runAction(refresh));
document.querySelector("#loadSourceBtn").addEventListener("click", () => runAction(loadSourceCandidates));
document.querySelector("#loadMcpBtn").addEventListener("click", () => runAction(loadMcpCandidates));
createVaultBtn.addEventListener("click", () => runAction(ensureMcpVault));
mcpVaultDrop.addEventListener("dragover", onMcpVaultDragOver);
mcpVaultDrop.addEventListener("dragenter", onMcpVaultDragEnter);
mcpVaultDrop.addEventListener("dragleave", onMcpVaultDragLeave);
mcpVaultDrop.addEventListener("drop", onMcpVaultDrop);
transferCopyBtn.addEventListener("click", () => runAction(() => runPendingTransfer("copy")));
transferMoveBtn.addEventListener("click", () => runAction(() => runPendingTransfer("move")));
transferCancelBtn.addEventListener("click", closeTransferDialog);
transferDialog.addEventListener("click", (event) => {
  if (event.target === transferDialog || (event.target instanceof Element && event.target.classList.contains("dialogShade"))) {
    closeTransferDialog();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !transferDialog.hidden) closeTransferDialog();
});

sourceSearchInput.addEventListener("input", () => {
  window.clearTimeout(sourceSearchTimer);
  sourceSearchTimer = window.setTimeout(() => runAction(loadSourceCandidates, { quiet: true }), 350);
});
sourceVaultSelect.addEventListener("change", () => {
  runAction(loadSourceCandidates);
});
sourceGroupSelect.addEventListener("change", () => runAction(loadSourceCandidates));
mcpSearchInput.addEventListener("input", () => {
  window.clearTimeout(mcpSearchTimer);
  mcpSearchTimer = window.setTimeout(() => runAction(loadMcpCandidates, { quiet: true }), 350);
});
for (const button of secretGroupButtons) {
  button.addEventListener("click", () => {
    activeSecretGroup = button.dataset.secretGroup || "all";
    if (activeSecretGroup === "all") {
      expandedApprovalItems = new Set();
    }
    renderSecretGroupButtons();
    runAction(loadMcpCandidates, { quiet: true });
  });
}
settingsForm.addEventListener("submit", saveSettings);
manualForm.addEventListener("submit", addManualGrant);
profileForm.addEventListener("submit", addProfileEntry);
menuBarToggle.addEventListener("change", () => runAction(toggleMenuBar));
menuBarLoginToggle.addEventListener("change", () => runAction(toggleMenuBarLogin));
menuBarLaunchBtn.addEventListener("click", () => runAction(launchMenuBarShortcut));
menuBarUpdateBtn.addEventListener("click", () => runAction(updateMenuBarShortcut));

await runAction(async () => {
  await refresh();
  await loadMcpCandidates();
}, { quiet: true });

async function refresh() {
  const [status, grants, profile, menuBar] = await Promise.all([
    api("/api/status"),
    api("/api/grants"),
    api("/api/profile"),
    api("/api/menubar"),
  ]);
  currentStatus = status;
  currentGrants = grants || [];
  renderStatus(status);
  renderSettings(status.settings);
  renderVaultOptions(status.cli?.vaults || [], status.settings.mcpVaultName);
  renderGrants(grants);
  renderProfile(profile);
  renderMenuBar(menuBar);
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
  mcpVaultDrop.classList.toggle("unavailable", !mcpVault.exists);
  mcpVaultDrop.setAttribute("aria-disabled", String(!mcpVault.exists));
  createVaultBtn.hidden = Boolean(mcpVault.exists);
  createVaultBtn.disabled = !cli.installed || !cli.authenticated;
  if (mcpVault.exists) {
    const count = typeof mcpVault.items === "number" ? `${mcpVault.items} item${mcpVault.items === 1 ? "" : "s"}` : "ready";
    mcpVaultStatus.textContent = `${mcpVault.name} exists and is the only vault agents can use (${count}).`;
  } else if (cli.authError) {
    mcpVaultStatus.textContent = "1Password CLI cannot list vaults. Open and unlock 1Password, then confirm CLI integration is enabled.";
  } else if (cli.installed && cli.authenticated) {
    mcpVaultStatus.textContent = `${mcpVault.name} does not exist yet. Create it before approving items for agents.`;
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
  settingsForm.allowAgentItemCreate.checked = Boolean(settings.allowAgentItemCreate);
}

function renderMenuBar(status) {
  menuBarToggle.checked = Boolean(status.installed);
  menuBarLoginToggle.checked = Boolean(status.launchAtLogin);
  menuBarToggle.disabled = !status.supported || (!status.compilerAvailable && !status.installed);
  menuBarLoginToggle.disabled = !status.installed;
  menuBarLaunchBtn.hidden = !status.installed || status.running;
  menuBarUpdateBtn.hidden = !status.needsUpdate;

  if (!status.supported) {
    menuBarStatus.textContent = "macOS only";
    menuBarDescription.textContent = status.reason || "This optional shortcut is available on macOS only.";
    return;
  }
  if (!status.installed) {
    menuBarStatus.textContent = "Not installed";
    menuBarDescription.textContent = status.reason
      || "Optional. Enable it to build a small transparent local app and place it in your user Applications folder.";
    return;
  }

  menuBarStatus.textContent = status.running ? "Visible now" : "Installed";
  const loginText = status.launchAtLogin ? " It will reappear after your next Mac login." : " It will not start at login.";
  menuBarDescription.textContent = `The shortcut is ${status.running ? "visible in the menu bar" : "installed but currently closed"}.${loginText}`;
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
    grantsEl.append(empty("No agent approvals yet. Copy an item into MCPVAULT, then approve fields. Blank allowed sites means all sites."));
    return;
  }
  const template = document.querySelector("#grantTemplate");
  for (const grant of grants) {
    const node = template.content.cloneNode(true);
    node.querySelector("h3").textContent = grant.title;
    node.querySelector(".meta").textContent = [
      grant.username ? `user: ${grant.username}` : "",
      grant.vaultName ? `vault: ${grant.vaultName}` : "",
      grant.kind ? `kind: ${formatKind(grant.kind)}` : "",
      `field: ${grant.fieldLabel}`,
    ].filter(Boolean).join(" | ");
    const sitesInput = node.querySelector(".sitesInput");
    sitesInput.value = grant.sites.join(", ");
    sitesInput.placeholder = "blank means all sites";
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
      setMessage(`Saved ${grant.title}${splitCsv(sitesInput.value).length ? "." : " for all sites."}`);
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
    lastSourceResult = null;
    return;
  }
  const vault = sourceVaultSelect.value.trim();
  if (!vault) {
    sourceCandidatesEl.append(empty("Choose a source vault to search."));
    lastSourceResult = null;
    return;
  }
  sourceCandidatesEl.append(empty("Searching 1Password..."));

  const params = new URLSearchParams({
    vault,
    limit: sourceLimitInput.value || "500",
    mode: "primary",
    group: sourceGroupSelect.value || "all",
  });
  const query = sourceSearchInput.value.trim();
  if (query) params.set("q", query);

  const result = await api(`/api/op/candidates?${params}`);
  renderSourceCandidates(result);
}

function renderSourceCandidates(result) {
  const candidates = result.items || [];
  lastSourceResult = result;
  sourceCandidateMap = new Map();
  selectedCandidateId = "";
  sourceCandidatesEl.innerHTML = "";
  sourceSummary.textContent = `${result.shown} shown of ${result.matched} ${groupLabel(result.activeGroup)} matches (${result.total} total in this vault).`;
  if (!candidates.length) {
    sourceCandidatesEl.append(empty(`No matching ${groupLabel(result.activeGroup)} items with usable fields found in this source vault.`));
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
      candidate.category ? `category: ${formatCategory(candidate.category)}` : "",
      candidate.sites.length ? `site: ${candidate.sites.join(", ")}` : "no website saved",
      candidate.fieldLabel ? `primary field: ${candidate.fieldLabel}` : "",
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
      const ok = window.confirm(`Move "${candidate.itemTitle || candidate.title}" into ${name}?\n\n1Password will remove it from the source vault and create a new item in ${name}.`);
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
  if (candidate) setMessage(`Selected ${candidate.itemTitle || candidate.title}. Drop it on the right side, then choose Copy or Move.`);
}

async function openSelectedCandidateTransfer() {
  const name = currentStatus?.settings?.mcpVaultName || "MCPVAULT";
  if (!currentStatus?.cli?.mcpVault?.exists) {
    setMessage(`Create ${name} first, then drag items into it.`, true);
    return;
  }
  const candidate = sourceCandidateMap.get(selectedCandidateId);
  if (!candidate) {
    setMessage("Select or drag a source item first.", true);
    return;
  }
  openTransferDialog(candidate);
}

function openTransferDialog(candidate) {
  pendingTransferCandidate = candidate;
  const name = currentStatus?.settings?.mcpVaultName || "MCPVAULT";
  const sourceVault = candidate.vaultName || selectedVaultLabel(sourceVaultSelect) || "the source vault";
  transferDialog.querySelector("h2").textContent = `Put "${candidate.itemTitle || candidate.title}" in ${name}?`;
  transferDialogText.textContent = `Copy keeps it in ${sourceVault}. Move removes it from ${sourceVault} after creating the new item in ${name}. Nothing is shared with agents until you approve details.`;
  transferDialog.hidden = false;
  transferCopyBtn.focus();
}

function closeTransferDialog() {
  transferDialog.hidden = true;
  pendingTransferCandidate = null;
}

async function runPendingTransfer(mode) {
  const candidate = pendingTransferCandidate;
  if (!candidate) return;
  closeTransferDialog();
  await transferCandidate(candidate, mode);
}

async function transferCandidate(candidate, mode) {
  const name = currentStatus?.settings?.mcpVaultName || "MCPVAULT";
  await api("/api/op/transfer", {
    method: "POST",
    body: JSON.stringify({ token: candidate.token, mode }),
  });
  activeSecretGroup = groupFromCategory(candidate.category);
  renderSecretGroupButtons();
  mcpSearchInput.value = "";
  updateSourceAfterTransfer(candidate, mode);
  await loadMcpCandidates();
  setMessage(`${mode === "move" ? "Moved" : "Copied"} ${candidate.itemTitle || candidate.title} into ${name}. Next, choose which details agents may use.`);
}

function onMcpVaultDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

function onMcpVaultDragEnter(event) {
  event.preventDefault();
  event.currentTarget.classList.add("dragOver");
}

function onMcpVaultDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    event.currentTarget.classList.remove("dragOver");
  }
}

function onMcpVaultDrop(event) {
  event.preventDefault();
  const dragId = event.dataTransfer.getData("application/x-opmcp-candidate") || selectedCandidateId;
  selectedCandidateId = dragId;
  clearDropHighlights();
  runAction(openSelectedCandidateTransfer);
}

function clearDropHighlights() {
  mcpVaultDrop.classList.remove("dragOver");
}

function updateSourceAfterTransfer(candidate, mode) {
  if (mode !== "move" || !lastSourceResult?.items?.length) {
    return;
  }
  const before = lastSourceResult.items.length;
  const items = lastSourceResult.items.filter((item) => {
    if (candidate.itemId && item.itemId) return item.itemId !== candidate.itemId;
    return item.token !== candidate.token;
  });
  const removed = before - items.length;
  if (!removed) return;
  renderSourceCandidates({
    ...lastSourceResult,
    items,
    shown: Math.max(0, (lastSourceResult.shown || before) - removed),
    matched: Math.max(0, (lastSourceResult.matched || before) - removed),
    total: Math.max(0, (lastSourceResult.total || before) - removed),
  });
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
    mcpCandidatesEl.append(empty(`Create ${name} first, then copy items into it.`));
    return;
  }
  mcpCandidatesEl.append(empty(`Searching ${name}...`));

  const params = new URLSearchParams({
    vault: mcpVault.name || name,
    limit: mcpLimitInput.value || "500",
    mode: "all",
    group: activeSecretGroup,
  });
  const query = mcpSearchInput.value.trim();
  if (query) params.set("q", query);

  const result = await api(`/api/op/candidates?${params}`);
  renderMcpCandidates(result);
}

function renderMcpCandidates(result) {
  const candidates = result.items || [];
  const groups = groupCandidatesByItem(candidates);
  mcpCandidatesEl.innerHTML = "";
  renderSecretGroupCounts(result.groups || {});
  mcpSummary.textContent = formatMcpSummary(result, groups);
  if (!groups.length) {
    mcpCandidatesEl.append(empty(`No ${approvalGroupLabel(result.activeGroup)} items are ready to approve yet. Copy one from the left side first.`));
    return;
  }
  const template = document.querySelector("#mcpCandidateTemplate");
  for (const group of groups) {
    const node = template.content.cloneNode(true);
    const article = node.querySelector("article");
    article.classList.add(`approval-${group.type}`);
    article.dataset.itemKey = group.key;
    node.querySelector(".itemBadge").textContent = groupBadge(group.type);
    node.querySelector("h3").textContent = group.title;
    node.querySelector(".approvalPlain").textContent = groupIntro(group);
    node.querySelector(".meta").textContent = [
      group.category ? `category: ${formatCategory(group.category)}` : "",
      `${group.candidates.length} detail${group.candidates.length === 1 ? "" : "s"} found`,
      group.defaultSites.length ? `saved website: ${group.defaultSites.join(", ")}` : "no website saved",
    ].filter(Boolean).join(" | ");
    const stats = approvalStats(group);
    node.querySelector(".approvalStatus").textContent = approvalStatusText(stats);
    const body = node.querySelector(".approvalBody");
    const toggleButton = node.querySelector(".toggleApprovalBtn");
    const expanded = expandedApprovalItems.has(group.key) || (activeSecretGroup !== "all" && groups.length === 1);
    setApprovalExpanded(article, body, toggleButton, expanded);
    toggleButton.addEventListener("click", () => {
      const next = body.hidden;
      if (next) expandedApprovalItems.add(group.key);
      else expandedApprovalItems.delete(group.key);
      setApprovalExpanded(article, body, toggleButton, next);
    });
    const sitesInput = node.querySelector(".sitesInput");
    sitesInput.value = group.defaultSites.join(", ");
    const fieldList = node.querySelector(".fieldList");
    const destinationVaultSelect = node.querySelector(".destinationVaultSelect");
    const copyOutButton = node.querySelector(".copyOutBtn");
    const moveOutButton = node.querySelector(".moveOutBtn");
    renderDestinationVaultOptions(destinationVaultSelect);
    const canExport = destinationVaultSelect.options.length > 1;
    copyOutButton.disabled = !canExport;
    moveOutButton.disabled = !canExport;
    for (const [index, candidate] of group.candidates.entries()) {
      const copy = fieldCopy(candidate);
      const approved = isApprovedCandidate(candidate);
      const row = document.createElement("label");
      row.className = `fieldChoice ${copy.sensitive ? "sensitive" : ""} ${approved ? "approved" : ""}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = String(index);
      checkbox.checked = approved || copy.suggested;
      checkbox.disabled = approved;
      const text = document.createElement("span");
      text.className = "fieldChoiceText";
      const title = document.createElement("strong");
      title.textContent = copy.title;
      const description = document.createElement("small");
      description.textContent = copy.description;
      const tag = document.createElement("em");
      tag.textContent = approved ? "Already approved" : copy.tag;
      tag.className = approved ? "approvedTag" : copy.sensitive ? "sensitiveTag" : "suggestedTag";
      text.append(title, description);
      row.append(checkbox, text, tag);
      fieldList.append(row);
    }
    const approveButton = node.querySelector(".approveSelectedBtn");
    const selectableCount = group.candidates.filter((candidate) => !isApprovedCandidate(candidate)).length;
    approveButton.disabled = selectableCount === 0;
    approveButton.textContent = selectableCount === 0 ? "Everything Approved" : "Approve Selected";
    node.querySelector(".selectRecommendedBtn").addEventListener("click", () => {
      for (const checkbox of fieldList.querySelectorAll("input[type='checkbox']")) {
        if (checkbox.disabled) continue;
        const candidate = group.candidates[Number(checkbox.value)];
        checkbox.checked = fieldCopy(candidate).suggested;
      }
      setMessage("Selected the suggested details. Review them, then approve.");
    });
    copyOutButton.addEventListener("click", () => runAction(async () => {
      await transferMcpItemToVault(group, destinationVaultSelect.value, "copy");
    }));
    moveOutButton.addEventListener("click", () => runAction(async () => {
      const destination = selectedVaultLabel(destinationVaultSelect);
      const name = currentStatus?.settings?.mcpVaultName || "MCPVAULT";
      const ok = window.confirm(`Move "${group.title}" to ${destination}?\n\nThis removes the item from ${name}. Agents will no longer be able to use it from the agent vault, and local approvals for this copied item will be removed.`);
      if (!ok) return;
      await transferMcpItemToVault(group, destinationVaultSelect.value, "move");
    }));
    approveButton.addEventListener("click", () => runAction(async () => {
      const sites = splitCsv(sitesInput.value);
      const selected = [...fieldList.querySelectorAll("input[type='checkbox']")]
        .filter((checkbox) => checkbox.checked && !checkbox.disabled)
        .map((checkbox) => group.candidates[Number(checkbox.value)])
        .filter(Boolean);
      if (!selected.length) {
        setMessage("Choose at least one detail to approve. Nothing has been shared yet.", true);
        return;
      }
      for (const candidate of selected) {
        await api("/api/grants/import", {
          method: "POST",
          body: JSON.stringify({
            token: candidate.token,
            sites,
          }),
        });
      }
      await refresh();
      await loadMcpCandidates();
      setMessage(`Approved ${selected.length} detail${selected.length === 1 ? "" : "s"} from ${group.title} for ${sites.length ? sites.join(", ") : "all websites"}.`);
    }));
    node.querySelector(".deleteItemBtn").addEventListener("click", () => runAction(async () => {
      const name = currentStatus?.settings?.mcpVaultName || "MCPVAULT";
      const ok = window.confirm(`Delete "${group.title}" from ${name}?\n\nThis deletes the whole copied item from the agent vault, not just one detail. 1Password will move it to Recently Deleted. Any local agent approvals for this item will also be removed.`);
      if (!ok) return;
      await api("/api/op/mcp-vault/items/delete", {
        method: "POST",
        body: JSON.stringify({ token: group.candidates[0].token }),
      });
      await refresh();
      await loadMcpCandidates();
      setMessage(`Deleted ${group.title} from ${name}.`);
    }));
    mcpCandidatesEl.append(node);
  }
}

function renderDestinationVaultOptions(select) {
  const selected = select.value;
  const mcpVault = currentStatus?.cli?.mcpVault || {};
  const vaults = currentStatus?.cli?.vaults || [];
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = currentStatus?.cli?.authError ? "1Password unavailable" : "Choose destination";
  select.append(placeholder);
  for (const vault of vaults) {
    const value = vault.id || vault.name;
    if (!value) continue;
    if (vaultEquals(vault, mcpVault)) continue;
    const option = document.createElement("option");
    option.value = value;
    const count = typeof vault.items === "number" ? ` (${vault.items})` : "";
    option.textContent = `${vault.name || vault.id}${count}`;
    select.append(option);
  }
  const stillExists = [...select.options].some((option) => option.value === selected);
  if (stillExists) {
    select.value = selected;
  } else if (select.options.length > 1) {
    select.selectedIndex = 1;
  }
  select.disabled = select.options.length <= 1;
}

async function transferMcpItemToVault(group, destinationVault, mode) {
  if (!destinationVault) {
    setMessage("Choose a destination vault first.", true);
    return;
  }
  const destination = selectedVaultNameByValue(destinationVault);
  await api("/api/op/mcp-vault/items/transfer", {
    method: "POST",
    body: JSON.stringify({
      token: group.candidates[0].token,
      destinationVault,
      mode,
    }),
  });
  if (mode === "move") {
    expandedApprovalItems.delete(group.key);
    await refreshGrantsOnly();
  }
  await loadMcpCandidates();
  setMessage(`${mode === "move" ? "Moved" : "Copied"} ${group.title} ${mode === "move" ? "to" : "into"} ${destination}.`);
}

async function refreshGrantsOnly() {
  const grants = await api("/api/grants");
  currentGrants = grants || [];
  renderGrants(grants);
}

function renderSecretGroupButtons() {
  for (const button of secretGroupButtons) {
    button.classList.toggle("active", button.dataset.secretGroup === activeSecretGroup);
  }
}

function renderSecretGroupCounts(groups) {
  for (const el of document.querySelectorAll("[data-group-count]")) {
    const key = el.dataset.groupCount || "all";
    el.textContent = String(groups[key] || 0);
  }
  renderSecretGroupButtons();
}

function setApprovalExpanded(article, body, button, expanded) {
  article.classList.toggle("isExpanded", expanded);
  body.hidden = !expanded;
  button.setAttribute("aria-expanded", String(expanded));
  button.textContent = expanded ? "Hide Details" : "Review Details";
}

function approvalStats(group) {
  let approved = 0;
  let suggested = 0;
  let sensitive = 0;
  for (const candidate of group.candidates) {
    const copy = fieldCopy(candidate);
    if (isApprovedCandidate(candidate)) approved += 1;
    else if (copy.suggested) suggested += 1;
    if (copy.sensitive) sensitive += 1;
  }
  return {
    total: group.candidates.length,
    approved,
    suggested,
    sensitive,
    pending: group.candidates.length - approved,
  };
}

function approvalStatusText(stats) {
  if (stats.total === stats.approved) {
    return `${stats.total} approved`;
  }
  const parts = [`${stats.total} detail${stats.total === 1 ? "" : "s"}`];
  if (stats.approved) parts.push(`${stats.approved} approved`);
  if (stats.suggested) parts.push(`${stats.suggested} suggested`);
  if (stats.sensitive) parts.push(`${stats.sensitive} sensitive`);
  return parts.join(" · ");
}

function groupCandidatesByItem(candidates) {
  const map = new Map();
  for (const candidate of candidates) {
    const title = cleanItemTitle(candidate.itemTitle || stripFieldFromTitle(candidate.title) || "Untitled item");
    const key = candidate.itemId || [
      candidate.vaultId,
      candidate.vaultName,
      title,
      candidate.category,
    ].filter(Boolean).join("|");
    if (!map.has(key)) {
      map.set(key, {
        key,
        title,
        category: candidate.category,
        type: groupFromCategory(candidate.category),
        defaultSites: candidate.sites || [],
        candidates: [],
      });
    }
    const group = map.get(key);
    group.candidates.push(candidate);
    if (!group.defaultSites.length && candidate.sites?.length) {
      group.defaultSites = candidate.sites;
    }
  }
  return [...map.values()].map((group) => ({
    ...group,
    candidates: group.candidates.sort(compareCandidates),
  }));
}

function formatMcpSummary(result, groups) {
  const detailCount = result.shown || 0;
  const itemCount = groups.length;
  const label = approvalGroupLabel(result.activeGroup);
  if (!itemCount) {
    return `No ${label} items are ready to approve.`;
  }
  return `${itemCount} ${label} item${itemCount === 1 ? "" : "s"} ready. ${detailCount} detail${detailCount === 1 ? "" : "s"} found. Nothing is shared until you approve details.`;
}

function compareCandidates(a, b) {
  return fieldSortRank(a) - fieldSortRank(b) || friendlyFieldName(a).localeCompare(friendlyFieldName(b));
}

function fieldSortRank(candidate) {
  const order = {
    username: 10,
    password: 20,
    api_credential: 20,
    credit_card_name: 10,
    credit_card_number: 20,
    credit_card_expiry: 30,
    credit_card_cvv: 80,
    credit_card_pin: 90,
    otp: 95,
    ssh_private_key: 95,
  };
  return order[candidate.kind] || 50;
}

function fieldCopy(candidate) {
  const label = friendlyFieldName(candidate);
  const copy = {
    password: ["Password", "Lets the agent fill the password for this login.", "Suggested", true, false],
    username: ["Username", "Lets the agent fill or copy the username.", "Suggested", true, false],
    otp: ["One-time code", "Short-lived login code. Approve only when the agent must complete sign-in.", "Extra sensitive", false, true],
    api_credential: ["API key or token", "Lets the agent copy or paste this API credential.", "Suggested", true, false],
    credit_card_name: ["Cardholder name", "Name printed on the card.", "Suggested", true, false],
    credit_card_number: ["Card number", "Needed when an agent fills a payment form.", "Suggested", true, false],
    credit_card_expiry: ["Expiry date", "Month and year printed on the card.", "Suggested", true, false],
    credit_card_cvv: ["Security code (CVV)", "Extra sensitive. Approve only for payment flows you trust.", "Review carefully", false, true],
    credit_card_pin: ["Card PIN", "Highly sensitive. Usually leave this unapproved.", "Do not suggest", false, true],
    secure_note: ["Secure note text", "Allows the agent to read the note text.", "Review carefully", false, true],
    ssh_private_key: ["SSH private key", "Allows the agent to use an SSH private key. Approve only for trusted local development.", "Extra sensitive", false, true],
    license_key: ["License key", "Lets the agent copy or paste a software license key.", "Suggested", true, false],
    text: [label, "Plain text stored on this item.", "Optional", false, false],
    custom: [label, "Custom hidden field from this item.", "Review carefully", false, true],
  }[candidate.kind] || [label, "Detail stored on this item.", "Optional", false, false];

  return {
    title: copy[0],
    description: copy[1],
    tag: copy[2],
    suggested: copy[3],
    sensitive: copy[4],
  };
}

function groupIntro(group) {
  if (group.type === "card") {
    return "This is one copied card. Approve only the card details an agent really needs. CVV and PIN are not selected by default.";
  }
  if (group.type === "api") {
    return "This is one copied API credential. Approve the token only for agents that should use it.";
  }
  if (group.type === "login") {
    return "This is one copied login. Usually approve it only for the website where the account signs in.";
  }
  if (group.type === "note") {
    return "This item may contain broad information. Read each detail name before approving it.";
  }
  return "This is one copied item. Choose the exact details agents may use.";
}

function groupBadge(group) {
  if (group === "login") return "LOGIN";
  if (group === "api") return "API";
  if (group === "card") return "CARD";
  if (group === "note") return "NOTE";
  return "ITEM";
}

function isApprovedCandidate(candidate) {
  return currentGrants.some((grant) => grantMatchesCandidate(grant, candidate));
}

function grantMatchesCandidate(grant, candidate) {
  if (grant.kind !== candidate.kind) return false;
  if (normalize(grant.fieldLabel) !== normalize(candidate.fieldLabel)) return false;
  if (grant.itemId && candidate.itemId) return grant.itemId === candidate.itemId;
  if (grant.itemTitle && candidate.itemTitle && normalize(grant.itemTitle) !== normalize(candidate.itemTitle)) return false;
  if (grant.vaultName && candidate.vaultName && normalize(grant.vaultName) !== normalize(candidate.vaultName)) return false;
  return true;
}

function renderProfile(entries) {
  profileEntriesEl.innerHTML = "";
  if (!entries.length) {
    profileEntriesEl.append(empty("No profile data added yet. Add only details you want agents to read directly."));
    return;
  }
  const template = document.querySelector("#profileTemplate");
  for (const entry of entries) {
    const node = template.content.cloneNode(true);
    node.querySelector("h3").textContent = entry.label;
    node.querySelector(".meta").textContent = [
      `type: ${formatKind(entry.kind)}`,
      entry.sites.length ? `sites: ${entry.sites.join(", ")}` : "blank allowed sites means all sites",
    ].join(" | ");
    const valueInput = node.querySelector(".profileValueInput");
    const sitesInput = node.querySelector(".profileSitesInput");
    const enabledInput = node.querySelector(".profileEnabledInput");
    valueInput.value = entry.value;
    sitesInput.value = entry.sites.join(", ");
    sitesInput.placeholder = "blank means all sites";
    enabledInput.checked = entry.enabled;
    node.querySelector(".profileSaveBtn").addEventListener("click", () => runAction(async () => {
      await api(`/api/profile/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          value: valueInput.value,
          sites: splitCsv(sitesInput.value),
          enabled: enabledInput.checked,
        }),
      });
      await refresh();
      setMessage(`Saved ${entry.label}.`);
    }));
    node.querySelector(".profileDeleteBtn").addEventListener("click", () => runAction(async () => {
      const ok = window.confirm(`Delete profile field "${entry.label}"?\n\nAgents will no longer be able to retrieve it.`);
      if (!ok) return;
      await api(`/api/profile/${entry.id}`, { method: "DELETE" });
      await refresh();
      setMessage(`Deleted ${entry.label}.`);
    }));
    profileEntriesEl.append(node);
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

async function toggleMenuBar() {
  if (menuBarToggle.checked) {
    const status = await api("/api/menubar/install", {
      method: "POST",
      body: JSON.stringify({ launch: true, launchAtLogin: menuBarLoginToggle.checked }),
    });
    renderMenuBar(status);
    setMessage("Menu-bar shortcut installed and opened. Look for the 1P label at the top of your Mac screen.");
    return;
  }

  const confirmed = window.confirm(
    "Uninstall the menu-bar shortcut?\n\nThis removes the installed helper and its login item. MCPVAULT, approvals, and 1Password items stay untouched. You can install it again with onepassword-agent-mcp menubar install.",
  );
  if (!confirmed) {
    menuBarToggle.checked = true;
    return;
  }

  const status = await api("/api/menubar", { method: "DELETE" });
  renderMenuBar(status);
  setMessage("Menu-bar shortcut uninstalled. Install it again later with onepassword-agent-mcp menubar install. Your MCP and 1Password data stay unchanged.");
}

async function toggleMenuBarLogin() {
  const status = await api("/api/menubar/login", {
    method: "POST",
    body: JSON.stringify({ enabled: menuBarLoginToggle.checked }),
  });
  renderMenuBar(status);
  setMessage(menuBarLoginToggle.checked
    ? "The visible shortcut will open after your next Mac login."
    : "Launch at login is off. The currently visible shortcut keeps running until you quit it.");
}

async function launchMenuBarShortcut() {
  const status = await api("/api/menubar/launch", { method: "POST", body: "{}" });
  renderMenuBar(status);
  setMessage("Opening the menu-bar shortcut.");
  window.setTimeout(() => runAction(refresh, { quiet: true }), 600);
}

async function updateMenuBarShortcut() {
  const status = await api("/api/menubar/install", {
    method: "POST",
    body: JSON.stringify({ launch: true, launchAtLogin: menuBarLoginToggle.checked }),
  });
  renderMenuBar(status);
  setMessage("Menu-bar shortcut updated to this package version.");
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
        allowAgentItemCreate: settingsForm.allowAgentItemCreate.checked,
      }),
    });
    await refresh();
    await loadMcpCandidates();
    setMessage("Saved local settings.");
  });
}

async function addProfileEntry(event) {
  event.preventDefault();
  await runAction(async () => {
    const data = new FormData(profileForm);
    await api("/api/profile", {
      method: "POST",
      body: JSON.stringify({
        kind: data.get("kind"),
        label: data.get("label"),
        value: data.get("value"),
        sites: splitCsv(String(data.get("sites") || "")),
      }),
    });
    profileForm.reset();
    await refresh();
    setMessage("Added profile data.");
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

function formatKind(value) {
  return String(value || "custom").replaceAll("_", " ");
}

function formatCategory(value) {
  return String(value || "").replaceAll("_", " ").toLowerCase();
}

function friendlyFieldName(candidate) {
  return String(candidate.fieldLabel || candidate.fieldId || "detail")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripFieldFromTitle(title) {
  const value = String(title || "");
  return value.replace(/\s+-\s+[^-]+$/, "").trim();
}

function cleanItemTitle(title) {
  return String(title || "Untitled item")
    .replace(/\bCreditCard\b/g, "Credit Card")
    .replace(/\bApi\b/g, "API")
    .replace(/\s+/g, " ")
    .trim();
}

function vaultEquals(vault, target) {
  const values = [vault.id, vault.name].map(normalize).filter(Boolean);
  return [target.id, target.name].map(normalize).filter(Boolean).some((value) => values.includes(value));
}

function selectedVaultLabel(select) {
  return select.selectedOptions[0]?.textContent?.replace(/\s+\(\d+\)$/, "") || "the selected vault";
}

function selectedVaultNameByValue(value) {
  const vault = (currentStatus?.cli?.vaults || []).find((candidate) => candidate.id === value || candidate.name === value);
  return vault?.name || vault?.id || "the selected vault";
}

function groupFromCategory(category) {
  const value = String(category || "").replaceAll(" ", "_").replaceAll("-", "_").toUpperCase();
  if (value === "LOGIN" || value === "PASSWORD") return "login";
  if (value === "API_CREDENTIAL") return "api";
  if (value === "CREDIT_CARD") return "card";
  if (value === "SECURE_NOTE" || value === "SSH_KEY") return "note";
  return "other";
}

function groupLabel(group) {
  if (group === "login") return "login/password";
  if (group === "api") return "API key";
  if (group === "card") return "credit-card";
  if (group === "note") return "note/SSH";
  if (group === "other") return "other";
  return "all";
}

function approvalGroupLabel(group) {
  return group === "all" ? "copied" : groupLabel(group);
}

function empty(text) {
  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = text;
  return div;
}
