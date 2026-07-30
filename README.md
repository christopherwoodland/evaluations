# Simple Chat Prompt Runner

This app reads prompts from a spreadsheet, runs each prompt through Simple Chat (UI automation or API), and exports:

- Excel results (.xlsx)
- JSONL results (.jsonl)

## Setup

```bash
npm install
npx playwright install chromium
```

## Start Wizard

```bash
npm run wizard
```

Open the URL printed by the server (default: http://127.0.0.1:5088).

## Input Columns

Recommended columns:

- query
- response

`response` is treated as the expected/reference answer column.
Use `response` as the answer column name.

## Modes

- simplechat-api: preferred for batch runs
- ui: browser automation mode
- api: generic HTTP endpoint mode

## Templates

- CSV template: [input.template.csv](input.template.csv)
- Excel template: [examples/input-template.xlsx](examples/input-template.xlsx)

Both templates use `response` as the answer column.

## Smoke Tests

```bash
npm run smoke
npm run smoke:api
npm run smoke:all
```

## Environment

Create `.env` from `.env.example` and set values as needed:

- CHAT_URL
- STATE_FILE
- NETWORK_TEMPLATE
- API_URL
- API_METHOD
- API_RESPONSE_PATH
- OUTPUT_DIR

## Open Source Policy Files

- LICENSE
- CODE_OF_CONDUCT.md
- CONTRIBUTING.md
- SECURITY.md
