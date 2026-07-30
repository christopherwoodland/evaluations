import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import xlsx from "xlsx";
import dotenv from "dotenv";
import { request } from "playwright";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 5088);
const HOST = process.env.HOST || "127.0.0.1";
const DEFAULT_CHAT_URL = process.env.CHAT_URL || "https://simplechatdemo-fjgpaqe7h6c7akbr.eastus-01.azurewebsites.net/chats";
const DEFAULT_STATE_FILE = process.env.STATE_FILE || ".auth/storage-state.json";
const DEFAULT_NETWORK_TEMPLATE = process.env.NETWORK_TEMPLATE || "outputs/network-log-ui-full.json";
const DEFAULT_SELECTORS = process.env.SELECTORS_PATH || "selectors.example.json";
const DEFAULT_OUTPUT_DIR = process.env.OUTPUT_DIR || "outputs";
const DEFAULT_FOUNDRY_EXPORT_DIR = process.env.FOUNDRY_EXPORT_DIR || "foundry_exports";
const DEFAULT_MASK_LOGS = String(process.env.MASK_LOGS ?? "true").toLowerCase() !== "false";

const app = express();

const uploadsDir = path.join(ROOT, "uploads");
const outputsDir = path.join(ROOT, "outputs");
const authDir = path.join(ROOT, ".auth");
const examplesDir = path.join(ROOT, "examples");
const historyPath = path.join(outputsDir, "run-history.json");
const lastRunPayloadPath = path.join(outputsDir, "last-run-payload.json");

for (const dir of [uploadsDir, outputsDir, authDir, examplesDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureExampleTemplate();

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
  res.json({ ok: true, service: "wizard", cwd: ROOT });
});

app.get("/api/files/defaults", (_, res) => {
  res.json({
    defaultStateFile: DEFAULT_STATE_FILE,
    defaultNetworkTemplate: DEFAULT_NETWORK_TEMPLATE,
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
  });
});

app.post("/api/precheck", async (req, res) => {
  try {
    const body = req.body || {};
    const mode = String(body.mode || "simplechat-api");
    const url = String(body.url || DEFAULT_CHAT_URL);
    const stateFile = String(body.stateFile || DEFAULT_STATE_FILE);
    const networkTemplate = String(body.networkTemplate || DEFAULT_NETWORK_TEMPLATE);
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
    return res.status(500).json({ ok: false, error: error.message || String(error) });
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

function buildRunContext({ mode, url, networkTemplatePath, apiUrl, apiMethod, apiHeadersRaw, apiBodyTemplateRaw }) {
  if (mode === "simplechat-api") {
    return buildSimpleChatRunContext(url, networkTemplatePath);
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

function buildSimpleChatRunContext(url, networkTemplatePath) {
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
        exampleRequest: { note: "No /api/chat/stream request found in network template." },
      };
    }

    const templateBody = JSON.parse(req.postData);
    const model = detectModelFromBody(templateBody);
    const body = {
      ...templateBody,
      message: "<query>",
      conversation_id: "<created-per-row>",
    };

    return {
      mode: "simplechat-api",
      model,
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
    return {
      mode: "simplechat-api",
      model: "unknown",
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
  add("timeout-ms", body.timeoutMs || process.env.TIMEOUT_MS || "45000");
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
    const netTemplate = files.networkTemplateFile?.[0]?.path || body.networkTemplate || DEFAULT_NETWORK_TEMPLATE;
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
    networkTemplatePath: files.networkTemplateFile?.[0]?.path || body.networkTemplate || DEFAULT_NETWORK_TEMPLATE,
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
