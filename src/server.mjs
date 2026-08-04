import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import xlsx from "xlsx";
import dotenv from "dotenv";
import { request, chromium } from "playwright";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 5088);
const HOST = process.env.HOST || "127.0.0.1";
const DEFAULT_CHAT_URL = process.env.CHAT_URL || "https://simplechatdemo-fjgpaqe7h6c7akbr.eastus-01.azurewebsites.net/chats";
const DEFAULT_STATE_FILE = process.env.STATE_FILE || ".auth/storage-state.json";
const DEFAULT_NETWORK_TEMPLATE = process.env.NETWORK_TEMPLATE || "outputs/network-log-ui-full.json";
const DEFAULT_NETWORK_PROFILE_ID = process.env.NETWORK_TEMPLATE_PROFILE || "default";
const DEFAULT_SELECTORS = process.env.SELECTORS_PATH || "selectors.example.json";
const DEFAULT_OUTPUT_DIR = process.env.OUTPUT_DIR || "outputs";
const DEFAULT_FOUNDRY_EXPORT_DIR = process.env.FOUNDRY_EXPORT_DIR || "foundry_exports";
const DEFAULT_MASK_LOGS = String(process.env.MASK_LOGS ?? "true").toLowerCase() !== "false";
const RUNNER_ENTRYPOINT = "src/run-chat-runner.mjs";

const app = express();

const uploadsDir = path.join(ROOT, "uploads");
const outputsDir = path.join(ROOT, "outputs");
const authDir = path.join(ROOT, ".auth");
const examplesDir = path.join(ROOT, "examples");
const historyPath = path.join(outputsDir, "run-history.json");
const lastRunPayloadPath = path.join(outputsDir, "last-run-payload.json");
const modelContextPath = path.join(outputsDir, "model-context.json");
const networkProfilesPath = path.join(outputsDir, "network-template-profiles.json");

for (const dir of [uploadsDir, outputsDir, authDir, examplesDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureExampleTemplate();
ensureNetworkTemplateProfiles();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsDir),
    filename: (_, file, cb) => {
      const stamp = new Date().toISOString().replace(/[.:]/g, "-");
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${stamp}-${safeName}`);
    },
  }),
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});

app.use(express.json({ limit: "2mb" }));
app.use("/outputs", express.static(outputsDir));
app.use("/examples", express.static(examplesDir));
app.use(express.static(path.join(ROOT, "web")));

app.get("/api/health", (_, res) => {
  res.json({ ok: true, service: "wizard", cwd: ROOT, runnerEntrypoint: RUNNER_ENTRYPOINT });
});

app.get("/api/files/defaults", (_, res) => {
  const profileState = getNetworkTemplateProfileState();
  res.json({
    defaultStateFile: DEFAULT_STATE_FILE,
    defaultNetworkTemplate: DEFAULT_NETWORK_TEMPLATE,
    defaultNetworkTemplateProfile: profileState.defaultProfileId,
    defaultSelectors: DEFAULT_SELECTORS,
    defaultChatUrl: DEFAULT_CHAT_URL,
    defaultOutputDir: DEFAULT_OUTPUT_DIR,
    defaultApiUrl: process.env.API_URL || "",
    defaultApiMethod: process.env.API_METHOD || "POST",
    defaultApiResponsePath: process.env.API_RESPONSE_PATH || "choices.0.message.content",
    defaultJsonlProfile: process.env.JSONL_PROFILE || "foundry-basic",
    defaultJsonlQueryKey: process.env.JSONL_QUERY_KEY || "query",
    defaultJsonlResponseKey: process.env.JSONL_RESPONSE_KEY || "response",
    defaultJsonlGroundTruthKey: process.env.JSONL_GROUND_TRUTH_KEY || "ground_truth",
    defaultJsonlContextKey: process.env.JSONL_CONTEXT_KEY || "context",
    defaultStrictSchema: process.env.STRICT_SCHEMA || "false",
    defaultFoundryExportDir: DEFAULT_FOUNDRY_EXPORT_DIR,
    defaultMaskLogs: DEFAULT_MASK_LOGS,
    capabilities: ["manual-network-template-import"],
    runnerEntrypoint: RUNNER_ENTRYPOINT,
  });
});

app.get("/api/network-template-profiles", (_, res) => {
  const state = getNetworkTemplateProfileState();
  res.json({
    ok: true,
    defaultProfileId: state.defaultProfileId,
    profiles: withProfileRuntimeState(state.profiles),
  });
});

app.get("/api/network-template-profile-request", (req, res) => {
  try {
    const profileId = String(req.query?.profileId || "").trim();
    if (!profileId) {
      return res.status(400).json({ ok: false, error: "profileId is required." });
    }

    const state = getNetworkTemplateProfileState();
    const profile = state.profiles.find((p) => p.id === profileId);
    if (!profile) {
      return res.status(404).json({ ok: false, error: `Profile not found: ${profileId}` });
    }

    const preview = extractTemplateRequestPreview(profile.networkTemplate);
    return res.json({
      ok: true,
      profileId,
      networkTemplate: profile.networkTemplate,
      source: preview.source,
      requestText: preview.requestText,
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || String(error) });
  }
});

app.post("/api/network-template-profiles/upsert", (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    const networkTemplate = String(body.networkTemplate || "").trim();
    if (!name) {
      return res.status(400).json({ ok: false, error: "Profile name is required." });
    }
    if (!networkTemplate) {
      return res.status(400).json({ ok: false, error: "networkTemplate is required." });
    }

    const normalizedTemplatePath = toWorkspaceRelativePath(safeResolveWorkspacePath(networkTemplate));

    const requestedId = String(body.id || "").trim();
    const detectedModel = extractModelInfoFromTemplatePath(normalizedTemplatePath);
    const state = getNetworkTemplateProfileState();
    const existingIdx = state.profiles.findIndex((p) => p.id === requestedId || p.name.toLowerCase() === name.toLowerCase());
    const now = new Date().toISOString();

    const nextProfile = {
      id: requestedId || toProfileId(name),
      name,
      description: String(body.description || "").trim(),
      networkTemplate: normalizedTemplatePath,
      modelId: String(body.modelId || detectedModel.modelId || "").trim(),
      modelName: String(body.modelName || detectedModel.modelName || "").trim(),
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      const existing = state.profiles[existingIdx];
      state.profiles[existingIdx] = {
        ...existing,
        ...nextProfile,
        id: existing.id,
        createdAt: existing.createdAt || now,
      };
    } else {
      state.profiles.push({
        ...nextProfile,
        createdAt: now,
      });
    }

    if (body.setDefault === true || body.setDefault === "true") {
      state.defaultProfileId = existingIdx >= 0 ? state.profiles[existingIdx].id : nextProfile.id;
    }

    saveNetworkTemplateProfileState(state);
    return res.json({ ok: true, defaultProfileId: state.defaultProfileId, profiles: withProfileRuntimeState(state.profiles) });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || String(error) });
  }
});

app.post("/api/network-template-profiles/set-default", (req, res) => {
  try {
    const body = req.body || {};
    const id = String(body.id || "").trim();
    if (!id) {
      return res.status(400).json({ ok: false, error: "Profile id is required." });
    }

    const state = getNetworkTemplateProfileState();
    const exists = state.profiles.some((p) => p.id === id);
    if (!exists) {
      return res.status(404).json({ ok: false, error: `Profile not found: ${id}` });
    }

    state.defaultProfileId = id;
    saveNetworkTemplateProfileState(state);
    return res.json({ ok: true, defaultProfileId: state.defaultProfileId, profiles: withProfileRuntimeState(state.profiles) });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || String(error) });
  }
});

app.post("/api/network-template-profiles/delete", (req, res) => {
  try {
    const body = req.body || {};
    const id = String(body.id || "").trim();
    if (!id) {
      return res.status(400).json({ ok: false, error: "Profile id is required." });
    }

    const state = getNetworkTemplateProfileState();
    const idx = state.profiles.findIndex((p) => p.id === id);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: `Profile not found: ${id}` });
    }
    if (state.profiles.length <= 1) {
      return res.status(400).json({ ok: false, error: "Cannot delete the last remaining profile." });
    }

    state.profiles.splice(idx, 1);
    if (!state.profiles.some((p) => p.id === state.defaultProfileId)) {
      state.defaultProfileId = state.profiles[0].id;
    }
    saveNetworkTemplateProfileState(state);

    return res.json({ ok: true, defaultProfileId: state.defaultProfileId, profiles: withProfileRuntimeState(state.profiles) });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || String(error) });
  }
});

app.post("/api/precheck", async (req, res) => {
  try {
    const body = req.body || {};
    const mode = String(body.mode || "simplechat-api");
    const url = String(body.url || DEFAULT_CHAT_URL);
    const stateFile = String(body.stateFile || DEFAULT_STATE_FILE);
    const networkTemplate =
      mode === "simplechat-api"
        ? resolveNetworkTemplatePathFromBody(body)
        : String(body.networkTemplate || DEFAULT_NETWORK_TEMPLATE);
    const apiUrl = String(body.apiUrl || process.env.API_URL || "");
    const headed = String(body.headed ?? "true").toLowerCase() !== "false";

    const checks = [];

    const parsed = safeParseUrl(url);
    checks.push({
      key: "chatUrl",
      ok: parsed.ok,
      message: parsed.ok ? "Chat URL is valid." : `Invalid chat URL: ${url}`,
    });

    if (mode === "simplechat-api") {
      const stateAbs = safeResolveWorkspacePath(stateFile);
      const templateAbs = safeResolveWorkspacePath(networkTemplate);
      const hasState = fs.existsSync(stateAbs);
      checks.push({
        key: "stateFile",
        ok: hasState,
        message: hasState ? `State file found: ${stateFile}` : `Missing state file: ${stateFile}`,
      });
      checks.push({
        key: "networkTemplate",
        ok: fs.existsSync(templateAbs),
        message: fs.existsSync(templateAbs)
          ? `Network template found: ${networkTemplate}`
          : `Missing network template: ${networkTemplate}`,
      });

      if (parsed.ok && hasState) {
        const authCheck = await checkSimpleChatAuth(url, stateAbs);
        checks.push(authCheck);
      }
    }

    if (mode === "ui") {
      if (!headed) {
        const stateAbs = safeResolveWorkspacePath(stateFile);
        checks.push({
          key: "headlessState",
          ok: fs.existsSync(stateAbs),
          message: fs.existsSync(stateAbs)
            ? "Headless UI mode can reuse saved auth state."
            : "Headless UI mode requires a saved auth state file.",
        });
      }
    }

    if (mode === "api") {
      const parsedApi = safeParseUrl(apiUrl);
      checks.push({
        key: "apiUrl",
        ok: parsedApi.ok,
        message: parsedApi.ok ? "Generic API URL is valid." : "Generic API URL is missing or invalid.",
      });
    }

    const ok = checks.every((c) => c.ok);
    return res.json({ ok, checks });
  } catch (error) {
    const msg = String(error?.message || error || "Precheck failed.");
    const isValidationError =
      msg.includes("Unknown network template profile") ||
      msg.includes("Path must be within workspace root");
    return res.status(isValidationError ? 400 : 500).json({ ok: false, error: msg });
  }
});

app.post("/api/refresh-auth", async (req, res) => {
  try {
    const body = req.body || {};
    const url = String(body.url || DEFAULT_CHAT_URL);
    const stateFile = String(body.stateFile || DEFAULT_STATE_FILE);
    const timeoutSec = Number(body.timeoutSec || 300);

    const parsed = safeParseUrl(url);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: `Invalid chat URL: ${url}` });
    }

    const stateAbs = safeResolveWorkspacePath(stateFile);
    ensureDir(path.dirname(stateAbs));

    const refreshed = await refreshSimpleChatAuth({
      url,
      statePath: stateAbs,
      timeoutMs: Math.max(30_000, timeoutSec * 1000),
    });

    if (!refreshed.ok) {
      return res.status(500).json(refreshed);
    }

    return res.json(refreshed);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.post("/api/import-network-template", (req, res) => {
  try {
    const body = req.body || {};
    const requestText = String(body.requestText || "");
    const networkTemplate = resolveNetworkTemplatePathFromBody(body);
    const fallbackUrl = String(body.url || DEFAULT_CHAT_URL);
    const captured = parseManualChatRequest(requestText, fallbackUrl);
    const templateAbs = safeResolveWorkspacePath(networkTemplate);
    const selectedProfileId = String(body.networkTemplateProfile || "").trim();

    ensureDir(path.dirname(templateAbs));
    fs.writeFileSync(templateAbs, JSON.stringify([captured], null, 2), "utf8");

    if (selectedProfileId) {
      const state = getNetworkTemplateProfileState();
      const idx = state.profiles.findIndex((p) => p.id === selectedProfileId);
      if (idx >= 0) {
        const existing = state.profiles[idx];
        const payload = JSON.parse(String(captured.postData || "{}"));
        const modelInfo = extractModelInfoFromBody(payload);
        state.profiles[idx] = {
          ...existing,
          networkTemplate: toWorkspaceRelativePath(templateAbs),
          modelId: modelInfo.modelId,
          modelName: modelInfo.modelName,
          updatedAt: new Date().toISOString(),
        };
        saveNetworkTemplateProfileState(state);
      }
    }

    return res.json({
      ok: true,
      message: `Network template created: ${networkTemplate}`,
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || String(error) });
  }
});

app.post("/api/export-foundry", async (req, res) => {
  try {
    const body = req.body || {};
    const jsonlPath = String(body.jsonlPath || "");
    if (!jsonlPath) {
      return res.status(400).json({ ok: false, error: "jsonlPath is required" });
    }

    const targetDirInput = String(body.targetDir || DEFAULT_FOUNDRY_EXPORT_DIR);
    const sourceAbs = safeResolveWorkspacePath(jsonlPath);
    if (!fs.existsSync(sourceAbs)) {
      return res.status(404).json({ ok: false, error: `JSONL file not found: ${jsonlPath}` });
    }

    const targetDirAbs = safeResolveWorkspacePath(targetDirInput);
    if (!fs.existsSync(targetDirAbs)) {
      fs.mkdirSync(targetDirAbs, { recursive: true });
    }

    const fileName = path.basename(sourceAbs);
    const targetAbs = path.join(targetDirAbs, fileName);
    fs.copyFileSync(sourceAbs, targetAbs);

    const rel = toWorkspaceRelativePath(targetAbs);
    return res.json({ ok: true, targetPath: rel });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.get("/api/run-history", (_, res) => {
  res.json({ ok: true, items: readRunHistory() });
});

app.post("/api/run-history/clear", (_, res) => {
  try {
    clearRunHistory();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.get("/api/last-run-payload", (_, res) => {
  try {
    if (!fs.existsSync(lastRunPayloadPath)) {
      return res.json({ ok: true, payload: null });
    }
    const parsed = JSON.parse(fs.readFileSync(lastRunPayloadPath, "utf8"));
    return res.json({ ok: true, payload: parsed });
  } catch {
    return res.json({ ok: true, payload: null });
  }
});

app.post("/api/rerun", async (req, res) => {
  try {
    if (!fs.existsSync(lastRunPayloadPath)) {
      return res.status(404).json({ ok: false, error: "No previous run payload found." });
    }

    const payload = JSON.parse(fs.readFileSync(lastRunPayloadPath, "utf8"));
    const merged = {
      ...(payload || {}),
      ...(req.body || {}),
    };

    if (!merged.inputPath) {
      return res.status(400).json({ ok: false, error: "Saved payload missing inputPath." });
    }

    const inputAbs = safeResolveWorkspacePath(merged.inputPath);
    if (!fs.existsSync(inputAbs)) {
      return res.status(404).json({ ok: false, error: `Input file no longer exists: ${merged.inputPath}` });
    }

    const runResult = await executeRunFromRequest({ body: merged, inputPathAbs: inputAbs, uploadedInputPath: inputAbs });
    return res.status(runResult.statusCode).json(runResult.response);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.post(
  "/api/run",
  upload.fields([
    { name: "inputFile", maxCount: 1 },
    { name: "networkTemplateFile", maxCount: 1 },
    { name: "selectorsFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const files = req.files || {};
      const input = files.inputFile?.[0];
      if (!input) {
        return res.status(400).json({ ok: false, error: "inputFile is required" });
      }

      const validationError = validateSpreadsheetUpload(input.path, input.originalname);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }

      const runResult = await executeRunFromRequest({ body: req.body || {}, inputPathAbs: input.path, uploadedInputPath: input.path, files });
      return res.status(runResult.statusCode).json(runResult.response);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || String(error) });
    }
  }
);

app.get("*", (req, res) => {
  res.sendFile(path.join(ROOT, "web", "index.html"));
});

startServer(app, HOST, PORT);

function startServer(serverApp, host, preferredPort) {
  const candidates = [preferredPort, 5173, 4173, 3000, 0];

  const tryNext = (index) => {
    if (index >= candidates.length) {
      console.error("Failed to bind any HTTP port.");
      process.exit(1);
      return;
    }

    const port = candidates[index];
    const server = serverApp.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      console.log(`Wizard UI running at http://${host}:${actualPort}`);
    });

    server.on("error", (err) => {
      if (err && (err.code === "EACCES" || err.code === "EADDRINUSE")) {
        console.warn(`Port ${port} unavailable (${err.code}). Trying next.`);
        tryNext(index + 1);
        return;
      }

      console.error(err);
      process.exit(1);
    });
  };

  tryNext(0);
}

function runCommand(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      windowsHide: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function parseOutputPaths(text) {
  const excelMatch = text.match(/Excel output:\s*(.+)/i);
  const jsonlMatch = text.match(/JSONL output:\s*(.+)/i);
  const networkMatch = text.match(/Network log:\s*(.+)/i);

  const toWebPath = (val) => {
    if (!val) return null;
    const normalized = val.trim().replace(/\\/g, "/");
    const idx = normalized.toLowerCase().lastIndexOf("/outputs/");
    if (idx >= 0) return normalized.slice(idx + 1);
    return null;
  };

  return {
    excel: toWebPath(excelMatch?.[1] || ""),
    jsonl: toWebPath(jsonlMatch?.[1] || ""),
    network: toWebPath(networkMatch?.[1] || ""),
  };
}

function ensureExampleTemplate() {
  const examplePath = path.join(examplesDir, "input-template.xlsx");
  if (fs.existsSync(examplePath)) return;

  const rows = [
    {
      query: "What is the capital of France?",
      response: "",
    },
    {
      query: "Explain REST APIs in one sentence.",
      response: "",
    },
  ];

  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, "input");
  xlsx.writeFile(wb, examplePath);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function validateSpreadsheetUpload(filePath, originalName) {
  const ext = path.extname(String(originalName || filePath)).toLowerCase();
  if (ext !== ".xlsx") return null;

  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);

    const signatureHex = [...buf].map((b) => b.toString(16).padStart(2, "0")).join(" ").toUpperCase();
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b;

    // .xlsx should be ZIP (PK). OLE header usually means encrypted/legacy format.
    if (!isZip) {
      return [
        "Uploaded .xlsx file is not in modern XLSX format.",
        `Detected signature: ${signatureHex}.`,
        "Please re-save as unprotected .xlsx or export as .csv, then upload again.",
      ].join(" ");
    }
  } catch {
    return null;
  }

  return null;
}

function readRunHistory() {
  if (!fs.existsSync(historyPath)) return [];
  try {
    const raw = fs.readFileSync(historyPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

function appendRunHistory(item) {
  const items = readRunHistory();
  items.unshift(item);
  const trimmed = items.slice(0, 30);
  fs.writeFileSync(historyPath, JSON.stringify(trimmed, null, 2), "utf8");
}

function clearRunHistory() {
  fs.writeFileSync(historyPath, JSON.stringify([], null, 2), "utf8");
}

function safeParseUrl(value) {
  try {
    const u = new URL(value);
    const ok = u.protocol === "http:" || u.protocol === "https:";
    return { ok };
  } catch {
    return { ok: false };
  }
}

function safeResolveWorkspacePath(inputPath) {
  const resolved = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(ROOT, inputPath);
  const rel = path.relative(ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path must be within workspace root.");
  }
  return resolved;
}

function toWorkspaceRelativePath(absPath) {
  return path.relative(ROOT, absPath).replace(/\\/g, "/");
}

function tryNormalizeWorkspaceRelativePath(inputPath) {
  try {
    return toWorkspaceRelativePath(safeResolveWorkspacePath(String(inputPath || ""))).toLowerCase();
  } catch {
    return "";
  }
}

function ensureNetworkTemplateProfiles() {
  if (fs.existsSync(networkProfilesPath)) return;
  const now = new Date().toISOString();
  const initial = {
    defaultProfileId: DEFAULT_NETWORK_PROFILE_ID,
    profiles: [
      {
        id: DEFAULT_NETWORK_PROFILE_ID,
        name: "Default",
        description: "Default network template profile",
        networkTemplate: DEFAULT_NETWORK_TEMPLATE,
        modelId: "",
        modelName: "",
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
  fs.writeFileSync(networkProfilesPath, JSON.stringify(initial, null, 2), "utf8");
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const id = String(profile.id || "").trim();
  const name = String(profile.name || "").trim();
  const networkTemplate = String(profile.networkTemplate || "").trim();
  if (!id || !name || !networkTemplate) return null;
  return {
    id,
    name,
    description: String(profile.description || "").trim(),
    networkTemplate,
    modelId: String(profile.modelId || "").trim(),
    modelName: String(profile.modelName || "").trim(),
    createdAt: String(profile.createdAt || "").trim(),
    updatedAt: String(profile.updatedAt || "").trim(),
  };
}

function saveNetworkTemplateProfileState(state) {
  const payload = {
    defaultProfileId: String(state?.defaultProfileId || DEFAULT_NETWORK_PROFILE_ID),
    profiles: Array.isArray(state?.profiles) ? state.profiles : [],
  };
  ensureDir(path.dirname(networkProfilesPath));
  fs.writeFileSync(networkProfilesPath, JSON.stringify(payload, null, 2), "utf8");
}

function withProfileRuntimeState(profiles) {
  const list = Array.isArray(profiles) ? profiles : [];
  return list.map((profile) => {
    const p = profile && typeof profile === "object" ? profile : {};
    const templatePath = String(p.networkTemplate || "");
    const detected = extractModelInfoFromTemplatePath(templatePath);
    let exists = false;
    try {
      exists = fs.existsSync(safeResolveWorkspacePath(templatePath));
    } catch {
      exists = false;
    }
    return {
      ...p,
      modelId: String(p.modelId || detected.modelId || "").trim(),
      modelName: String(p.modelName || detected.modelName || "").trim(),
      exists,
    };
  });
}

function getNetworkTemplateProfileState() {
  ensureNetworkTemplateProfiles();
  try {
    const raw = fs.readFileSync(networkProfilesPath, "utf8");
    const parsed = JSON.parse(raw);
    const profiles = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
    const normalized = profiles.map((p) => normalizeProfile(p)).filter(Boolean);

    if (!normalized.length) {
      const now = new Date().toISOString();
      normalized.push({
        id: DEFAULT_NETWORK_PROFILE_ID,
        name: "Default",
        description: "Default network template profile",
        networkTemplate: DEFAULT_NETWORK_TEMPLATE,
        modelId: "",
        modelName: "",
        createdAt: now,
        updatedAt: now,
      });
    }

    const defaultId = String(parsed?.defaultProfileId || "").trim();
    const hasDefault = normalized.some((p) => p.id === defaultId);
    const state = {
      defaultProfileId: hasDefault ? defaultId : normalized[0].id,
      profiles: normalized,
    };
    saveNetworkTemplateProfileState(state);
    return state;
  } catch {
    const now = new Date().toISOString();
    const state = {
      defaultProfileId: DEFAULT_NETWORK_PROFILE_ID,
      profiles: [
        {
          id: DEFAULT_NETWORK_PROFILE_ID,
          name: "Default",
          description: "Default network template profile",
          networkTemplate: DEFAULT_NETWORK_TEMPLATE,
          modelId: "",
          modelName: "",
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    saveNetworkTemplateProfileState(state);
    return state;
  }
}

function toProfileId(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `profile-${Date.now()}`;
}

function resolveProfileFromBody(body) {
  const selected = String(body?.networkTemplateProfile || "").trim();
  const state = getNetworkTemplateProfileState();
  if (!selected) {
    return state.profiles.find((p) => p.id === state.defaultProfileId) || state.profiles[0] || null;
  }
  return state.profiles.find((p) => p.id === selected) || null;
}

function resolveNetworkTemplatePathFromBody(body) {
  const selected = String(body?.networkTemplateProfile || "").trim();
  if (selected) {
    const profile = resolveProfileFromBody(body);
    if (!profile) {
      throw new Error(`Unknown network template profile: ${selected}`);
    }
    return profile.networkTemplate;
  }
  return String(body?.networkTemplate || DEFAULT_NETWORK_TEMPLATE);
}

function resolveProfileForTemplate(networkTemplatePath, selectedProfileId = "") {
  try {
    const relPath = toWorkspaceRelativePath(safeResolveWorkspacePath(networkTemplatePath));
    const relPathNormalized = tryNormalizeWorkspaceRelativePath(networkTemplatePath);
    const state = getNetworkTemplateProfileState();
    const preferred = selectedProfileId ? state.profiles.find((p) => p.id === selectedProfileId) : null;
    const match =
      preferred ||
      state.profiles.find((p) => {
        const candidate = tryNormalizeWorkspaceRelativePath(String(p.networkTemplate || ""));
        return Boolean(candidate) && candidate === relPathNormalized;
      });
    if (!match) {
      return {
        id: "",
        name: "",
        networkTemplate: relPath,
        modelId: "",
        modelName: "",
      };
    }
    return {
      id: match.id,
      name: match.name,
      networkTemplate: match.networkTemplate,
      modelId: String(match.modelId || ""),
      modelName: String(match.modelName || ""),
    };
  } catch {
    return {
      id: "",
      name: "",
      networkTemplate: String(networkTemplatePath || ""),
      modelId: "",
      modelName: "",
    };
  }
}

function buildSafeCommand(args) {
  const redactedFlags = new Set(["--api-headers", "--api-body-template"]);
  const safeArgs = [];

  for (let i = 0; i < args.length; i += 1) {
    const current = String(args[i]);
    safeArgs.push(current);
    if (redactedFlags.has(current) && i + 1 < args.length) {
      safeArgs.push("[REDACTED]");
      i += 1;
    }
  }

  return `node ${safeArgs.join(" ")}`;
}

function buildRunContext({ mode, url, networkTemplatePath, networkTemplateProfile, apiUrl, apiMethod, apiHeadersRaw, apiBodyTemplateRaw }) {
  if (mode === "simplechat-api") {
    return buildSimpleChatRunContext(url, networkTemplatePath, networkTemplateProfile);
  }
  if (mode === "api") {
    return buildApiModeRunContext(apiUrl, apiMethod, apiHeadersRaw, apiBodyTemplateRaw);
  }
  return {
    mode,
    model: "n/a",
    exampleRequest: {
      note: "UI mode sends prompts through browser automation. Optional network capture can show underlying API calls.",
    },
  };
}

function buildSimpleChatRunContext(url, networkTemplatePath, networkTemplateProfile = "") {
  const profileInfo = resolveProfileForTemplate(networkTemplatePath, networkTemplateProfile);
  try {
    const templateAbs = safeResolveWorkspacePath(networkTemplatePath);
    const events = JSON.parse(fs.readFileSync(templateAbs, "utf8"));
    const req = events.find(
      (e) => e.kind === "request" && e.method === "POST" && typeof e.url === "string" && e.url.includes("/api/chat/stream") && !e.url.includes("client-event")
    );

    if (!req || !req.postData) {
      return {
        mode: "simplechat-api",
        model: "unknown",
        network_template_profile: profileInfo,
        exampleRequest: { note: "No /api/chat/stream request found in network template." },
      };
    }

    const templateBody = JSON.parse(req.postData);
    const model = detectModelFromBody(templateBody);
    const cachedModelContext = readModelContext();
    const modelName = String(cachedModelContext?.modelName || "").trim();
    const body = {
      ...templateBody,
      message: "<query>",
      conversation_id: "<created-per-row>",
    };

    return {
      mode: "simplechat-api",
      model: modelName || model,
      model_id: model,
      model_name: modelName || "",
      network_template_profile: profileInfo,
      exampleRequest: sanitizeObject({
        method: req.method || "POST",
        url: `${new URL(url).origin}/api/chat/stream`,
        headers: {
          accept: "application/json, text/event-stream, */*",
          "content-type": "application/json",
        },
        body,
      }),
    };
  } catch {
    const cachedModelContext = readModelContext();
    const modelName = String(cachedModelContext?.modelName || "").trim();
    const modelId = String(cachedModelContext?.modelId || "unknown").trim() || "unknown";
    return {
      mode: "simplechat-api",
      model: modelName || modelId,
      model_id: modelId,
      model_name: modelName || "",
      network_template_profile: profileInfo,
      exampleRequest: { note: "Could not parse network template for request preview." },
    };
  }
}

function buildApiModeRunContext(apiUrl, apiMethod, apiHeadersRaw, apiBodyTemplateRaw) {
  let headers = {};
  let body = { messages: [{ role: "user", content: "<query>" }] };

  if (apiHeadersRaw) {
    try {
      headers = JSON.parse(apiHeadersRaw);
    } catch {
      headers = { _raw: "<invalid json>" };
    }
  }

  if (apiBodyTemplateRaw) {
    try {
      body = JSON.parse(String(apiBodyTemplateRaw).replace(/\{\{\s*query\s*\}\}/g, "<query>"));
    } catch {
      body = { _raw: "<invalid json>" };
    }
  }

  return {
    mode: "api",
    model: detectModelFromBody(body),
    exampleRequest: sanitizeObject({
      method: String(apiMethod || "POST").toUpperCase(),
      url: apiUrl || "<api-url>",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body,
    }),
  };
}

function detectModelFromBody(body) {
  const keys = ["model", "model_name", "deployment", "deployment_name", "engine", "modelId", "model_id"];
  for (const key of keys) {
    const val = body?.[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return "unknown";
}

function extractModelInfoFromBody(body) {
  const modelId = String(detectModelFromBody(body) || "").trim();
  const nameCandidates = [
    body?.model_name,
    body?.model_deployment,
    body?.deployment_name,
    body?.deployment,
    body?.model,
  ];
  const modelName =
    nameCandidates.find((v) => typeof v === "string" && v.trim())?.trim() ||
    (modelId && !isGuidLike(modelId) ? modelId : "");

  return {
    modelId: modelId === "unknown" ? "" : modelId,
    modelName: String(modelName || ""),
  };
}

function extractModelInfoFromTemplatePath(networkTemplatePath) {
  try {
    const templateAbs = safeResolveWorkspacePath(String(networkTemplatePath || ""));
    if (!fs.existsSync(templateAbs)) return { modelId: "", modelName: "" };
    const events = JSON.parse(fs.readFileSync(templateAbs, "utf8"));
    const req = Array.isArray(events)
      ? events.find((e) => e?.kind === "request" && String(e?.url || "").includes("/api/chat/stream") && e?.postData)
      : null;
    if (!req?.postData) return { modelId: "", modelName: "" };
    const payload = JSON.parse(String(req.postData));
    return extractModelInfoFromBody(payload);
  } catch {
    return { modelId: "", modelName: "" };
  }
}

function extractTemplateRequestPreview(networkTemplatePath) {
  const templateAbs = safeResolveWorkspacePath(String(networkTemplatePath || ""));
  if (!fs.existsSync(templateAbs)) {
    throw new Error(`Template file not found: ${networkTemplatePath}`);
  }

  const raw = fs.readFileSync(templateAbs, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { source: "template.raw", requestText: raw };
  }

  if (!Array.isArray(parsed)) {
    return { source: "template.json", requestText: JSON.stringify(parsed, null, 2) };
  }

  const req = parsed.find((e) => e?.kind === "request" && typeof e?.postData === "string" && String(e.postData).trim());
  if (!req?.postData) {
    return { source: "template.events", requestText: JSON.stringify(parsed, null, 2) };
  }

  const postData = String(req.postData || "").trim();
  try {
    return { source: "request.postData.json", requestText: JSON.stringify(JSON.parse(postData), null, 2) };
  } catch {
    return { source: "request.postData.raw", requestText: postData };
  }
}

function sanitizeObject(value) {
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeObject(v));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = String(k);
    const lower = key.toLowerCase();
    if (lower.includes("authorization") || lower.includes("token") || lower.includes("secret") || lower.includes("api_key") || lower === "key") {
      out[key] = "[REDACTED]";
      continue;
    }

    if (typeof v === "string") {
      out[key] = v.replace(/([?&](?:token|access_token|api_key|apikey|key|sig|signature)=)([^&\s]+)/gi, "$1[REDACTED]");
    } else {
      out[key] = sanitizeObject(v);
    }
  }
  return out;
}

async function executeRunFromRequest({ body, inputPathAbs, uploadedInputPath, files = {} }) {
  const mode = String(body.mode || "simplechat-api");
  const args = ["src/run-chat-runner.mjs", "--mode", mode, "--input", inputPathAbs];
  const selectedProfileId = String(body.networkTemplateProfile || "").trim();
  const selectedProfile = selectedProfileId ? resolveProfileFromBody(body) : null;
  const resolvedTemplatePath =
    mode === "simplechat-api"
      ? resolveNetworkTemplatePathFromBody(body)
      : String(body.networkTemplate || DEFAULT_NETWORK_TEMPLATE);

  const add = (key, val) => {
    if (val === undefined || val === null || val === "") return;
    args.push(`--${key}`, String(val));
  };

  add("query-column", body.queryColumn || "query");
  add("reference-column", body.referenceColumn || "response");
  add("context-column", body.contextColumn || "");
  add("output-dir", body.outputDir || DEFAULT_OUTPUT_DIR);
  add("url", body.url || DEFAULT_CHAT_URL);
  add("state-file", body.stateFile || DEFAULT_STATE_FILE);
  add("timeout-ms", body.timeoutMs || process.env.TIMEOUT_MS || "2147483647");
  add("wait-ms", body.waitMs || process.env.WAIT_MS || "500");
  add("include-ground-truth", body.includeGroundTruth === "false" ? "false" : "true");
  add("include-context", body.includeContext === "true" ? "true" : "false");
  add("include-metadata", body.includeMetadata === "true" ? "true" : "false");
  add("strict-schema", body.strictSchema === "true" ? "true" : "false");
  add("jsonl-profile", body.jsonlProfile || "foundry-basic");
  add("jsonl-query-key", body.jsonlQueryKey || "query");
  add("jsonl-response-key", body.jsonlResponseKey || "response");
  add("jsonl-ground-truth-key", body.jsonlGroundTruthKey || "ground_truth");
  add("jsonl-context-key", body.jsonlContextKey || "context");

  const runId = new Date().toISOString().replace(/[.:]/g, "-");

  if (mode === "simplechat-api") {
    add("network-template-profile-id", selectedProfileId || "");
    add("network-template-profile-name", selectedProfile?.name || "");
    add("network-template-profile-path", resolvedTemplatePath || "");
  }

  if (mode === "simplechat-api") {
    const netTemplate = files.networkTemplateFile?.[0]?.path || resolvedTemplatePath;
    add("network-template", netTemplate);
  }

  if (mode === "ui") {
    const selectorsPath = files.selectorsFile?.[0]?.path || body.selectors || DEFAULT_SELECTORS;
    add("selectors", selectorsPath);
    add("new-chat", body.newChat === "true" ? "true" : "false");
    add("headed", body.headed === "false" ? "false" : "true");
    if (body.debugNetwork === "true") {
      add("debug-network", "true");
      add("network-log", "outputs/network-log-ui-full.json");
    }
  }

  if (mode === "api") {
    add("api-url", body.apiUrl || "");
    add("api-method", body.apiMethod || "POST");
    add("api-headers", body.apiHeaders || "");
    add("api-body-template", body.apiBodyTemplate || "");
    add("api-response-path", body.apiResponsePath || "choices.0.message.content");
  }

  const runContext = buildRunContext({
    mode,
    url: body.url || DEFAULT_CHAT_URL,
    networkTemplatePath: files.networkTemplateFile?.[0]?.path || resolvedTemplatePath,
    networkTemplateProfile: selectedProfileId,
    apiUrl: body.apiUrl || process.env.API_URL || "",
    apiMethod: body.apiMethod || process.env.API_METHOD || "POST",
    apiHeadersRaw: body.apiHeaders || "",
    apiBodyTemplateRaw: body.apiBodyTemplate || "",
  });

  add("run-id", runId);
  add("run-timestamp", new Date().toISOString());
  add("run-model", runContext.model || "unknown");

  const run = await runCommand("node", args, ROOT);
  const outputs = parseOutputPaths(run.stdout + "\n" + run.stderr);

  const safeCommand = buildSafeCommand(args);
  const response = {
    ok: run.code === 0,
    exitCode: run.code,
    command: safeCommand,
    stdout: run.stdout,
    stderr: run.stderr,
    outputs,
    runContext,
  };

  if (run.code !== 0) {
    appendRunHistory({
      ok: false,
      mode,
      createdAt: new Date().toISOString(),
      outputs,
      command: safeCommand,
      error: run.stderr || run.stdout,
    });
    return { statusCode: 500, response };
  }

  appendRunHistory({
    ok: true,
    mode,
    createdAt: new Date().toISOString(),
    outputs,
    command: safeCommand,
  });

  const persistPayload = {
    ...body,
    networkTemplateProfile: selectedProfileId,
    inputPath: toWorkspaceRelativePath(uploadedInputPath),
  };
  fs.writeFileSync(lastRunPayloadPath, JSON.stringify(persistPayload, null, 2), "utf8");

  return { statusCode: 200, response };
}

async function checkSimpleChatAuth(url, statePath) {
  try {
    const baseURL = new URL(url).origin;
    const ctx = await request.newContext({
      baseURL,
      storageState: statePath,
      extraHTTPHeaders: {
        accept: "application/json, text/event-stream, */*",
      },
    });

    const res = await ctx.get("/api/user/settings");
    const status = res.status();
    await ctx.dispose();

    if (status === 200) {
      return {
        key: "savedAuth",
        ok: true,
        message: "Saved auth state can access /api/user/settings.",
      };
    }

    if (status === 401) {
      return {
        key: "savedAuth",
        ok: false,
        message: "Saved auth state is no longer valid (401). Re-run UI mode headed=true and sign in again.",
      };
    }

    return {
      key: "savedAuth",
      ok: false,
      message: `Saved auth check returned HTTP ${status}.`,
    };
  } catch (error) {
    return {
      key: "savedAuth",
      ok: false,
      message: `Saved auth check failed: ${error.message || String(error)}`,
    };
  }
}

function parseManualChatRequest(requestText, fallbackChatUrl = DEFAULT_CHAT_URL) {
  if (!requestText.trim()) {
    throw new Error("The copied request is empty.");
  }

  const input = requestText.trim();
  if (input.startsWith("fetch(")) {
    return parseFetchChatRequest(input);
  }
  if (input.startsWith("{")) {
    return parseRawJsonChatBody(input, fallbackChatUrl);
  }

  return parsePowerShellChatRequest(input);
}

function parsePowerShellChatRequest(requestText) {
  const uriMatch = requestText.match(/-Uri\s+["']([^"']+)["']/i);
  if (!uriMatch) {
    throw new Error("Could not find a quoted -Uri value in the PowerShell request.");
  }

  const url = uriMatch[1];
  validateChatStreamUrl(url);

  const bodyMatch = requestText.match(/-Body\s+"((?:`.|[^"])*)"/is);
  if (!bodyMatch) {
    throw new Error("Could not find a double-quoted -Body value in the PowerShell request.");
  }

  const bodyText = bodyMatch[1]
    .replace(/`"/g, '"')
    .replace(/``/g, "`")
    .replace(/`r/g, "\r")
    .replace(/`n/g, "\n")
    .replace(/`t/g, "\t");

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new Error("The copied -Body value is not valid JSON after PowerShell escaping is removed.");
  }

  return buildCapturedTemplateEvent(url, payload);
}

function parseFetchChatRequest(fetchText) {
  const match = fetchText.match(/fetch\(\s*["']([^"']+)["']\s*,\s*(\{[\s\S]*\})\s*\)\s*;?\s*$/i);
  if (!match) {
    throw new Error("Could not parse fetch(...) format. Paste the full fetch call.");
  }

  const url = String(match[1] || "").trim();
  validateChatStreamUrl(url);

  let options;
  try {
    options = JSON.parse(match[2]);
  } catch {
    throw new Error("The fetch options object is not valid JSON.");
  }

  const method = String(options?.method || "POST").toUpperCase();
  if (method !== "POST") {
    throw new Error(`Expected POST method for chat stream request, received '${method}'.`);
  }

  const rawBody = options?.body;
  if (rawBody == null || rawBody === "") {
    throw new Error("The fetch call does not contain a body.");
  }

  let payload;
  if (typeof rawBody === "string") {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new Error("The fetch body string is not valid JSON.");
    }
  } else if (typeof rawBody === "object") {
    payload = rawBody;
  } else {
    throw new Error("The fetch body must be JSON text or an object.");
  }

  return buildCapturedTemplateEvent(url, payload);
}

function parseRawJsonChatBody(bodyText, fallbackChatUrl) {
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new Error("Raw JSON input is not valid JSON.");
  }

  const base = safeParseUrl(String(fallbackChatUrl || "")).ok
    ? new URL(String(fallbackChatUrl)).origin
    : new URL(DEFAULT_CHAT_URL).origin;
  const url = `${base}/api/chat/stream`;
  return buildCapturedTemplateEvent(url, payload);
}

function validateChatStreamUrl(url) {
  const parsedUrl = safeParseUrl(url);
  if (!parsedUrl.ok || !String(url).includes("/api/chat/stream")) {
    throw new Error("The request URI must target /api/chat/stream.");
  }
}

function buildCapturedTemplateEvent(url, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Request body JSON must be an object.");
  }

  const sanitizedPayload = sanitizeManualTemplate(payload);
  return {
    ts: new Date().toISOString(),
    kind: "request",
    method: "POST",
    url,
    resourceType: "fetch",
    postData: JSON.stringify(sanitizedPayload),
  };
}

function sanitizeManualTemplate(value) {
  const statefulKeys = new Set([
    "conversation", "conversation_id", "conversationid", "thread", "thread_id", "threadid",
    "session", "session_id", "sessionid", "history", "chat_history", "message_history",
    "past_messages", "messages", "user_messages", "assistant_messages", "context_messages",
    "parent_message_id", "parentmessageid", "message_id", "messageid", "request_id", "requestid",
  ]);

  if (Array.isArray(value)) return value.map((item) => sanitizeManualTemplate(item));
  if (!value || typeof value !== "object") return value;

  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    if (!statefulKeys.has(key.toLowerCase())) {
      sanitized[key] = sanitizeManualTemplate(child);
    }
  }
  return sanitized;
}

async function refreshSimpleChatAuth({ url, statePath, timeoutMs }) {
  let browser;
  let context;
  try {
    browser = await chromium.launch({ headless: false });
    // Always start with a clean context so the user can complete login manually.
    context = await browser.newContext();
    const page = await context.newPage();

    const parsedUrl = new URL(url);
    const baseURL = parsedUrl.origin;
    const postLoginPath = `${parsedUrl.pathname || "/"}${parsedUrl.search || ""}`;
    const directLoginUrl = `${baseURL}/.auth/login/aad?post_login_redirect_url=${encodeURIComponent(postLoginPath)}`;

    // Prefer direct auth challenge to keep the first page stable for manual sign-in.
    const directLoginResponse = await page.goto(directLoginUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
    if (!directLoginResponse || directLoginResponse.status() >= 400) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    }

    const startedAt = Date.now();
    const minManualOpenMs = 15_000;
    const targetPathname = (parsedUrl.pathname || "/").toLowerCase();
    let lastStatus = 0;

    // Wait for user to complete login in the opened browser, then persist refreshed state.
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const authRes = await context.request.get(`${baseURL}/api/user/settings`, {
          timeout: 8000,
          failOnStatusCode: false,
        });
        lastStatus = authRes.status();
        const elapsedMs = Date.now() - startedAt;
        let onChatPage = false;
        try {
          const current = new URL(page.url());
          onChatPage = current.origin === baseURL && current.pathname.toLowerCase().startsWith(targetPathname);
        } catch {
          onChatPage = false;
        }

        if (lastStatus === 200 && elapsedMs >= minManualOpenMs && onChatPage) {
          let modelInfo = { modelName: "", modelId: "" };
          try {
            modelInfo = await fetchModelContextFromUiApis(context, baseURL);
            writeModelContext(modelInfo);
          } catch {
            // Do not fail auth refresh if model context capture fails.
          }

          await context.storageState({ path: statePath });
          const modelDetailLines = [];
          if (modelInfo.modelName) modelDetailLines.push(`Model name: ${modelInfo.modelName}`);
          if (modelInfo.modelId) modelDetailLines.push(`Model id: ${modelInfo.modelId}`);
          return {
            ok: true,
            message: "Login refresh complete. Saved auth state is valid. Close the browser window manually when finished.",
            details: `Saved state: ${toWorkspaceRelativePath(statePath)}\nAuth check status: 200${modelDetailLines.length ? `\n${modelDetailLines.join("\n")}` : ""}`,
          };
        }
      } catch {
        // Keep waiting while user signs in.
      }

      await page.waitForTimeout(1500);
    }

    await browser.close();
    return {
      ok: false,
      error: `Timed out waiting for manual login completion. Last auth status: ${lastStatus || "unavailable"}.`,
    };
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => {});
    }
    return {
      ok: false,
      error: `Refresh auth failed: ${error.message || String(error)}`,
    };
  }
}

function readModelContext() {
  try {
    if (!fs.existsSync(modelContextPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(modelContextPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeModelContext(modelContext) {
  const safe = {
    modelName: String(modelContext?.modelName || "").trim(),
    modelId: String(modelContext?.modelId || "").trim(),
    source: String(modelContext?.source || "").trim(),
    capturedAtUtc: new Date().toISOString(),
  };
  fs.writeFileSync(modelContextPath, JSON.stringify(safe, null, 2), "utf8");
}

function isGuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function normalizePreferredModelId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.includes(":")) return raw;
  const parts = raw.split(":");
  return parts[parts.length - 1] || raw;
}

function pickFirstModelNameCandidates(value, maxDepth = 6) {
  const out = [];
  const visited = new Set();
  const allow = /\b(gpt|claude|phi|llama|mistral|gemini|o1|o3|o4)\b/i;

  function push(v) {
    const s = String(v || "").trim();
    if (!s || isGuidLike(s)) return;
    if (!allow.test(s)) return;
    if (!out.includes(s)) out.push(s);
  }

  function walk(node, depth) {
    if (node == null || depth > maxDepth) return;
    if (typeof node === "string") {
      push(node);
      return;
    }
    if (typeof node !== "object") return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && /model|deployment/i.test(k)) {
        push(v);
      }
      walk(v, depth + 1);
    }
  }

  walk(value, 0);
  return out;
}

function extractModelTagFromConversations(payload) {
  const conversations = Array.isArray(payload?.conversations) ? payload.conversations : [];
  for (const conv of conversations) {
    const tags = Array.isArray(conv?.tags) ? conv.tags : [];
    for (const tag of tags) {
      if (String(tag?.category || "").toLowerCase() !== "model") continue;
      const value = String(tag?.value || "").trim();
      if (!value || isGuidLike(value)) continue;
      return value;
    }
  }
  return "";
}

async function fetchModelContextFromUiApis(context, baseURL) {
  const empty = { modelName: "", modelId: "", source: "" };

  try {
    const settingsRes = await context.request.get(`${baseURL}/api/user/settings`, {
      timeout: 8000,
      failOnStatusCode: false,
    });
    if (settingsRes.ok()) {
      const settings = await settingsRes.json().catch(() => null);
      const preferredRaw =
        settings?.settings?.preferredModelId ||
        settings?.preferredModelId ||
        settings?.settings?.selectedModelId ||
        settings?.selectedModelId ||
        "";
      const preferredModelId = normalizePreferredModelId(preferredRaw);
      const modelNames = pickFirstModelNameCandidates(settings);
      if (modelNames.length || preferredModelId) {
        return {
          modelName: modelNames[0] || "",
          modelId: preferredModelId || "",
          source: "/api/user/settings",
        };
      }
    }
  } catch {
    // Continue with fallback endpoint.
  }

  try {
    const feedRes = await context.request.get(`${baseURL}/api/conversations/feed?page_size=20&include_hidden=false`, {
      timeout: 8000,
      failOnStatusCode: false,
    });
    if (feedRes.ok()) {
      const feed = await feedRes.json().catch(() => null);
      const modelName = extractModelTagFromConversations(feed);
      if (modelName) {
        return {
          modelName,
          modelId: "",
          source: "/api/conversations/feed",
        };
      }
    }
  } catch {
    // Ignore feed lookup failures.
  }

  return empty;
}
