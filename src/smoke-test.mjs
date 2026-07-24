import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const INPUT = path.join(ROOT, "examples", "input-template.xlsx");
const OUTPUT_DIR = path.join(ROOT, "outputs");
const STATE_FILE = path.join(ROOT, ".auth", "storage-state.json");
const NETWORK_TEMPLATE = path.join(ROOT, "outputs", "network-log-ui-full.json");

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
  }

  return lines.length;
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    throw new Error(`Missing sample input: ${INPUT}`);
  }
  if (!fs.existsSync(STATE_FILE)) {
    throw new Error(`Missing state file: ${STATE_FILE}`);
  }
  if (!fs.existsSync(NETWORK_TEMPLATE)) {
    throw new Error(`Missing network template: ${NETWORK_TEMPLATE}`);
  }

  const args = [
    "src/run-chat-eval.mjs",
    "--mode",
    "simplechat-api",
    "--input",
    INPUT,
    "--output-dir",
    OUTPUT_DIR,
    "--state-file",
    STATE_FILE,
    "--network-template",
    NETWORK_TEMPLATE,
    "--jsonl-profile",
    "foundry-basic",
  ];

  const run = await runCommand("node", args, ROOT);
  const full = `${run.stdout}\n${run.stderr}`;
  if (run.code !== 0) {
    throw new Error(`Smoke run failed (exit ${run.code}).\n${full}`);
  }

  const jsonlPath = parseJsonlPath(full);
  if (!jsonlPath) {
    throw new Error(`Could not parse JSONL output path from runner output.\n${full}`);
  }

  const rowCount = validateJsonl(jsonlPath);
  console.log(`Smoke test passed. Validated ${rowCount} JSONL line(s): ${jsonlPath}`);
}

main().catch((err) => {
  console.error(`Smoke test failed: ${err.message}`);
  process.exitCode = 1;
});
