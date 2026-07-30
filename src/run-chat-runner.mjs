import fs from "node:fs";
import path from "node:path";
import minimist from "minimist";
import xlsx from "xlsx";
import { chromium, request } from "playwright";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_URL = process.env.CHAT_URL || "https://simplechatdemo-fjgpaqe7h6c7akbr.eastus-01.azurewebsites.net/chats";

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const val = String(raw).trim().toLowerCase();
  return val === "1" || val === "true" || val === "yes" || val === "on";
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function getFieldCaseInsensitive(record, candidateNames) {
  if (!record || typeof record !== "object") return undefined;
  const keys = Object.keys(record);
  const normalizedMap = new Map(keys.map((k) => [normalizeName(k), k]));
  for (const candidate of candidateNames) {
    const hit = normalizedMap.get(normalizeName(candidate));
    if (hit) return record[hit];
  }
  return undefined;
}

function resolveJsonlConfig(jsonlOptions) {
  const defaults = {
    profile: "foundry-basic",
    includeGroundTruth: true,
    includeContext: false,
    includeMetadata: false,
    queryKey: "query",
    responseKey: "response",
    groundTruthKey: "ground_truth",
    contextKey: "context",
  };

  const opts = {
    ...defaults,
    ...(jsonlOptions || {}),
  };

  if (opts.profile === "foundry-context") {
    opts.includeGroundTruth = true;
    opts.includeContext = true;
    opts.queryKey = "query";
    opts.responseKey = "response";
    opts.groundTruthKey = "ground_truth";
    opts.contextKey = "context";
  } else if (opts.profile === "foundry-basic") {
    opts.includeGroundTruth = true;
    opts.includeContext = false;
    opts.queryKey = "query";
    opts.responseKey = "response";
    opts.groundTruthKey = "ground_truth";
    opts.contextKey = "context";
  }

  return opts;
}

function findColumnName(headers, requested, fallbacks = []) {
  const normalizedHeaders = new Map(headers.map((h) => [normalizeName(h), h]));
  if (requested) {
    const hit = normalizedHeaders.get(normalizeName(requested));
    if (hit) return hit;
  }
  for (const f of fallbacks) {
    const hit = normalizedHeaders.get(normalizeName(f));
    if (hit) return hit;
  }
  return null;
}

function deepGet(obj, pathExpr) {
  if (!pathExpr) return undefined;
  const parts = pathExpr.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (/^\d+$/.test(p)) {
      cur = cur[Number(p)];
    } else {
      cur = cur[p];
    }
  }
  return cur;
}

function parseSseContent(streamText) {
  const lines = String(streamText || "").split(/\r?\n/);
  const chunks = [];
  const citations = [];
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const obj = JSON.parse(payload);
      // Keep plain token chunks (no explicit type) and explicit assistant content frames only.
      if (typeof obj.content !== "string") continue;
      if (!Object.prototype.hasOwnProperty.call(obj, "type")) {
        chunks.push(obj.content);
        continue;
      }
      if (obj.type === "assistant_content" || obj.type === "output_text" || obj.type === "message_delta") {
        chunks.push(obj.content);
      }

      const detected = extractCitations(obj);
      if (detected.length) {
        citations.push(...detected);
      }
    } catch {
      // Ignore non-JSON or heartbeat frames.
    }
  }
  return {
    text: chunks.join("").trim(),
    citations: dedupeCitations(citations),
  };
}

function extractCitations(value) {
  const candidates = [
    value?.citations,
    value?.context?.citations,
    value?.message?.context?.citations,
    value?.choices?.[0]?.message?.context?.citations,
    value?.references,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) {
      return c.map((entry) => normalizeCitation(entry)).filter(Boolean);
    }
  }

  return [];
}

function normalizeCitation(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    return trimmed ? { text: trimmed } : null;
  }
  if (typeof entry !== "object") return null;

  const out = {};
  for (const key of ["id", "title", "url", "source", "snippet", "text"]) {
    if (entry[key] != null && String(entry[key]).trim() !== "") {
      out[key] = String(entry[key]);
    }
  }
  if (!Object.keys(out).length) return null;
  return out;
}

function dedupeCitations(citations) {
  const seen = new Set();
  const out = [];
  for (const c of citations || []) {
    const key = JSON.stringify(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

const SIMPLECHAT_STATELESS_KEYS = new Set([
  "conversation",
  "conversation_id",
  "conversationid",
  "thread",
  "thread_id",
  "threadid",
  "session",
  "session_id",
  "sessionid",
  "history",
  "chat_history",
  "message_history",
  "past_messages",
  "messages",
  "user_messages",
  "assistant_messages",
  "context_messages",
  "parent_message_id",
  "parentmessageid",
  "message_id",
  "messageid",
  "request_id",
  "requestid",
]);

function sanitizeSimpleChatTemplate(value) {
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeSimpleChatTemplate(v));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    const keyNorm = String(key).toLowerCase();
    if (SIMPLECHAT_STATELESS_KEYS.has(keyNorm)) {
      continue;
    }
    out[key] = sanitizeSimpleChatTemplate(val);
  }
  return out;
}

function loadSimpleChatTemplateFromNetworkLog(networkLogPath) {
  const events = JSON.parse(fs.readFileSync(networkLogPath, "utf8"));
  const req = events.find(
    (e) => e.kind === "request" && e.method === "POST" && typeof e.url === "string" && e.url.includes("/api/chat/stream") && !e.url.includes("client-event")
  );
  if (!req || !req.postData) {
    throw new Error(`Could not find POST /api/chat/stream request in network log: ${networkLogPath}`);
  }
  const template = JSON.parse(req.postData);
  if (!template || typeof template !== "object") {
    throw new Error("Invalid chat payload template in network log.");
  }
  return sanitizeSimpleChatTemplate(template);
}

async function waitForEnter(message) {
  process.stdout.write(`\n${message}\nPress Enter to continue... `);
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadSpreadsheet(inputPath, sheetName) {
  let wb;
  try {
    wb = xlsx.readFile(inputPath, { cellDates: true });
  } catch (err) {
    const message = String(err?.message || err || "Unknown spreadsheet read error");
    const hint = getSpreadsheetReadHint(inputPath, message);
    throw new Error(`${message}${hint ? `\n${hint}` : ""}`);
  }
  const targetSheet = sheetName || wb.SheetNames[0];
  if (!targetSheet || !wb.Sheets[targetSheet]) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[targetSheet], {
    defval: "",
    raw: false,
  });
  return { rows, sheetName: targetSheet };
}

function getSpreadsheetReadHint(inputPath, message) {
  let headerHex = "";
  try {
    const fd = fs.openSync(inputPath, "r");
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    headerHex = [...buf].map((b) => b.toString(16).padStart(2, "0")).join(" ").toUpperCase();
  } catch {
    // Ignore header read failures.
  }

  const lowerMsg = message.toLowerCase();
  const isEncryptedError =
    lowerMsg.includes("ecma-376 encrypted") ||
    lowerMsg.includes("encryptioninfo") ||
    lowerMsg.includes("password") ||
    lowerMsg.includes("encrypted");

  const isOleHeader = headerHex.startsWith("D0 CF 11 E0");

  if (isEncryptedError || isOleHeader) {
    return [
      "Input workbook appears to be encrypted or in legacy Office binary format.",
      `File signature: ${headerHex || "unknown"} (modern .xlsx should start with 50 4B).`,
      "Fix: re-save the file as an unprotected .xlsx, or export as .csv and upload that file.",
      "If using Excel with sensitivity/IRM/password protection, remove protection before saving.",
    ].join("\n");
  }

  return "";
}

function writeOutputs({ results, outputDir, baseName, jsonlOptions, metadata }) {
  ensureDir(outputDir);
  const stamp = nowStamp();
  const outXlsx = path.join(outputDir, `${baseName}-results-${stamp}.xlsx`);
  const outJsonl = path.join(outputDir, `${baseName}-results-${stamp}.jsonl`);

  const opts = resolveJsonlConfig(jsonlOptions);

  const ws = xlsx.utils.json_to_sheet(results);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "results");

  const totalRows = results.length;
  const okRows = results.filter((r) => String(r.status || "") === "ok").length;
  const errorRows = results.filter((r) => String(r.status || "") === "error").length;
  const citationRows = results.filter((r) => {
    try {
      const parsed = JSON.parse(String(r.citations_json || "[]"));
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  }).length;

  const metadataRows = [
    { key: "run_id", value: metadata?.runId || "" },
    { key: "timestamp_utc", value: metadata?.timestamp || new Date().toISOString() },
    { key: "mode", value: metadata?.mode || "" },
    { key: "model", value: metadata?.model || "unknown" },
    { key: "input_file", value: metadata?.inputFile || "" },
    { key: "sheet", value: metadata?.sheetName || "" },
    { key: "total_rows", value: String(totalRows) },
    { key: "ok_rows", value: String(okRows) },
    { key: "error_rows", value: String(errorRows) },
    { key: "rows_with_citations", value: String(citationRows) },
  ];

  const wsMeta = xlsx.utils.json_to_sheet(metadataRows);
  xlsx.utils.book_append_sheet(wb, wsMeta, "run_metadata");
  xlsx.writeFile(wb, outXlsx);

  const lines = results.map((r, idx) =>
    {
      const contextVal = r.context_value ?? getFieldCaseInsensitive(r, ["context", "retrieved_context", "source_context"]);
      const base = {
        [opts.queryKey]: r.query,
        [opts.responseKey]: r.model_response,
        [opts.groundTruthKey]: "",
      };

      if (opts.includeGroundTruth) {
        base[opts.groundTruthKey] = r.response;
      }

      // Emit optional context only when present and non-empty.
      if (opts.includeContext && contextVal !== undefined && String(contextVal).trim() !== "") {
        base[opts.contextKey] = String(contextVal);
      }

      if (opts.includeMetadata) {
        base.meta = {
          id: idx + 1,
          status: r.status,
          error: r.error,
          captured_at_utc: r.captured_at_utc,
        };
      }

      try {
        const citations = JSON.parse(String(r.citations_json || "[]"));
        if (Array.isArray(citations) && citations.length) {
          base.citations = citations;
        }
      } catch {
        // Ignore malformed citation payloads.
      }

      return JSON.stringify(base);
    }
  );
  fs.writeFileSync(outJsonl, lines.join("\n"), "utf8");

  return { outXlsx, outJsonl, summary: { totalRows, okRows, errorRows, citationRows } };
}

function validateRowsStrict({ rows, queryColumn, referenceColumn, contextColumn, jsonlConfig }) {
  const errors = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const query = String(row[queryColumn] ?? "").trim();
    if (!query) {
      errors.push(`Row ${i + 1}: '${queryColumn}' is required and was empty.`);
    }

    if (jsonlConfig.includeGroundTruth) {
      const refVal = String(row[referenceColumn] ?? "").trim();
      if (!refVal) {
        errors.push(`Row ${i + 1}: '${referenceColumn}' is required when ground truth is enabled.`);
      }
    }

    if (jsonlConfig.includeContext && contextColumn) {
      const ctxVal = String(row[contextColumn] ?? "").trim();
      if (!ctxVal) {
        errors.push(`Row ${i + 1}: '${contextColumn}' is required when context output is enabled.`);
      }
    }
  }

  if (errors.length) {
    throw new Error(`Strict schema validation failed:\n${errors.slice(0, 20).join("\n")}${errors.length > 20 ? "\n..." : ""}`);
  }
}

function loadSelectors(selectorsPath) {
  const defaults = {
    startChat: [
      "button:has-text('Start chatting')",
      "button:has-text('Start Chatting')",
      "button:has-text('Start chat')",
    ],
    newChat: [
      "button:has-text('New chat')",
      "button:has-text('New Chat')",
      "[data-testid*='new-chat']",
    ],
    input: [
      "textarea",
      "[contenteditable='true'][role='textbox']",
      "input[type='text']",
    ],
    send: [
      "button[aria-label*='Send' i]",
      "button:has-text('Send')",
      "[data-testid*='send']",
    ],
    assistantMessages: [
      "[data-role='assistant']",
      "[data-testid*='assistant']",
      ".assistant-message",
      ".message.assistant",
    ],
    typingIndicators: ["[data-testid*='typing']", ".typing-indicator", ".loading"],
  };

  if (!selectorsPath) return defaults;
  const txt = fs.readFileSync(selectorsPath, "utf8");
  const custom = JSON.parse(txt);
  return {
    ...defaults,
    ...custom,
  };
}

async function clickStartChatIfPresent(page, selectors) {
  const startCandidates = selectors.startChat || [];
  if (!startCandidates.length) return false;
  return safeClick(page, startCandidates);
}

async function findFirstVisibleLocator(page, candidates, timeoutMs = 1500) {
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: "visible", timeout: timeoutMs });
      return { locator: loc, selector: sel };
    } catch {
      // Try next selector.
    }
  }
  return null;
}

async function safeClick(page, candidates) {
  const hit = await findFirstVisibleLocator(page, candidates, 750);
  if (!hit) return false;
  try {
    await hit.locator.click({ timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

async function setPromptInInput(page, inputLocator, text) {
  try {
    await inputLocator.fill("");
  } catch {
    // Some contenteditable nodes do not support clear this way.
  }

  await inputLocator.click();

  try {
    await inputLocator.fill(text);
  } catch {
    // Fallback for custom input widgets.
    await page.keyboard.press("Control+a");
    await page.keyboard.type(text, { delay: 2 });
  }
}

async function getAssistantCount(page, selectors) {
  for (const sel of selectors.assistantMessages) {
    const count = await page.locator(sel).count();
    if (count > 0) return { selector: sel, count };
  }
  return { selector: selectors.assistantMessages[0], count: 0 };
}

function cleanAssistantText(raw) {
  const text = String(raw || "").replace(/\r/g, "").trim();
  if (!text) return "";

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => l !== "..." && l !== "....");

  if (!lines.length) return "";

  // Drop the leading AI/model line if present.
  if (/^ai\b/i.test(lines[0])) {
    lines.shift();
  }

  // Remove trailing toolbar/icon lines that are not actual content.
  while (lines.length && /^[.\s\u2022\-_=+*<>|/\\]+$/.test(lines[lines.length - 1])) {
    lines.pop();
  }

  return lines.join("\n").trim();
}

async function getAssistantFallbackSnapshot(page) {
  const snapshot = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("div,article,section"));
    const candidates = [];

    for (const node of nodes) {
      const txt = (node.innerText || "").trim();
      if (!txt) continue;
      if (!/\bAI\b/i.test(txt)) continue;

      const rect = node.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      if (area < 1000) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight + 200) continue;

      candidates.push({
        text: txt,
        top: rect.top,
        left: rect.left,
        area,
      });
    }

    candidates.sort((a, b) => {
      if (a.top !== b.top) return b.top - a.top;
      return b.area - a.area;
    });

    return {
      count: candidates.length,
      latestText: candidates.length ? candidates[0].text : "",
    };
  });

  return {
    count: Number(snapshot?.count || 0),
    latestText: cleanAssistantText(snapshot?.latestText || ""),
  };
}

async function waitForAssistantReply(page, selectors, priorCount, priorFallback, timeoutMs) {
  const start = Date.now();
  const selector = priorCount.selector;

  while (Date.now() - start < timeoutMs) {
    const current = await page.locator(selector).count();
    const typingVisible = await (async () => {
      for (const t of selectors.typingIndicators || []) {
        if (await page.locator(t).first().isVisible().catch(() => false)) {
          return true;
        }
      }
      return false;
    })();

    if (current > priorCount.count && !typingVisible) {
      const text = await page.locator(selector).nth(current - 1).innerText();
      if (text && text.trim()) return text.trim();
    }

    // Fallback: parse visible assistant cards that begin with "AI".
    const fallback = await getAssistantFallbackSnapshot(page);
    if (fallback.count > priorFallback.count && fallback.latestText) {
      return fallback.latestText;
    }
    if (fallback.latestText && fallback.latestText !== priorFallback.latestText) {
      return fallback.latestText;
    }

    await page.waitForTimeout(500);
  }

  const count = await page.locator(selector).count();
  if (count > 0) {
    const fallback = await page.locator(selector).nth(count - 1).innerText();
    return (fallback || "").trim();
  }
  throw new Error("Timed out waiting for assistant response.");
}

async function runUiMode({
  url,
  rows,
  queryColumn,
  referenceColumn,
  outputDir,
  baseName,
  selectors,
  stateFile,
  headed,
  timeoutMs,
  waitMs,
  perPromptNewChat,
  debugNetwork,
  networkLogPath,
  jsonlOptions,
  contextColumn,
  baseMetadata,
}) {
  const browser = await chromium.launch({ headless: !headed });
  ensureDir(path.dirname(stateFile));

  const context = await browser.newContext({
    storageState: fs.existsSync(stateFile) ? stateFile : undefined,
  });

  const page = await context.newPage();
  const networkEvents = [];

  if (debugNetwork) {
    page.on("request", (req) => {
      const rt = req.resourceType();
      if (rt !== "xhr" && rt !== "fetch") return;
      networkEvents.push({
        ts: new Date().toISOString(),
        kind: "request",
        method: req.method(),
        url: req.url(),
        resourceType: rt,
        postData: req.postData() || "",
      });
    });

    page.on("response", async (res) => {
      const req = res.request();
      const rt = req.resourceType();
      if (rt !== "xhr" && rt !== "fetch") return;

      let bodyPreview = "";
      try {
        const ct = (res.headers()["content-type"] || "").toLowerCase();
        if (ct.includes("application/json") || ct.includes("text/")) {
          bodyPreview = (await res.text()).slice(0, 4000);
        }
      } catch {
        // Ignore bodies that cannot be read.
      }

      networkEvents.push({
        ts: new Date().toISOString(),
        kind: "response",
        method: req.method(),
        url: res.url(),
        status: res.status(),
        ok: res.ok(),
        resourceType: rt,
        bodyPreview,
      });
    });
  }

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

  const onLoginPage = page.url().includes("login.microsoftonline.com");
  if (onLoginPage || !fs.existsSync(stateFile)) {
    if (!headed) {
      throw new Error("Login is required. Re-run with --headed true for first-time auth.");
    }
    console.log("Manual sign-in required in browser window.");
    await waitForEnter("Complete sign-in and navigate to the chats page.");
    await context.storageState({ path: stateFile });
    console.log(`Saved auth state to ${stateFile}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  }

  await clickStartChatIfPresent(page, selectors);
  await page.waitForTimeout(500);

  const results = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const query = String(row[queryColumn] ?? "").trim();
    const reference = String(row[referenceColumn] ?? "").trim();
    const contextValue = contextColumn ? String(row[contextColumn] ?? "").trim() : "";

    if (!query) {
      results.push({
        ...row,
        query,
        response: reference,
        context_value: contextValue,
        model_response: "",
        citations_json: "[]",
        status: "skipped",
        error: `Missing query in column '${queryColumn}'`,
        row_data: JSON.stringify(row),
        captured_at_utc: new Date().toISOString(),
      });
      continue;
    }

    try {
      await clickStartChatIfPresent(page, selectors);
      if (perPromptNewChat) {
        await safeClick(page, selectors.newChat);
        await page.waitForTimeout(300);
      }

      const inputHit = await findFirstVisibleLocator(page, selectors.input, 4000);
      if (!inputHit) {
        throw new Error(`Could not find chat input. Checked selectors: ${selectors.input.join(" | ")}`);
      }

      const prior = await getAssistantCount(page, selectors);
      const priorFallback = await getAssistantFallbackSnapshot(page);
      await setPromptInInput(page, inputHit.locator, query);

      const sentByButton = await safeClick(page, selectors.send);
      if (!sentByButton) {
        await page.keyboard.press("Enter");
      }

      if (waitMs > 0) await page.waitForTimeout(waitMs);

      const responseText = await waitForAssistantReply(page, selectors, prior, priorFallback, timeoutMs);

      results.push({
        ...row,
        query,
        response: reference,
        context_value: contextValue,
        model_response: responseText,
        citations_json: "[]",
        status: "ok",
        error: "",
        row_data: JSON.stringify(row),
        captured_at_utc: new Date().toISOString(),
      });
      console.log(`Row ${i + 1}/${rows.length}: captured response (${responseText.length} chars).`);
    } catch (err) {
      const screenshotPath = path.join(outputDir, `error-row-${i + 1}.png`);
      ensureDir(outputDir);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      results.push({
        ...row,
        query,
        response: reference,
        context_value: contextValue,
        model_response: "",
        citations_json: "[]",
        status: "error",
        error: `${err.message} | screenshot=${screenshotPath}`,
        row_data: JSON.stringify(row),
        captured_at_utc: new Date().toISOString(),
      });
      console.error(`Row ${i + 1}/${rows.length}: error - ${err.message}`);
    }
  }

  await context.storageState({ path: stateFile });
  await browser.close();

  if (debugNetwork) {
    ensureDir(path.dirname(networkLogPath));
    fs.writeFileSync(networkLogPath, JSON.stringify(networkEvents, null, 2), "utf8");
    console.log(`Network log: ${networkLogPath}`);
  }

  return writeOutputs({ results, outputDir, baseName, jsonlOptions, metadata: baseMetadata });
}

async function runApiMode({
  rows,
  queryColumn,
  referenceColumn,
  outputDir,
  baseName,
  apiUrl,
  apiMethod,
  apiHeaders,
  apiBodyTemplate,
  apiResponsePath,
  jsonlOptions,
  contextColumn,
  baseMetadata,
}) {
  if (!apiUrl) {
    throw new Error("--api-url is required in api mode.");
  }

  const results = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const query = String(row[queryColumn] ?? "").trim();
    const reference = String(row[referenceColumn] ?? "").trim();
    const contextValue = contextColumn ? String(row[contextColumn] ?? "").trim() : "";

    if (!query) {
      results.push({
        ...row,
        query,
        response: reference,
        context_value: contextValue,
        model_response: "",
        citations_json: "[]",
        status: "skipped",
        error: `Missing query in column '${queryColumn}'`,
        row_data: JSON.stringify(row),
        captured_at_utc: new Date().toISOString(),
      });
      continue;
    }

    try {
      const requestBody = apiBodyTemplate
        ? JSON.parse(apiBodyTemplate.replace(/\{\{\s*query\s*\}\}/g, query))
        : { messages: [{ role: "user", content: query }] };

      const res = await fetch(apiUrl, {
        method: apiMethod,
        headers: {
          "content-type": "application/json",
          ...apiHeaders,
        },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
      }

      const responseVal = deepGet(data, apiResponsePath || "choices.0.message.content");
      const responseText = typeof responseVal === "string" ? responseVal : JSON.stringify(responseVal ?? data);
      const citations = extractCitations(data);

      results.push({
        ...row,
        query,
        response: reference,
        context_value: contextValue,
        model_response: responseText,
        citations_json: JSON.stringify(citations),
        status: "ok",
        error: "",
        row_data: JSON.stringify(row),
        captured_at_utc: new Date().toISOString(),
      });

      console.log(`Row ${i + 1}/${rows.length}: captured API response (${responseText.length} chars).`);
    } catch (err) {
      results.push({
        ...row,
        query,
        response: reference,
        context_value: contextValue,
        model_response: "",
        citations_json: "[]",
        status: "error",
        error: err.message,
        row_data: JSON.stringify(row),
        captured_at_utc: new Date().toISOString(),
      });
      console.error(`Row ${i + 1}/${rows.length}: error - ${err.message}`);
    }
  }

  return writeOutputs({ results, outputDir, baseName, jsonlOptions, metadata: baseMetadata });
}

async function runSimpleChatApiMode({
  url,
  rows,
  queryColumn,
  referenceColumn,
  outputDir,
  baseName,
  stateFile,
  networkTemplatePath,
  jsonlOptions,
  contextColumn,
  baseMetadata,
}) {
  if (!fs.existsSync(stateFile)) {
    throw new Error(`State file not found: ${stateFile}. Run UI mode once to sign in.`);
  }
  if (!fs.existsSync(networkTemplatePath)) {
    throw new Error(`Network template log not found: ${networkTemplatePath}. Run UI mode with --debug-network true once.`);
  }

  const apiBase = new URL(url).origin;
  const templatePayload = loadSimpleChatTemplateFromNetworkLog(networkTemplatePath);

  const reqCtx = await request.newContext({
    baseURL: apiBase,
    storageState: stateFile,
    extraHTTPHeaders: {
      accept: "application/json, text/event-stream, */*",
      "content-type": "application/json",
    },
  });

  const results = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const query = String(row[queryColumn] ?? "").trim();
    const reference = String(row[referenceColumn] ?? "").trim();
    const contextValue = contextColumn ? String(row[contextColumn] ?? "").trim() : "";

    if (!query) {
      results.push({
        ...row,
        query,
        response: reference,
        context_value: contextValue,
        model_response: "",
        citations_json: "[]",
        status: "skipped",
        error: `Missing query in column '${queryColumn}'`,
        row_data: JSON.stringify(row),
        captured_at_utc: new Date().toISOString(),
      });
      continue;
    }

    try {
      const convRes = await reqCtx.post("/api/create_conversation", { data: {} });
      if (!convRes.ok()) {
        const txt = await convRes.text();
        throw new Error(`create_conversation failed: HTTP ${convRes.status()} ${txt.slice(0, 500)}`);
      }
      const conv = await convRes.json();
      const conversationId = conv?.conversation_id;
      if (!conversationId) {
        throw new Error("create_conversation did not return conversation_id");
      }

      const payload = {
        ...templatePayload,
        message: query,
        conversation_id: conversationId,
      };

      const streamRes = await reqCtx.post("/api/chat/stream", { data: payload });
      if (!streamRes.ok()) {
        const txt = await streamRes.text();
        throw new Error(`chat/stream failed: HTTP ${streamRes.status()} ${txt.slice(0, 500)}`);
      }

      const sseText = await streamRes.text();
      const parsed = parseSseContent(sseText);
      const responseText = parsed.text;
      if (!responseText) {
        throw new Error("No assistant content chunks found in SSE response.");
      }

      results.push({
        ...row,
        query,
        response: reference,
        context_value: contextValue,
        model_response: responseText,
        citations_json: JSON.stringify(parsed.citations || []),
        status: "ok",
        error: "",
        row_data: JSON.stringify(row),
        captured_at_utc: new Date().toISOString(),
      });
      console.log(`Row ${i + 1}/${rows.length}: captured SimpleChat API response (${responseText.length} chars).`);
    } catch (err) {
      results.push({
        ...row,
        query,
        response: reference,
        context_value: contextValue,
        model_response: "",
        citations_json: "[]",
        status: "error",
        error: err.message,
        row_data: JSON.stringify(row),
        captured_at_utc: new Date().toISOString(),
      });
      console.error(`Row ${i + 1}/${rows.length}: error - ${err.message}`);
    }
  }

  await reqCtx.dispose();
  return writeOutputs({ results, outputDir, baseName, jsonlOptions, metadata: baseMetadata });
}

async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: [
      "mode",
      "url",
      "input",
      "sheet",
      "query-column",
      "reference-column",
      "context-column",
      "output-dir",
      "selectors",
      "state-file",
      "api-url",
      "api-method",
      "api-headers",
      "api-body-template",
      "api-response-path",
      "timeout-ms",
      "wait-ms",
      "network-log",
      "network-template",
      "jsonl-profile",
      "jsonl-query-key",
      "jsonl-response-key",
      "jsonl-ground-truth-key",
      "jsonl-context-key",
      "run-id",
      "run-timestamp",
      "run-model",
    ],
    boolean: [
      "headed",
      "new-chat",
      "debug-network",
      "include-ground-truth",
      "include-context",
      "include-metadata",
      "strict-schema",
    ],
    default: {
      mode: "ui",
      url: DEFAULT_URL,
      "query-column": "query",
      "reference-column": "response",
      "output-dir": process.env.OUTPUT_DIR || "outputs",
      "state-file": process.env.STATE_FILE || ".auth/storage-state.json",
      headed: envBool("HEADED", true),
      "api-url": process.env.API_URL || "",
      "api-method": process.env.API_METHOD || "POST",
      "api-response-path": process.env.API_RESPONSE_PATH || "choices.0.message.content",
      "timeout-ms": process.env.TIMEOUT_MS || "45000",
      "wait-ms": process.env.WAIT_MS || "500",
      "new-chat": envBool("NEW_CHAT", false),
      "debug-network": envBool("DEBUG_NETWORK", false),
      "network-log": process.env.NETWORK_LOG || "outputs/network-log.json",
      "network-template": process.env.NETWORK_TEMPLATE || "outputs/network-log-ui.json",
      "jsonl-profile": process.env.JSONL_PROFILE || "foundry-basic",
      "jsonl-query-key": process.env.JSONL_QUERY_KEY || "query",
      "jsonl-response-key": process.env.JSONL_RESPONSE_KEY || "response",
      "jsonl-ground-truth-key": process.env.JSONL_GROUND_TRUTH_KEY || "ground_truth",
      "jsonl-context-key": process.env.JSONL_CONTEXT_KEY || "context",
      "include-ground-truth": envBool("INCLUDE_GROUND_TRUTH", true),
      "include-context": envBool("INCLUDE_CONTEXT", false),
      "include-metadata": envBool("INCLUDE_METADATA", false),
      "strict-schema": envBool("STRICT_SCHEMA", false),
      "run-id": "",
      "run-timestamp": "",
      "run-model": "unknown",
    },
  });

  if (!argv.input) {
    throw new Error("Missing required --input path to .xlsx/.csv file.");
  }

  const inputPath = path.resolve(argv.input);
  const outputDir = path.resolve(argv["output-dir"]);
  const selectorsPath = argv.selectors ? path.resolve(argv.selectors) : null;
  const stateFile = path.resolve(argv["state-file"]);
  const timeoutMs = Number(argv["timeout-ms"]);
  const waitMs = Number(argv["wait-ms"]);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const { rows, sheetName } = loadSpreadsheet(inputPath, argv.sheet);
  if (!rows.length) {
    throw new Error(`No data rows found in sheet '${sheetName}'.`);
  }

  const headers = Object.keys(rows[0]);
  const queryColumn = findColumnName(headers, argv["query-column"], ["query", "prompt", "question", "input"]);
  if (!queryColumn) {
    throw new Error(`Could not identify a query column. Found headers: ${headers.join(", ")}`);
  }

  const referenceColumn =
    findColumnName(headers, argv["reference-column"], ["response", "reference", "ground_truth", "expected_answer"]) ||
    argv["reference-column"];
  const contextColumn = findColumnName(headers, argv["context-column"], ["context", "retrieved_context", "source_context"]);

  const baseName = path.parse(inputPath).name;

  console.log(`Mode: ${argv.mode}`);
  console.log(`Input: ${inputPath}`);
  console.log(`Sheet: ${sheetName}`);
  console.log(`Rows: ${rows.length}`);
  console.log(`Query column: ${queryColumn}`);
  console.log(`Reference column: ${referenceColumn}`);

  let outputs;
  const runTimestamp = String(argv["run-timestamp"] || new Date().toISOString());
  const runId = String(argv["run-id"] || nowStamp());
  const baseMetadata = {
    runId,
    timestamp: runTimestamp,
    mode: String(argv.mode || ""),
    model: String(argv["run-model"] || "unknown"),
    inputFile: inputPath,
    sheetName,
  };
  const jsonlOptions = {
    profile: String(argv["jsonl-profile"] || "foundry-basic"),
    includeGroundTruth: Boolean(argv["include-ground-truth"]),
    includeContext: Boolean(argv["include-context"]),
    includeMetadata: Boolean(argv["include-metadata"]),
    queryKey: String(argv["jsonl-query-key"] || "query"),
    responseKey: String(argv["jsonl-response-key"] || "response"),
    groundTruthKey: String(argv["jsonl-ground-truth-key"] || "ground_truth"),
    contextKey: String(argv["jsonl-context-key"] || "context"),
  };
  const strictSchema = Boolean(argv["strict-schema"]);
  const resolvedJsonlConfig = resolveJsonlConfig(jsonlOptions);

  if (strictSchema) {
    if (resolvedJsonlConfig.includeGroundTruth && !referenceColumn) {
      throw new Error("Strict schema enabled: reference/ground truth column could not be resolved.");
    }
    if (resolvedJsonlConfig.includeContext && !contextColumn) {
      throw new Error("Strict schema enabled: context column could not be resolved. Provide --context-column.");
    }

    validateRowsStrict({
      rows,
      queryColumn,
      referenceColumn,
      contextColumn,
      jsonlConfig: resolvedJsonlConfig,
    });
  }

  if (argv.mode === "ui") {
    const selectors = loadSelectors(selectorsPath);
    outputs = await runUiMode({
      url: argv.url,
      rows,
      queryColumn,
      referenceColumn,
      outputDir,
      baseName,
      selectors,
      stateFile,
      headed: Boolean(argv.headed),
      timeoutMs,
      waitMs,
      perPromptNewChat: Boolean(argv["new-chat"]),
      debugNetwork: Boolean(argv["debug-network"]),
      networkLogPath: path.resolve(argv["network-log"]),
      jsonlOptions,
      contextColumn,
      baseMetadata,
    });
  } else if (argv.mode === "api") {
    const parsedHeaders = argv["api-headers"] ? JSON.parse(argv["api-headers"]) : {};
    outputs = await runApiMode({
      rows,
      queryColumn,
      referenceColumn,
      outputDir,
      baseName,
      apiUrl: argv["api-url"],
      apiMethod: argv["api-method"],
      apiHeaders: parsedHeaders,
      apiBodyTemplate: argv["api-body-template"],
      apiResponsePath: argv["api-response-path"],
      jsonlOptions,
      contextColumn,
      baseMetadata,
    });
  } else if (argv.mode === "simplechat-api") {
    outputs = await runSimpleChatApiMode({
      url: argv.url,
      rows,
      queryColumn,
      referenceColumn,
      outputDir,
      baseName,
      stateFile,
      networkTemplatePath: path.resolve(argv["network-template"]),
      jsonlOptions,
      contextColumn,
      baseMetadata,
    });
  } else {
    throw new Error("Invalid --mode. Use 'ui', 'api', or 'simplechat-api'.");
  }

  console.log("\nDone.");
  console.log(`Excel output: ${outputs.outXlsx}`);
  console.log(`JSONL output: ${outputs.outJsonl}`);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exitCode = 1;
});
