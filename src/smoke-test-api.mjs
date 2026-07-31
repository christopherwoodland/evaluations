import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const INPUT = path.join(ROOT, "examples", "input-template.xlsx");
const OUTPUT_DIR = path.join(ROOT, "outputs");
const MOCK_SERVER = path.join(ROOT, "src", "mock-api-server.mjs");
const MOCK_PORT = 17991;

function runCommand(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env, windowsHide: false });
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

function startMockServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, MOCK_API_PORT: String(MOCK_PORT) };
    const child = spawn("node", [MOCK_SERVER], {
      cwd: ROOT,
      env,
      windowsHide: false,
    });

    let ready = false;
    let stderr = "";

    const onStdout = (chunk) => {
      const text = chunk.toString();
      if (!ready && text.includes("MOCK_API_READY")) {
        ready = true;
        resolve(child);
      }
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (!ready) {
        reject(new Error(`Mock API server exited before ready (code ${code}). ${stderr}`));
      }
    });

    setTimeout(() => {
      if (!ready) {
        child.kill();
        reject(new Error(`Timed out waiting for mock API server readiness. ${stderr}`));
      }
    }, 5000);
  });
}

function parseJsonlPath(text) {
  const m = String(text).match(/JSONL output:\s*(.+)/i);
  return m?.[1] ? m[1].trim() : "";
}

function validateJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`JSONL output not found: ${filePath}`);
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (!lines.length) {
    throw new Error("JSONL output was empty.");
  }

  const required = ["query", "response", "ground_truth"];

  for (let i = 0; i < lines.length; i += 1) {
    let obj;
    try {
      obj = JSON.parse(lines[i]);
    } catch {
      throw new Error(`Invalid JSON at line ${i + 1}`);
    }

    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) {
        throw new Error(`Missing key '${key}' at line ${i + 1}`);
      }
    }

    if (!String(obj.response || "").startsWith("MOCK_REPLY:")) {
      throw new Error(`Unexpected response content at line ${i + 1}`);
    }
  }

  return lines.length;
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    throw new Error(`Missing sample input: ${INPUT}`);
  }
  if (!fs.existsSync(MOCK_SERVER)) {
    throw new Error(`Missing mock API server script: ${MOCK_SERVER}`);
  }

  const mock = await startMockServer();
  try {
    const args = [
      "src/run-chat-runner.mjs",
      "--mode",
      "api",
      "--input",
      INPUT,
      "--output-dir",
      OUTPUT_DIR,
      "--api-url",
      `http://127.0.0.1:${MOCK_PORT}/chat`,
      "--api-method",
      "POST",
      "--api-body-template",
      '{"messages":[{"role":"user","content":"{{query}}"}]}',
      "--api-response-path",
      "choices.0.message.content",
      "--jsonl-profile",
      "foundry-basic",
    ];

    const run = await runCommand("node", args, ROOT);
    const full = `${run.stdout}\n${run.stderr}`;

    if (run.code !== 0) {
      throw new Error(`API smoke run failed (exit ${run.code}).\n${full}`);
    }

    const jsonlPath = parseJsonlPath(full);
    if (!jsonlPath) {
      throw new Error(`Could not parse JSONL output path from runner output.\n${full}`);
    }

    const rowCount = validateJsonl(jsonlPath);
    console.log(`API smoke test passed. Validated ${rowCount} JSONL line(s): ${jsonlPath}`);
  } finally {
    mock.kill();
  }
}

main().catch((err) => {
  console.error(`API smoke test failed: ${err.message}`);
  process.exitCode = 1;
});
