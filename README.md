# Simple Chat Prompt Runner

Batch-run prompts from CSV/XLSX input and export results to:

- Excel (`.xlsx`)
- JSONL (`.jsonl`)

## UI options

This project has two UI frontends, both using the same Node backend and runner:

- Node web wizard (original UI)
- Python Streamlit wizard (feature parity, in [python-ui/README.md](python-ui/README.md))

## Prerequisites

1. Node.js 18+
2. Python 3.10+

From repo root:

```bash
npm install
npx playwright install chromium
```

## Input format

Recommended columns:

- `query`
- `response`
- `context` (optional)

Notes:

- `response` is treated as the expected answer.
- If context inclusion is enabled in JSONL options, `context` is written into JSONL output.

Templates:

- [input.template.csv](input.template.csv)
- [examples/input-template.xlsx](examples/input-template.xlsx)

## Run the Node web wizard

From repo root:

```bash
npm run wizard
```

Then open the URL printed in the terminal. The server supports port fallback when the default port is unavailable.

## Run the Python Streamlit UI

The Python UI is documented in detail at [python-ui/README.md](python-ui/README.md).

Quick start from repo root:

1. Start backend (required):

```bash
npm run wizard
```

2. In a second terminal, create/activate venv and install Python dependencies:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r python-ui/requirements.txt
```

3. Start Streamlit UI:

```bash
streamlit run python-ui/app.py
```

Windows helper script:

```powershell
./python-ui/start-python-ui.ps1
```

NPM shortcuts:

```bash
npm run python-ui
npm run python-ui:setup
```

In the sidebar, set the backend URL or use Auto-detect.

## Run modes

- `simplechat-api`: preferred for normal batch runs
- `ui`: browser automation mode
- `api`: generic HTTP endpoint mode

## Outputs and metadata

Outputs are written to `outputs/` by default.

Excel output includes:

- `results` sheet: row-level results and status/timing
- `run_metadata` sheet: run-level data such as mode, model info, timestamps, duration, and backend/runtime details

JSONL output includes one object per row with response plus optional fields based on run options (for example context/meta/ground_truth).

## Smoke tests

```bash
npm run smoke
npm run smoke:api
npm run smoke:all
```

## Troubleshooting

### Port already in use

If `npm run wizard` fails because a port is already bound:

1. Find the process using the port (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 5088 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess
```

2. If safe, stop that process:

```powershell
Stop-Process -Id <PID> -Force
```

3. Start the wizard again:

```bash
npm run wizard
```

The backend also supports port fallback when the default port is unavailable.

### Python UI cannot connect to backend

In Streamlit:

1. Open the sidebar backend section.
2. Click `Auto-detect backend`.
3. Click `Health check backend`.

If detection picks the wrong instance, manually set the backend URL to the active wizard URL shown by `npm run wizard`.

### Different behavior between UIs

Both UIs use the same backend and runner. If behavior differs, the most common cause is each UI pointing to a different backend instance/port.

Verify both UIs are targeting the same backend URL, then rerun.

### UI mode run fails (`--mode ui`)

Common causes:

- Missing Playwright browser install
- Expired/missing auth state file
- Selectors/network template mismatch for the target chat page

Suggested checks:

```bash
npx playwright install chromium
```

Refresh auth from either UI setup flow, then retry the run.

### Metadata/model fields look incomplete

Model name availability depends on what the backend endpoints expose at runtime.

If the friendly name is unavailable, outputs can still include model identifiers/source/confidence metadata. This is expected and indicates fallback resolution was used.

## Environment variables

Create `.env` from `.env.example` and set values as needed:

- `CHAT_URL`
- `STATE_FILE`
- `NETWORK_TEMPLATE`
- `API_URL`
- `API_METHOD`
- `API_RESPONSE_PATH`
- `OUTPUT_DIR`

## Open source policy files

- [LICENSE](LICENSE)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
