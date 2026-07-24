# Contributing

## Development setup

1. Install dependencies:
   - `npm install`
2. Install Playwright browser runtime:
   - `npx playwright install chromium`
3. Start the wizard:
   - `npm run wizard`

## Coding guidelines

- Prefer small, focused changes.
- Keep public behavior backward compatible unless intentionally changed.
- Add or update docs when behavior changes.
- Validate with smoke tests before submitting.

## Pull request checklist

- [ ] Code compiles/runs locally
- [ ] New and changed behavior documented
- [ ] No secrets committed
- [ ] Smoke test results included in PR notes

## Style and quality

- Use clear naming and avoid dead code.
- Keep UI text concise and actionable.
- Preserve existing file formatting style.
