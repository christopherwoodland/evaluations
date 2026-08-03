const form = document.getElementById("wizardForm");
const panels = [...document.querySelectorAll(".panel")];
const stepEls = [...document.querySelectorAll(".step")];
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const runBtn = document.getElementById("runBtn");
const rerunBtn = document.getElementById("rerunBtn");
const statusEl = document.getElementById("status");
const logsEl = document.getElementById("logs");
const runProgressWrapEl = document.getElementById("runProgressWrap");
const runProgressFillEl = document.getElementById("runProgressFill");
const runProgressLabelEl = document.getElementById("runProgressLabel");
const runProgressTimeEl = document.getElementById("runProgressTime");
const runStageWrapEl = document.getElementById("runStageWrap");
const runStageTextEl = document.getElementById("runStageText");
const modelUsedEl = document.getElementById("modelUsed");
const apiExampleTextEl = document.getElementById("apiExampleText");
const downloadsEl = document.getElementById("downloads");
const excelLink = document.getElementById("excelLink");
const jsonlLink = document.getElementById("jsonlLink");
const networkLink = document.getElementById("networkLink");
const jsonlProfileEl = document.getElementById("jsonlProfile");
const customMapEl = document.getElementById("customMap");
const previewBtn = document.getElementById("previewBtn");
const previewStatusEl = document.getElementById("previewStatus");
const previewTextEl = document.getElementById("previewText");
const profilePreviewStatusEl = document.getElementById("profilePreviewStatus");
const profilePreviewTextEl = document.getElementById("profilePreviewText");
const refreshHistoryBtn = document.getElementById("refreshHistoryBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const historyListEl = document.getElementById("historyList");
const showAdvancedModesEl = document.getElementById("showAdvancedModes");
const setupOpenChatEl = document.getElementById("setupOpenChat");
const refreshAuthBtn = document.getElementById("refreshAuthBtn");
const setupCheckBtn = document.getElementById("setupCheckBtn");
const networkTemplateProfileEl = document.getElementById("networkTemplateProfile");
const configNetworkTemplateProfileEl = document.getElementById("configNetworkTemplateProfile");
const newNetworkProfileNameEl = document.getElementById("newNetworkProfileName");
const saveNetworkProfileBtn = document.getElementById("saveNetworkProfileBtn");
const setDefaultNetworkProfileBtn = document.getElementById("setDefaultNetworkProfileBtn");
const deleteNetworkProfileBtn = document.getElementById("deleteNetworkProfileBtn");
const networkProfileStatusEl = document.getElementById("networkProfileStatus");
const configNetworkProfileWarningEl = document.getElementById("configNetworkProfileWarning");
const manualRequestTextEl = document.getElementById("manualRequestText");
const importRequestBtn = document.getElementById("importRequestBtn");
const setupStatusEl = document.getElementById("setupStatus");
const setupTextEl = document.getElementById("setupText");
const precheckBtn = document.getElementById("precheckBtn");
const precheckStatusEl = document.getElementById("precheckStatus");
const precheckTextEl = document.getElementById("precheckText");
const exportFoundryBtn = document.getElementById("exportFoundryBtn");
const foundryTargetDirEl = document.getElementById("foundryTargetDir");
const foundryStatusEl = document.getElementById("foundryStatus");

let step = 1;
let latestJsonlHref = "";
const MAX_STEP = 4;
let hasAutoSetupRun = false;
let runProgressTimer = null;
let runProgressStartMs = 0;
let runProgressValue = 0;
let networkTemplateProfiles = [];
let defaultNetworkTemplateProfileId = "";

function boolFromValue(value, fallback = false) {
  if (value == null) return fallback;
  const s = String(value).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  return fallback;
}

function advancedModesEnabled() {
  return Boolean(showAdvancedModesEl?.checked);
}

function selectedMode() {
  return form.querySelector("input[name='mode']:checked")?.value || "simplechat-api";
}

async function hydrateDefaults() {
  try {
    const res = await fetch("/api/files/defaults");
    if (!res.ok) return;
    const d = await res.json();

    setInputValue("url", d.defaultChatUrl);
    setInputValue("stateFile", d.defaultStateFile);
    setInputValue("networkTemplate", d.defaultNetworkTemplate);
    setInputValue("selectors", d.defaultSelectors);
    setInputValue("outputDir", d.defaultOutputDir);
    setInputValue("apiUrl", d.defaultApiUrl);
    setInputValue("apiMethod", d.defaultApiMethod);
    setInputValue("apiResponsePath", d.defaultApiResponsePath);
    setInputValue("jsonlProfile", d.defaultJsonlProfile);
    setInputValue("jsonlQueryKey", d.defaultJsonlQueryKey);
    setInputValue("jsonlResponseKey", d.defaultJsonlResponseKey);
    setInputValue("jsonlGroundTruthKey", d.defaultJsonlGroundTruthKey);
    setInputValue("jsonlContextKey", d.defaultJsonlContextKey);

    const strict = form.querySelector("input[name='strictSchema']");
    if (strict && d.defaultStrictSchema != null) {
      strict.checked = String(d.defaultStrictSchema).toLowerCase() === "true";
    }
    const maskLogs = form.querySelector("input[name='maskLogs']");
    if (maskLogs && d.defaultMaskLogs != null) {
      maskLogs.checked = boolFromValue(d.defaultMaskLogs, true);
    }
    await loadNetworkTemplateProfiles(String(d.defaultNetworkTemplateProfile || "").trim());
    updateProfileUI();
    updateProfilePreview();
  } catch {
    // Ignore defaults fetch issues and keep static HTML defaults.
  }
}

function updateProfileUI() {
  const profile = jsonlProfileEl?.value || "foundry-basic";
  const isCustom = profile === "custom";
  customMapEl?.classList.toggle("hidden", !isCustom);

  const gt = form.querySelector("input[name='includeGroundTruth']");
  const ctx = form.querySelector("input[name='includeContext']");

  if (profile === "foundry-basic") {
    if (gt) gt.checked = true;
    if (ctx) ctx.checked = false;
  }
  if (profile === "foundry-context") {
    if (gt) gt.checked = true;
    if (ctx) ctx.checked = true;
  }
}

function setInputValue(name, value) {
  if (value == null || value === "") return;
  const el = form.querySelector(`[name='${name}']`);
  if (!el) return;
  el.value = String(value);
}

function getSelectedNetworkTemplateProfileId() {
  return String(configNetworkTemplateProfileEl?.value || networkTemplateProfileEl?.value || "").trim();
}

function findNetworkTemplateProfile(profileId) {
  const selected = String(profileId || "").trim();
  if (!selected) return null;
  return networkTemplateProfiles.find((p) => p.id === selected) || null;
}

function profileModelLabel(profile) {
  const p = profile && typeof profile === "object" ? profile : {};
  const model = String(p.modelName || p.modelId || "").trim();
  return model ? ` [${model}]` : "";
}

function selectedNetworkTemplateProfile() {
  return findNetworkTemplateProfile(getSelectedNetworkTemplateProfileId());
}

function updateConfigNetworkProfileWarning() {
  if (!configNetworkProfileWarningEl) return;
  const mode = selectedMode();
  const selected = selectedNetworkTemplateProfile();
  if (mode !== "simplechat-api") {
    configNetworkProfileWarningEl.textContent = "";
    return;
  }
  if (!selected) {
    configNetworkProfileWarningEl.textContent = "No network profile selected.";
    return;
  }
  if (selected.exists === false) {
    configNetworkProfileWarningEl.textContent = `Warning: profile template file is missing (${selected.networkTemplate}).`;
    return;
  }
  configNetworkProfileWarningEl.textContent = "";
}

function applyNetworkTemplateProfile(profileId, options = {}) {
  const updatePath = options.updatePath !== false;
  const syncConfig = options.syncConfig !== false;
  const syncSetup = options.syncSetup !== false;
  if (!networkTemplateProfileEl) return;

  const fallback = defaultNetworkTemplateProfileId || networkTemplateProfiles[0]?.id || "";
  const effectiveId = findNetworkTemplateProfile(profileId)?.id || fallback;
  if (syncSetup && networkTemplateProfileEl) networkTemplateProfileEl.value = effectiveId;
  if (syncConfig && configNetworkTemplateProfileEl) configNetworkTemplateProfileEl.value = effectiveId;

  const selectedProfile = findNetworkTemplateProfile(effectiveId);
  if (selectedProfile && updatePath) {
    setInputValue("networkTemplate", selectedProfile.networkTemplate);
  }

  if (networkProfileStatusEl) {
    if (selectedProfile) {
      networkProfileStatusEl.textContent = `Using profile '${selectedProfile.name}'${profileModelLabel(selectedProfile)} -> ${selectedProfile.networkTemplate}`;
    } else {
      networkProfileStatusEl.textContent = "No network template profile selected.";
    }
  }

  updateConfigNetworkProfileWarning();
}

function renderNetworkTemplateProfileOptions() {
  if (!networkTemplateProfileEl && !configNetworkTemplateProfileEl) return;

  const renderFor = (el) => {
    if (!el) return;
    el.innerHTML = "";
    for (const profile of networkTemplateProfiles) {
      const opt = document.createElement("option");
      opt.value = profile.id;
      const isDefault = profile.id === defaultNetworkTemplateProfileId;
      const base = isDefault ? `${profile.name} (default)` : profile.name;
      opt.textContent = `${base}${profileModelLabel(profile)}`;
      el.appendChild(opt);
    }
  };

  renderFor(networkTemplateProfileEl);
  renderFor(configNetworkTemplateProfileEl);

  applyNetworkTemplateProfile(networkTemplateProfileEl.value || defaultNetworkTemplateProfileId || networkTemplateProfiles[0]?.id || "", {
    updatePath: true,
    syncConfig: true,
    syncSetup: true,
  });
}

async function loadNetworkTemplateProfiles(preferredProfileId = "") {
  if (!networkTemplateProfileEl && !configNetworkTemplateProfileEl) return;
  try {
    const res = await fetch("/api/network-template-profiles");
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to load network template profiles.");
    }

    networkTemplateProfiles = Array.isArray(data.profiles) ? data.profiles : [];
    defaultNetworkTemplateProfileId = String(data.defaultProfileId || "").trim();
    renderNetworkTemplateProfileOptions();
    applyNetworkTemplateProfile(preferredProfileId || defaultNetworkTemplateProfileId, {
      updatePath: true,
      syncConfig: true,
      syncSetup: true,
    });
  } catch (err) {
    networkTemplateProfiles = [];
    const renderUnavailable = (el) => {
      if (!el) return;
      el.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(profiles unavailable)";
      el.appendChild(opt);
      el.value = "";
    };
    renderUnavailable(networkTemplateProfileEl);
    renderUnavailable(configNetworkTemplateProfileEl);
    if (networkProfileStatusEl) {
      networkProfileStatusEl.textContent = `Could not load profiles: ${err.message}`;
    }
  }
}

function getSelectedNetworkTemplateProfileName() {
  const selected = selectedNetworkTemplateProfile();
  return selected?.name || "Default";
}

async function setDefaultNetworkTemplateProfile() {
  const selected = selectedNetworkTemplateProfile();
  if (!selected) {
    if (networkProfileStatusEl) networkProfileStatusEl.textContent = "Select a profile first.";
    return;
  }

  if (setDefaultNetworkProfileBtn) setDefaultNetworkProfileBtn.disabled = true;
  if (networkProfileStatusEl) networkProfileStatusEl.textContent = "Setting default profile...";
  try {
    const res = await fetch("/api/network-template-profiles/set-default", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: selected.id }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to set default profile.");
    }

    await loadNetworkTemplateProfiles(selected.id);
    if (networkProfileStatusEl) networkProfileStatusEl.textContent = `Default profile set to '${selected.name}'.`;
  } catch (err) {
    if (networkProfileStatusEl) networkProfileStatusEl.textContent = `Set default failed: ${err.message}`;
  } finally {
    if (setDefaultNetworkProfileBtn) setDefaultNetworkProfileBtn.disabled = false;
  }
}

async function deleteNetworkTemplateProfile() {
  const selected = selectedNetworkTemplateProfile();
  if (!selected) {
    if (networkProfileStatusEl) networkProfileStatusEl.textContent = "Select a profile first.";
    return;
  }

  const confirmed = window.confirm(`Delete network profile '${selected.name}'?`);
  if (!confirmed) return;

  if (deleteNetworkProfileBtn) deleteNetworkProfileBtn.disabled = true;
  if (networkProfileStatusEl) networkProfileStatusEl.textContent = "Deleting profile...";
  try {
    const res = await fetch("/api/network-template-profiles/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: selected.id }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to delete profile.");
    }

    await loadNetworkTemplateProfiles(data.defaultProfileId || "");
    if (networkProfileStatusEl) networkProfileStatusEl.textContent = `Deleted profile '${selected.name}'.`;
  } catch (err) {
    if (networkProfileStatusEl) networkProfileStatusEl.textContent = `Delete failed: ${err.message}`;
  } finally {
    if (deleteNetworkProfileBtn) deleteNetworkProfileBtn.disabled = false;
  }
}

async function saveNetworkTemplateProfile() {
  const name = String(newNetworkProfileNameEl?.value || "").trim();
  const networkTemplate = String(form.querySelector("[name='networkTemplate']")?.value || "").trim();
  if (!name) {
    if (networkProfileStatusEl) networkProfileStatusEl.textContent = "Enter a profile name first.";
    return;
  }
  if (!networkTemplate) {
    if (networkProfileStatusEl) networkProfileStatusEl.textContent = "Set a network template path before saving profile.";
    return;
  }

  if (saveNetworkProfileBtn) saveNetworkProfileBtn.disabled = true;
  if (networkProfileStatusEl) networkProfileStatusEl.textContent = "Saving profile...";
  try {
    const res = await fetch("/api/network-template-profiles/upsert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        networkTemplate,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to save network template profile.");
    }

    const targetProfile = (data.profiles || []).find((p) => p.name === name);
    await loadNetworkTemplateProfiles(targetProfile?.id || "");
    if (newNetworkProfileNameEl) newNetworkProfileNameEl.value = "";
    if (networkProfileStatusEl) networkProfileStatusEl.textContent = `Profile '${name}' saved.`;
  } catch (err) {
    if (networkProfileStatusEl) networkProfileStatusEl.textContent = `Profile save failed: ${err.message}`;
  } finally {
    if (saveNetworkProfileBtn) saveNetworkProfileBtn.disabled = false;
  }
}

function parseJsonSafe(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function getProfilePreviewObject() {
  const profile = jsonlProfileEl?.value || "foundry-basic";
  const queryKey = form.querySelector("[name='jsonlQueryKey']")?.value?.trim() || "query";
  const responseKey = form.querySelector("[name='jsonlResponseKey']")?.value?.trim() || "response";
  const groundTruthKey = form.querySelector("[name='jsonlGroundTruthKey']")?.value?.trim() || "ground_truth";
  const contextKey = form.querySelector("[name='jsonlContextKey']")?.value?.trim() || "context";

  const includeGroundTruth = Boolean(form.querySelector("input[name='includeGroundTruth']")?.checked);
  const includeContext = Boolean(form.querySelector("input[name='includeContext']")?.checked);
  const includeMetadata = Boolean(form.querySelector("input[name='includeMetadata']")?.checked);

  const resolvedKeys = {
    query: profile === "custom" ? queryKey : "query",
    response: profile === "custom" ? responseKey : "response",
    groundTruth: profile === "custom" ? groundTruthKey : "ground_truth",
    context: profile === "custom" ? contextKey : "context",
  };

  const obj = {
    [resolvedKeys.query]: "Example query",
    [resolvedKeys.response]: "Example model response",
    [resolvedKeys.groundTruth]: includeGroundTruth ? "Example reference" : "",
  };

  if (includeContext) {
    obj[resolvedKeys.context] = "Example context";
  }
  if (includeMetadata) {
    obj.meta = {
      id: 1,
      status: "ok",
      error: "",
      captured_at_utc: "2026-01-01T00:00:00.000Z",
    };
  }

  return obj;
}

function updateProfilePreview() {
  if (!profilePreviewTextEl || !profilePreviewStatusEl) return;
  const sample = getProfilePreviewObject();
  profilePreviewStatusEl.textContent = "Preview of one JSONL line based on current options.";
  profilePreviewTextEl.textContent = JSON.stringify(sample, null, 2);
}


function maskSensitiveText(text) {
  if (!text) return "";
  let masked = String(text);

  masked = masked.replace(/(Authorization\s*[:=]\s*)(?:Bearer\s+)?[^\s"'`]+/gi, "$1[REDACTED]");
  masked = masked.replace(/([?&](?:token|access_token|api_key|apikey|key|sig|signature)=)([^&\s]+)/gi, "$1[REDACTED]");
  masked = masked.replace(/(https?:\/\/[^\s/?#]+)([^\s]*)/gi, "$1[REDACTED_PATH]");

  return masked;
}

function updateModeVisibility() {
  const mode = selectedMode();
  const showAdvanced = advancedModesEnabled();

  document.querySelectorAll(".mode-advanced").forEach((el) => {
    el.classList.toggle("hidden", !showAdvanced);
  });

  if (!showAdvanced && mode !== "simplechat-api") {
    const simple = form.querySelector("input[name='mode'][value='simplechat-api']");
    if (simple) simple.checked = true;
  }

  const effectiveMode = selectedMode();
  document.querySelectorAll(".mode-ui").forEach((el) => {
    el.style.display = effectiveMode === "ui" ? "grid" : "none";
  });
  document.querySelectorAll(".mode-api").forEach((el) => {
    el.style.display = effectiveMode === "api" ? "block" : "none";
  });
  document.querySelectorAll(".mode-simplechat").forEach((el) => {
    el.style.display = effectiveMode === "simplechat-api" ? "grid" : "none";
  });

  updateConfigNetworkProfileWarning();
}

function showStep(next) {
  step = Math.max(0, Math.min(MAX_STEP, next));
  panels.forEach((panel) => panel.classList.toggle("is-active", Number(panel.dataset.panel) === step));
  stepEls.forEach((el) => el.classList.toggle("is-active", Number(el.dataset.step) === step));

  prevBtn.disabled = step === 0;
  nextBtn.style.display = step === MAX_STEP ? "none" : "inline-block";
}

function goToStep(targetStep) {
  const target = Math.max(0, Math.min(MAX_STEP, Number(targetStep)));
  if (Number.isNaN(target) || target === step) return;
  if (target > step && !validateCurrentStep()) return;
  showStep(target);
}

function setStatus(message, cls = "") {
  statusEl.className = `status ${cls}`.trim();
  statusEl.textContent = message;
}

function clearRunProgressTimer() {
  if (!runProgressTimer) return;
  window.clearInterval(runProgressTimer);
  runProgressTimer = null;
}

function setRunStageLines(lines) {
  if (!runStageWrapEl || !runStageTextEl) return;
  const clean = Array.isArray(lines) ? lines.filter(Boolean) : [];
  runStageWrapEl.classList.toggle("hidden", !clean.length);
  runStageTextEl.textContent = clean.join("\n");
}

function extractStageLinesFromOutput(outputText) {
  const text = String(outputText || "");
  const lines = text.split(/\r?\n/);
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^Mode:\s+/i.test(trimmed)) out.push(`1) ${trimmed}`);
    else if (/^Input:\s+/i.test(trimmed)) out.push(`2) ${trimmed}`);
    else if (/^Rows:\s+/i.test(trimmed)) out.push(`3) ${trimmed}`);
    else if (/^Row\s+\d+\/\d+:/i.test(trimmed)) out.push(`4) ${trimmed}`);
    else if (/^Done\.?$/i.test(trimmed)) out.push("5) Finalizing outputs");
    else if (/^Excel output:/i.test(trimmed)) out.push("6) Excel artifact generated");
    else if (/^JSONL output:/i.test(trimmed)) out.push("7) JSONL artifact generated");
  }

  return out.slice(-12);
}

function setRunProgressState({ visible, value, label, elapsedSec, status }) {
  if (!runProgressWrapEl || !runProgressFillEl || !runProgressLabelEl || !runProgressTimeEl) return;

  runProgressWrapEl.classList.toggle("hidden", !visible);
  if (!visible) return;

  const safeValue = Math.max(0, Math.min(100, Number(value || 0)));
  runProgressFillEl.style.width = `${safeValue}%`;
  runProgressFillEl.classList.remove("is-running", "is-ok", "is-err");
  if (status === "ok") runProgressFillEl.classList.add("is-ok");
  else if (status === "err") runProgressFillEl.classList.add("is-err");
  else runProgressFillEl.classList.add("is-running");

  runProgressLabelEl.textContent = label || "Running...";
  runProgressTimeEl.textContent = `${Math.max(0, Number(elapsedSec || 0))}s`;

  const bar = runProgressWrapEl.querySelector(".run-progress-track");
  if (bar) bar.setAttribute("aria-valuenow", String(Math.round(safeValue)));
}

function startRunProgress() {
  clearRunProgressTimer();
  runProgressStartMs = Date.now();
  runProgressValue = 4;
  setRunProgressState({
    visible: true,
    value: runProgressValue,
    label: "Submitting run...",
    elapsedSec: 0,
    status: "running",
  });
  setRunStageLines([
    "Starting run...",
    "Uploading input and configuration to backend",
    "Waiting for backend runner to start",
  ]);

  runProgressTimer = window.setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - runProgressStartMs) / 1000);
    if (runProgressValue < 92) {
      runProgressValue = Math.min(92, runProgressValue + (elapsedSec < 20 ? 2.2 : 0.8));
    }
    const label = elapsedSec < 5
      ? "Preparing request..."
      : elapsedSec < 20
        ? "Running prompts..."
        : "Still running (waiting for model responses)...";

    const stageLines = [
      "Starting run...",
      "Uploading input and configuration to backend",
      elapsedSec < 8
        ? "Creating conversations..."
        : "Sending chat requests and waiting for model responses...",
    ];
    if (elapsedSec >= 20) {
      stageLines.push("Processing long-running prompt(s)...");
    }
    setRunStageLines(stageLines);

    setRunProgressState({
      visible: true,
      value: runProgressValue,
      label,
      elapsedSec,
      status: "running",
    });
  }, 1000);
}

function finishRunProgress(ok, label) {
  clearRunProgressTimer();
  const elapsedSec = Math.floor((Date.now() - runProgressStartMs) / 1000);
  setRunProgressState({
    visible: true,
    value: ok ? 100 : Math.max(8, Math.min(100, runProgressValue)),
    label: label || (ok ? "Run complete." : "Run failed."),
    elapsedSec,
    status: ok ? "ok" : "err",
  });
  if (!ok) {
    const prior = runStageTextEl?.textContent ? runStageTextEl.textContent.split(/\r?\n/) : [];
    setRunStageLines([...prior, "Run ended with errors. See logs for details."]);
  }
}

function setDownloads(outputs) {
  const show = (a, pathValue) => {
    if (pathValue) {
      a.href = `/${pathValue}`;
      a.style.display = "inline-flex";
    } else {
      a.removeAttribute("href");
      a.style.display = "none";
    }
  };

  show(excelLink, outputs?.excel);
  show(jsonlLink, outputs?.jsonl);
  show(networkLink, outputs?.network);

  const hasAny = Boolean(outputs?.excel || outputs?.jsonl || outputs?.network);
  downloadsEl.classList.toggle("hidden", !hasAny);
  latestJsonlHref = outputs?.jsonl ? `/${outputs.jsonl}` : "";
  if (previewBtn) previewBtn.disabled = !latestJsonlHref;
  if (exportFoundryBtn) exportFoundryBtn.disabled = !latestJsonlHref;
}

function setRunContext(runContext) {
  if (!modelUsedEl || !apiExampleTextEl) return;
  if (!runContext) {
    modelUsedEl.textContent = "Model: unknown";
    apiExampleTextEl.textContent = "Example API call will appear after run.";
    return;
  }

  const model = runContext.model || "unknown";
  const mode = runContext.mode || selectedMode();
  const profileName = runContext?.network_template_profile?.name || "";
  const profilePath = runContext?.network_template_profile?.networkTemplate || "";
  const profileText = profileName ? ` | Profile: ${profileName}` : "";
  modelUsedEl.textContent = `Mode: ${mode}${profileText} | Model: ${model}`;

  const example = runContext.exampleRequest || { note: "No example request available." };
  apiExampleTextEl.textContent = JSON.stringify(
    {
      network_template_profile: profileName || "",
      network_template_path: profilePath || "",
      ...example,
    },
    null,
    2,
  );
}

function buildPrecheckPayload() {
  const mode = selectedMode();
  const get = (name) => form.querySelector(`[name='${name}']`)?.value || "";
  return {
    mode,
    url: get("url"),
    stateFile: get("stateFile"),
    networkTemplate: get("networkTemplate"),
    networkTemplateProfile: getSelectedNetworkTemplateProfileId(),
    apiUrl: get("apiUrl"),
    headed: get("headed") || "true",
  };
}

function renderChecks(checks) {
  return (checks || []).map((c) => `${c.ok ? "[OK]" : "[FAIL]"} ${c.key}: ${c.message}`).join("\n");
}

function applySetupCheckResult(data, options = {}) {
  const autoAdvance = Boolean(options.autoAdvance);
  const source = options.source || "manual";

  setupStatusEl.textContent = data.ok
    ? "Setup looks good for SimpleChat API mode."
    : "Setup incomplete. Follow the checklist and retry.";
  setupTextEl.textContent = renderChecks(data.checks || []);

  if (data.ok && autoAdvance && step === 0) {
    showStep(1);
    setStatus("Saved login is valid. Step 0 completed automatically.", "ok");
  }

  if (!data.ok && source === "auto") {
    setStatus("Step 0 needs sign-in once. Use 'Refresh login session' to fix it.", "err");
  }
}

async function runSetupCheck(options = {}) {
  const autoAdvance = Boolean(options.autoAdvance);
  const source = options.source || "manual";

  setupStatusEl.textContent = source === "auto" ? "Checking saved login..." : "Running setup check...";
  setupTextEl.textContent = "";
  try {
    const url = form.querySelector("[name='url']")?.value || "";
    const stateFile = form.querySelector("[name='stateFile']")?.value || ".auth/storage-state.json";
    const networkTemplate = form.querySelector("[name='networkTemplate']")?.value || "outputs/network-log-ui-full.json";
    const networkTemplateProfile = getSelectedNetworkTemplateProfileId();

    const res = await fetch("/api/precheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "simplechat-api",
        url,
        stateFile,
        networkTemplate,
        networkTemplateProfile,
        headed: "true",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setupStatusEl.textContent = data.error || "Setup check failed.";
      return;
    }
    applySetupCheckResult(data, { autoAdvance, source });
  } catch (err) {
    setupStatusEl.textContent = `Setup check failed: ${err.message}`;
  }
}

async function refreshLoginSession() {
  const url = form.querySelector("[name='url']")?.value || "";
  const stateFile = form.querySelector("[name='stateFile']")?.value || ".auth/storage-state.json";
  const networkTemplate = form.querySelector("[name='networkTemplate']")?.value || "outputs/network-log-ui-full.json";
  const networkTemplateProfile = getSelectedNetworkTemplateProfileId();

  setupStatusEl.textContent = "Opening browser for sign-in. Complete login and wait for capture...";
  setupTextEl.textContent = "";
  if (setupOpenChatEl) setupOpenChatEl.disabled = true;
  if (refreshAuthBtn) refreshAuthBtn.disabled = true;

  try {
    const res = await fetch("/api/refresh-auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        stateFile,
        networkTemplate,
        networkTemplateProfile,
        timeoutSec: 300,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      setupStatusEl.textContent = data.error || "Login refresh failed.";
      return;
    }

    setupStatusEl.textContent = data.message || "Login refresh complete.";
    setupTextEl.textContent = data.details || "";
    await runSetupCheck({ autoAdvance: true, source: "refresh" });
  } catch (err) {
    setupStatusEl.textContent = `Login refresh failed: ${err.message}`;
  } finally {
    if (setupOpenChatEl) setupOpenChatEl.disabled = false;
    if (refreshAuthBtn) refreshAuthBtn.disabled = false;
  }
}

async function importManualRequest() {
  const requestText = manualRequestTextEl?.value || "";
  const url = form.querySelector("[name='url']")?.value || "";
  const networkTemplate = form.querySelector("[name='networkTemplate']")?.value || "outputs/network-log-ui-full.json";
  const networkTemplateProfile = getSelectedNetworkTemplateProfileId();
  if (!requestText.trim()) {
    setupStatusEl.textContent = "Paste a copied PowerShell request first.";
    return;
  }

  setupStatusEl.textContent = "Extracting request template...";
  setupTextEl.textContent = "";
  if (importRequestBtn) importRequestBtn.disabled = true;

  try {
    const res = await fetch("/api/import-network-template", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestText, networkTemplate, networkTemplateProfile, url }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setupStatusEl.textContent = data.error || "Could not create the network template.";
      return;
    }

    manualRequestTextEl.value = "";
    setupStatusEl.textContent = data.message;
    await runSetupCheck({ source: "manual-import" });
  } catch (err) {
    setupStatusEl.textContent = `Request import failed: ${err.message}`;
  } finally {
    if (importRequestBtn) importRequestBtn.disabled = false;
  }
}

async function runPrecheck() {
  precheckStatusEl.textContent = "Running precheck...";
  precheckTextEl.textContent = "";
  try {
    const res = await fetch("/api/precheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPrecheckPayload()),
    });
    const data = await res.json();
    if (!res.ok) {
      precheckStatusEl.textContent = data.error || "Precheck failed.";
      return;
    }

    precheckStatusEl.textContent = data.ok ? "Precheck passed." : "Precheck has failures.";
    precheckTextEl.textContent = (data.checks || [])
      .map((c) => `${c.ok ? "[OK]" : "[FAIL]"} ${c.key}: ${c.message}`)
      .join("\n");
  } catch (err) {
    precheckStatusEl.textContent = `Precheck failed: ${err.message}`;
  }
}

async function exportLatestToFoundry() {
  if (!latestJsonlHref) return;
  foundryStatusEl.textContent = "Exporting...";
  try {
    const jsonlPath = latestJsonlHref.replace(/^\//, "");
    const targetDir = foundryTargetDirEl?.value?.trim() || "foundry_exports";
    const res = await fetch("/api/export-foundry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonlPath, targetDir }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      foundryStatusEl.textContent = data.error || "Export failed.";
      return;
    }
    foundryStatusEl.textContent = `Exported to ${data.targetPath}`;
  } catch (err) {
    foundryStatusEl.textContent = `Export failed: ${err.message}`;
  }
}

function validateJsonlLine(obj) {
  const missing = [];
  if (!Object.prototype.hasOwnProperty.call(obj, "query")) missing.push("query");
  if (!Object.prototype.hasOwnProperty.call(obj, "response")) missing.push("response");
  if (!Object.prototype.hasOwnProperty.call(obj, "ground_truth")) missing.push("ground_truth");
  return missing;
}

async function previewLatestJsonl() {
  if (!latestJsonlHref) return;
  previewStatusEl.textContent = "Loading preview...";
  previewTextEl.textContent = "";
  try {
    const res = await fetch(latestJsonlHref);
    if (!res.ok) {
      previewStatusEl.textContent = `Preview failed (HTTP ${res.status})`;
      return;
    }

    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    let invalid = 0;
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (validateJsonlLine(obj).length) invalid += 1;
      } catch {
        invalid += 1;
      }
    }

    previewTextEl.textContent = lines.slice(0, 3).join("\n") || "(empty file)";
    previewStatusEl.textContent = invalid
      ? `Validation: ${invalid} invalid line(s) out of ${lines.length}.`
      : `Validation: all ${lines.length} line(s) passed required keys.`;
  } catch (err) {
    previewStatusEl.textContent = `Preview failed: ${err.message}`;
  }
}

async function refreshRunHistory() {
  historyListEl.textContent = "Loading...";
  try {
    const res = await fetch("/api/run-history");
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) {
      historyListEl.textContent = "No runs yet.";
      return;
    }

    historyListEl.innerHTML = items
      .map((item) => {
        const links = [
          item?.outputs?.excel ? `<a href='/${item.outputs.excel}' target='_blank' rel='noopener'>Excel</a>` : "",
          item?.outputs?.jsonl ? `<a href='/${item.outputs.jsonl}' target='_blank' rel='noopener'>JSONL</a>` : "",
          item?.outputs?.network ? `<a href='/${item.outputs.network}' target='_blank' rel='noopener'>Network</a>` : "",
        ]
          .filter(Boolean)
          .join("");
        return `
          <div class='history-item'>
            <div class='row'>
              <span><strong>${item.ok ? "OK" : "FAIL"}</strong></span>
              <span>${item.mode || "unknown"}</span>
              <span>${item.createdAt || ""}</span>
            </div>
            <div class='links'>${links || "<span>No artifacts</span>"}</div>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    historyListEl.textContent = `Failed to load history: ${err.message}`;
  }
}

async function clearRunHistory() {
  const confirmed = window.confirm("Clear all run history entries?");
  if (!confirmed) return;

  historyListEl.textContent = "Clearing...";
  try {
    const res = await fetch("/api/run-history/clear", { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      historyListEl.textContent = data.error || "Failed to clear history.";
      return;
    }
    historyListEl.textContent = "No runs yet.";
  } catch (err) {
    historyListEl.textContent = `Failed to clear history: ${err.message}`;
  }
}

async function rerunLastConfig() {
  setStatus("Rerunning last saved configuration...", "");
  logsEl.textContent = "";
  logsEl.textContent = "[profile] loading from saved run config...";
  startRunProgress();
  setRunContext(null);
  setDownloads(null);
  runBtn.disabled = true;
  if (rerunBtn) rerunBtn.disabled = true;

  try {
    const res = await fetch("/api/rerun", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    const outputText = [data.command || "", data.stdout || "", data.stderr || ""].filter(Boolean).join("\n\n");
    const runProfileName = data?.runContext?.network_template_profile?.name || "unknown";
    logsEl.textContent = `[profile] ${runProfileName}\n\n${outputText}`;
    const stageSummary = extractStageLinesFromOutput(outputText);
    if (stageSummary.length) setRunStageLines(stageSummary);

    if (!res.ok || !data.ok) {
      setStatus(data.error || `Rerun failed (exit ${data.exitCode ?? "n/a"}).`, "err");
      finishRunProgress(false, "Rerun failed.");
      return;
    }

    setStatus(`Rerun complete. Profile: ${runProfileName}.`, "ok");
    finishRunProgress(true, "Rerun complete.");
    setDownloads(data.outputs || {});
    setRunContext(data.runContext || null);
    await previewLatestJsonl();
    await refreshRunHistory();
  } catch (err) {
    setStatus(`Rerun failed: ${err.message}`, "err");
    finishRunProgress(false, "Rerun failed.");
  } finally {
    runBtn.disabled = false;
    if (rerunBtn) rerunBtn.disabled = false;
  }
}

function validateCurrentStep() {
  if (step === 0) {
    setStatus("Continue to mode selection once setup is ready.");
    return true;
  }
  if (step !== 2) return true;
  const input = form.querySelector("input[name='inputFile']");
  if (!input?.files?.length) {
    setStatus("Please upload an input spreadsheet before continuing.", "err");
    return false;
  }
  setStatus("Ready.");
  return true;
}

prevBtn.addEventListener("click", () => showStep(step - 1));
nextBtn.addEventListener("click", () => {
  if (!validateCurrentStep()) return;
  showStep(step + 1);
});

stepEls.forEach((el) => {
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.addEventListener("click", () => {
    goToStep(Number(el.dataset.step));
  });
  el.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    goToStep(Number(el.dataset.step));
  });
});

form.querySelectorAll("input[name='mode']").forEach((el) => {
  el.addEventListener("change", updateModeVisibility);
});
showAdvancedModesEl?.addEventListener("change", updateModeVisibility);
setupCheckBtn?.addEventListener("click", runSetupCheck);
setupOpenChatEl?.addEventListener("click", refreshLoginSession);
refreshAuthBtn?.addEventListener("click", refreshLoginSession);
importRequestBtn?.addEventListener("click", importManualRequest);
networkTemplateProfileEl?.addEventListener("change", () => {
  applyNetworkTemplateProfile(networkTemplateProfileEl.value, { updatePath: true, syncConfig: true, syncSetup: true });
});
configNetworkTemplateProfileEl?.addEventListener("change", () => {
  applyNetworkTemplateProfile(configNetworkTemplateProfileEl.value, { updatePath: true, syncConfig: true, syncSetup: true });
});
saveNetworkProfileBtn?.addEventListener("click", saveNetworkTemplateProfile);
setDefaultNetworkProfileBtn?.addEventListener("click", setDefaultNetworkTemplateProfile);
deleteNetworkProfileBtn?.addEventListener("click", deleteNetworkTemplateProfile);

jsonlProfileEl?.addEventListener("change", updateProfileUI);
jsonlProfileEl?.addEventListener("change", updateProfilePreview);
previewBtn?.addEventListener("click", previewLatestJsonl);
refreshHistoryBtn?.addEventListener("click", refreshRunHistory);
clearHistoryBtn?.addEventListener("click", clearRunHistory);
precheckBtn?.addEventListener("click", runPrecheck);
exportFoundryBtn?.addEventListener("click", exportLatestToFoundry);
rerunBtn?.addEventListener("click", rerunLastConfig);

["includeGroundTruth", "includeContext", "includeMetadata", "jsonlQueryKey", "jsonlResponseKey", "jsonlGroundTruthKey", "jsonlContextKey"].forEach((name) => {
  const el = form.querySelector(`[name='${name}']`);
  if (!el) return;
  el.addEventListener("input", updateProfilePreview);
  el.addEventListener("change", updateProfilePreview);
});

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!validateCurrentStep()) return;

  const fd = new FormData(form);
  const includeGroundTruth = Boolean(form.querySelector("input[name='includeGroundTruth']")?.checked);
  const includeContext = Boolean(form.querySelector("input[name='includeContext']")?.checked);
  const includeMetadata = Boolean(form.querySelector("input[name='includeMetadata']")?.checked);
  const strictSchema = Boolean(form.querySelector("input[name='strictSchema']")?.checked);
  const maskLogs = Boolean(form.querySelector("input[name='maskLogs']")?.checked);

  const currentMode = selectedMode();
  const selectedProfile = selectedNetworkTemplateProfile();
  if (currentMode === "simplechat-api" && selectedProfile && selectedProfile.exists === false) {
    setStatus(`Selected profile '${selectedProfile.name}' has a missing template file. Update or re-import before running.`, "err");
    return;
  }

  fd.set("includeGroundTruth", includeGroundTruth ? "true" : "false");
  fd.set("includeContext", includeContext ? "true" : "false");
  fd.set("includeMetadata", includeMetadata ? "true" : "false");
  fd.set("strictSchema", strictSchema ? "true" : "false");
  setStatus("Running. This may take a while...", "");
  const selectedProfileName = getSelectedNetworkTemplateProfileName();
  setStatus(`Running with network profile: ${selectedProfileName}. This may take a while...`, "");
  startRunProgress();
  logsEl.textContent = `[profile] ${selectedProfileName}`;
  setRunContext(null);
  setDownloads(null);
  runBtn.disabled = true;

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      body: fd,
    });

    const data = await res.json();
  const outputText = [data.command || "", data.stdout || "", data.stderr || ""].filter(Boolean).join("\n\n");
  logsEl.textContent = `[profile] ${selectedProfileName}\n\n${maskLogs ? maskSensitiveText(outputText) : outputText}`;
  const stageSummary = extractStageLinesFromOutput(outputText);
  if (stageSummary.length) setRunStageLines(stageSummary);

    if (!res.ok || !data.ok) {
      const msg = data.error || `Run failed (exit ${data.exitCode ?? "n/a"}).`;
      if (!logsEl.textContent && msg) {
        logsEl.textContent = msg;
      }
      setStatus(msg, "err");
      finishRunProgress(false, "Run failed.");
      return;
    }

    setStatus("Run complete. Download your artifacts below.", "ok");
    finishRunProgress(true, "Run complete.");
    setDownloads(data.outputs || {});
    setRunContext(data.runContext || null);
    await previewLatestJsonl();
    await refreshRunHistory();
    foundryStatusEl.textContent = "Run complete. You can export latest JSONL to Foundry folder.";
  } catch (err) {
    setStatus(`Run failed: ${err.message}`, "err");
    finishRunProgress(false, "Run failed.");
  } finally {
    runBtn.disabled = false;
  }
});

async function initializeWizard() {
  updateModeVisibility();
  showStep(0);
  await hydrateDefaults();
  if (!networkTemplateProfiles.length) {
    await loadNetworkTemplateProfiles("");
  }
  updateProfileUI();
  updateProfilePreview();
  refreshRunHistory();

  if (!hasAutoSetupRun) {
    hasAutoSetupRun = true;
    await runSetupCheck({ autoAdvance: true, source: "auto" });
  }
}

initializeWizard();
