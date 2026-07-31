# Simple Chat Prompt Runner

This project runs prompt batches from spreadsheet input and exports:

- Excel results (`.xlsx`)
- JSONL results (`.jsonl`)

It now includes two user interfaces:

- Node web wizard (original UI)
- Python Streamlit wizard (feature-parity UI in `python-ui/`)

## 1) Prerequisites

Install required tools:

1. Node.js 18+
2. Python 3.10+

Install project dependencies from repo root:

```bash
npm install
npx playwright install chromium
```

## 2) Input file format

Recommended input columns:

- `query`
- `response`
- `context` (optional)

Notes:

- `response` is treated as the expected/reference answer column.
- If you enable context in JSONL settings, `context` will be emitted in JSONL output.

Templates:

- CSV: [input.template.csv](input.template.csv)
- Excel: [examples/input-template.xlsx](examples/input-template.xlsx)

## 3) Option A: Run the Node Web Wizard

Start wizard server from repo root:

```bash
npm run wizard
```

Open the URL printed in terminal (port auto-fallback is supported).

## 4) Option B: Run the Python UI (feature parity)

The Python UI is in [python-ui/README.md](python-ui/README.md).

Quick start:

1. Start backend first:

```bash
npm run wizard
```

2. In a second terminal (repo root), start Python UI:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r python-ui/requirements.txt
streamlit run python-ui/app.py
```

Windows one-command launcher:

```powershell
./python-ui/start-python-ui.ps1
```

NPM shortcuts from repo root:

```bash
npm run python-ui
```

```bash
npm run python-ui:setup
```

3. In the Python UI sidebar:

- Set backend URL, or click `Auto-detect`.
- Run setup and then run batches.

## 5) Modes

- `simplechat-api`: preferred for normal batch runs
- `ui`: browser automation mode
- `api`: generic HTTP endpoint mode

## 6) Output and metadata

Outputs are written to `outputs/` by default.

Excel exports include:

- `results` sheet with response and per-row status/timing fields
- `run_metadata` sheet with run-level metadata (mode, model, timestamps, duration, and mode-specific details)

## 7) Smoke tests

```bash
npm run smoke
npm run smoke:api
npm run smoke:all
```

## 8) Environment variables

Create `.env` from `.env.example` and set values as needed:

- `CHAT_URL`
- `STATE_FILE`
- `NETWORK_TEMPLATE`
- `API_URL`
- `API_METHOD`
- `API_RESPONSE_PATH`
- `OUTPUT_DIR`

## 9) Open source policy files

- [LICENSE](LICENSE)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
