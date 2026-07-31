from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import requests
import streamlit as st


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PORTS = [5088, 5173, 4173, 3000, 59478]
EXPECTED_RUNNER_ENTRYPOINT = "src/run-chat-runner.mjs"


def inject_app_styles() -> None:
    st.markdown(
    """
<style>
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

:root {
    --bg: #0b1117;
    --panel: #121c24;
    --panel-2: #172430;
    --text: #eef4f7;
    --muted: #99adbb;
    --brand: #12b3a8;
    --brand-2: #ff9f43;
    --line: #233342;
    --shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
}

.stApp {
    font-family: 'Space Grotesk', sans-serif;
    background:
        radial-gradient(80vw 80vw at 100% -5%, rgba(255, 159, 67, 0.2), transparent 50%),
        radial-gradient(80vw 80vw at -10% 110%, rgba(18, 179, 168, 0.18), transparent 50%),
        linear-gradient(145deg, #0a1016 0%, #0f1821 45%, #0a121a 100%);
    color: var(--text);
}

.main .block-container {
    max-width: 1120px;
    padding-top: 2rem;
    padding-bottom: 3rem;
}

.hero-wrap {
    margin-bottom: 1rem;
}

.hero-kicker {
    letter-spacing: 0.16em;
    text-transform: uppercase;
    font-size: 0.78rem;
    color: var(--brand);
    font-weight: 700;
    margin: 0;
}

.hero-title {
    margin: 0.2rem 0;
    font-size: 2.2rem;
    line-height: 1.08;
    color: var(--text);
}

.hero-subtitle {
    margin: 0;
    color: var(--muted);
    font-size: 1rem;
}

.steps-wrap {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin: 1rem 0 1.3rem 0;
}

.anchor-target {
    position: relative;
    top: -72px;
    visibility: hidden;
}

.step-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 0.36rem 0.7rem;
    font-size: 0.82rem;
    background: var(--panel);
    color: var(--muted);
    font-weight: 600;
    transition: 260ms ease;
}

.step-link {
    text-decoration: none;
}

.step-link:visited {
    color: inherit;
}

.step-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3rem;
    height: 1.3rem;
    border-radius: 999px;
    background: #0f1820;
    border: 1px solid var(--line);
    color: var(--muted);
    font-size: 0.74rem;
    font-weight: 700;
}

.step-pill.is-active {
    color: var(--text);
    border-color: rgba(18, 179, 168, 0.6);
    background: linear-gradient(135deg, rgba(18, 179, 168, 0.18), rgba(18, 179, 168, 0.02));
}

.step-pill.is-active .step-num {
    color: var(--text);
    border-color: rgba(18, 179, 168, 0.5);
}

.section-label {
    margin-top: 0.3rem;
    margin-bottom: 0.4rem;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text);
}

div[data-testid="stHeadingWithActionElements"] h1,
div[data-testid="stHeadingWithActionElements"] h2,
div[data-testid="stHeadingWithActionElements"] h3,
div[data-testid="stHeadingWithActionElements"] h4,
div[data-testid="stHeadingWithActionElements"] p,
div[data-testid="stMarkdownContainer"] p,
div[data-testid="stMarkdownContainer"] li,
div[data-testid="stText"] {
    color: var(--text);
}

div[data-testid="stMarkdownContainer"] small,
div[data-testid="stCaptionContainer"] {
    color: var(--muted);
}

a {
    color: #5be0d7;
}

a:hover {
    color: #75ebe3;
}

div[data-testid="stCodeBlock"] code,
pre {
    font-family: 'IBM Plex Mono', monospace;
}

div[data-testid="stCodeBlock"] {
    border-radius: 12px;
    border: 1px solid var(--line);
    overflow: hidden;
}

div[data-testid="stCodeBlock"] pre {
    background: #0d1720;
}

div[data-testid="stVerticalBlockBorderWrapper"] {
    border-radius: 16px;
    border: 1px solid var(--line);
    background: linear-gradient(160deg, rgba(18, 28, 36, 0.95), rgba(14, 22, 30, 0.95));
    box-shadow: var(--shadow);
}

div[data-testid="stTextInputRootElement"] input,
div[data-testid="stSelectbox"] [data-baseweb="select"] > div,
div[data-testid="stTextArea"] textarea,
div[data-testid="stNumberInput"] input {
    background: #0c151d;
    border: 1px solid var(--line);
    color: var(--text);
}

div[data-testid="stTextInputRootElement"] input:focus,
div[data-testid="stTextArea"] textarea:focus,
div[data-testid="stNumberInput"] input:focus {
    outline: 2px solid rgba(18, 179, 168, 0.45);
    border-color: var(--brand);
}

div[data-testid="stCheckbox"] label,
div[data-testid="stRadio"] label {
    color: var(--text);
}

div[data-testid="stButton"] > button,
div[data-testid="stFormSubmitButton"] > button,
div[data-testid="stDownloadButton"] > button,
div[data-testid="stLinkButton"] a,
div[data-testid="stLinkButton"] button {
    border-radius: 11px;
    transition: transform 180ms ease, box-shadow 180ms ease;
}

/* Ensure Streamlit form submit buttons (e.g., Create network template) are readable across themes/versions. */
div[data-testid="stFormSubmitButton"] > button,
div.stFormSubmitButton > button,
button[kind="secondaryFormSubmit"],
button[kind="primaryFormSubmit"] {
    color: var(--text) !important;
    background: #1b2835 !important;
    border: 1px solid #355066 !important;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
}

div[data-testid="stFormSubmitButton"] > button:hover,
div.stFormSubmitButton > button:hover,
button[kind="secondaryFormSubmit"]:hover,
button[kind="primaryFormSubmit"]:hover {
    color: var(--text) !important;
    background: #223244 !important;
    border: 1px solid #4b6f8b !important;
}

div[data-testid="stButton"] > button:hover,
div[data-testid="stFormSubmitButton"] > button:hover,
div[data-testid="stDownloadButton"] > button:hover,
div[data-testid="stLinkButton"] a:hover,
div[data-testid="stLinkButton"] button:hover {
    transform: translateY(-1px);
}

div[data-testid="stButton"] > button[kind="primary"],
div[data-testid="stFormSubmitButton"] > button[kind="primary"] {
    color: #001613;
    background: linear-gradient(135deg, var(--brand), #5be0d7);
    box-shadow: 0 8px 24px rgba(18, 179, 168, 0.35);
    border: 0;
}

div[data-testid="stButton"] > button[kind="primary"]:hover,
div[data-testid="stFormSubmitButton"] > button[kind="primary"]:hover {
    color: var(--text);
    background: #10222b;
    border: 1px solid rgba(18, 179, 168, 0.55);
}

div[data-testid="stButton"] > button[kind="secondary"],
div[data-testid="stFormSubmitButton"] > button[kind="secondary"],
div[data-testid="stDownloadButton"] > button[kind="secondary"] {
    color: var(--text);
    background: #1b2835;
    border: 1px solid var(--line);
}

div[data-testid="stButton"] > button[kind="secondary"]:hover,
div[data-testid="stFormSubmitButton"] > button[kind="secondary"]:hover,
div[data-testid="stDownloadButton"] > button[kind="secondary"]:hover {
    color: #001613;
    background: linear-gradient(135deg, var(--brand), #5be0d7);
    border: 1px solid rgba(18, 179, 168, 0.65);
}

div[data-testid="stButton"] > button:disabled,
div[data-testid="stFormSubmitButton"] > button:disabled,
div.stFormSubmitButton > button:disabled,
button[kind="secondaryFormSubmit"]:disabled,
button[kind="primaryFormSubmit"]:disabled,
div[data-testid="stDownloadButton"] > button:disabled {
    color: #d7e3eb !important;
    background: #334554 !important;
    border: 1px solid #4b6275 !important;
    opacity: 1;
    cursor: not-allowed;
    box-shadow: none;
    transform: none;
}

div[data-testid="stLinkButton"] a,
div[data-testid="stLinkButton"] a:visited,
div[data-testid="stLinkButton"] button {
    color: #001613;
    text-decoration: none;
    background: linear-gradient(135deg, var(--brand-2), #ffd37a);
    border-radius: 999px;
    padding: 0.48rem 0.9rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    box-shadow: 0 8px 20px rgba(255, 159, 67, 0.25);
}

div[data-testid="stLinkButton"] a:hover,
div[data-testid="stLinkButton"] button:hover {
    color: var(--text);
    background: #2a1a08;
    border: 1px solid rgba(255, 159, 67, 0.55);
}

div[data-testid="stExpander"] {
    border: 1px solid var(--line);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.16);
}

div[data-testid="stExpander"] details summary {
    background: #1b2835;
    color: var(--text);
    border-radius: 10px;
}

div[data-testid="stExpander"] details summary:hover {
    background: #223244;
    color: #bee4df;
}

div[data-testid="stFileUploader"] section[data-testid="stFileUploaderDropzone"] {
    background: #0d1720 !important;
    border: 1px dashed var(--line) !important;
}

div[data-testid="stFileUploader"] section[data-testid="stFileUploaderDropzone"] * {
    color: var(--muted) !important;
}

div[data-testid="stFileUploader"] section[data-testid="stFileUploaderDropzone"] button,
div[data-testid="stFileUploader"] section[data-testid="stFileUploaderDropzone"] button:hover,
div[data-testid="stFileUploader"] section[data-testid="stFileUploaderDropzone"] button:focus {
    background: #1b2835 !important;
    color: var(--text) !important;
    border: 1px solid var(--line) !important;
    box-shadow: none !important;
}

div[data-testid="stFileUploader"] small,
div[data-testid="stFileUploader"] span,
div[data-testid="stFileUploader"] label {
    color: var(--muted) !important;
}

div[data-testid="stAlert"] {
    border-radius: 12px;
    border: 1px solid var(--line);
}

.artifact-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.7rem;
    margin-top: 0.45rem;
}

.artifact-card {
    border: 1px solid var(--line);
    border-radius: 12px;
    background: linear-gradient(150deg, #152330, #101923);
    padding: 0.6rem 0.7rem;
}

.artifact-label {
    font-size: 0.74rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 0.3rem;
    font-weight: 700;
}

.artifact-link {
    color: #5be0d7;
    text-decoration: none;
    word-break: break-all;
    font-size: 0.88rem;
}

.artifact-link:hover {
    color: #75ebe3;
    text-decoration: underline;
}

@media (max-width: 900px) {
    .artifact-grid {
        grid-template-columns: 1fr;
    }
}
</style>
""",
        unsafe_allow_html=True,
    )


def render_shell_header() -> None:
    st.markdown(
        """
<div class="hero-wrap">
    <p class="hero-kicker">Prompt Flow</p>
    <h1 class="hero-title">Prompt Runner Wizard</h1>
    <p class="hero-subtitle">Upload a spreadsheet, select run mode, execute, and export Excel + JSONL.</p>
</div>
<div class="steps-wrap">
    <a class="step-pill step-link is-active" href="#step-setup"><span class="step-num">0</span>Setup</a>
    <a class="step-pill step-link" href="#step-mode-files"><span class="step-num">1</span>Mode</a>
    <a class="step-pill step-link" href="#step-mode-files"><span class="step-num">2</span>Files</a>
    <a class="step-pill step-link" href="#step-config"><span class="step-num">3</span>Config</a>
    <a class="step-pill step-link" href="#step-run"><span class="step-num">4</span>Run</a>
</div>
""",
        unsafe_allow_html=True,
    )


def mask_sensitive_text(text: str) -> str:
    import re

    masked = text or ""
    masked = re.sub(r"(Authorization\s*[:=]\s*)(?:Bearer\s+)?[^\s\"']+", r"\1[REDACTED]", masked, flags=re.IGNORECASE)
    masked = re.sub(
        r"([?&](?:token|access_token|api_key|apikey|key|sig|signature)=)([^&\s]+)",
        r"\1[REDACTED]",
        masked,
        flags=re.IGNORECASE,
    )
    masked = re.sub(r"(https?://[^\s/?#]+)([^\s]*)", r"\1[REDACTED_PATH]", masked, flags=re.IGNORECASE)
    return masked


def detect_backend_url() -> str | None:
    def is_prompt_runner_backend(url: str) -> bool:
        try:
            health = requests.get(f"{url}/api/health", timeout=1.5)
            if not health.ok:
                return False

            health_ct = (health.headers.get("content-type") or "").lower()
            if "application/json" not in health_ct:
                return False

            health_payload = health.json()
            if not isinstance(health_payload, dict):
                return False
            if health_payload.get("service") != "wizard":
                return False
            if health_payload.get("runnerEntrypoint") != EXPECTED_RUNNER_ENTRYPOINT:
                return False

            defaults = requests.get(f"{url}/api/files/defaults", timeout=1.5)
            content_type = (defaults.headers.get("content-type") or "").lower()
            if not defaults.ok or "application/json" not in content_type:
                return False

            payload = defaults.json()
            capabilities = payload.get("capabilities", []) if isinstance(payload, dict) else []
            return (
                isinstance(payload, dict)
                and payload.get("runnerEntrypoint") == EXPECTED_RUNNER_ENTRYPOINT
                and "manual-network-template-import" in capabilities
            )
        except Exception:  # noqa: BLE001
            return False

    for port in DEFAULT_PORTS:
        url = f"http://127.0.0.1:{port}"
        if is_prompt_runner_backend(url):
            return url
    return None


def parse_outputs_paths(outputs: dict[str, Any], backend_url: str) -> dict[str, str]:
    links: dict[str, str] = {}
    for key in ["excel", "jsonl", "network"]:
        value = outputs.get(key)
        if value:
            links[key] = f"{backend_url}/{str(value).lstrip('/')}"
    return links


def api_get(base_url: str, path: str) -> tuple[bool, Any]:
    try:
        res = requests.get(f"{base_url}{path}", timeout=20)
        content_type = (res.headers.get("content-type") or "").lower()
        if "application/json" in content_type:
            return res.ok, res.json()

        body = (res.text or "").strip()
        if not res.ok:
            return False, {"error": f"HTTP {res.status_code}: {body[:300] or 'empty response'}"}
        return True, {"ok": True, "raw": body}
    except Exception as exc:  # noqa: BLE001
        return False, {"error": str(exc)}


def api_post_json(base_url: str, path: str, payload: dict[str, Any]) -> tuple[bool, Any]:
    try:
        res = requests.post(f"{base_url}{path}", json=payload, timeout=600)
        content_type = (res.headers.get("content-type") or "").lower()
        if "application/json" in content_type:
            return res.ok, res.json()

        body = (res.text or "").strip()
        if not res.ok:
            return False, {"error": f"HTTP {res.status_code}: {body[:300] or 'empty response'}"}
        return False, {"error": f"Endpoint returned non-JSON response: {body[:300] or 'empty response'}"}
    except Exception as exc:  # noqa: BLE001
        return False, {"error": str(exc)}


def api_post_form(
    base_url: str,
    path: str,
    data: dict[str, Any],
    files: dict[str, tuple[str, bytes, str]],
) -> tuple[bool, Any]:
    try:
        res = requests.post(f"{base_url}{path}", data=data, files=files, timeout=3600)
        content_type = (res.headers.get("content-type") or "").lower()
        if "application/json" in content_type:
            return res.ok, res.json()

        body = (res.text or "").strip()
        if not res.ok:
            return False, {"error": f"HTTP {res.status_code}: {body[:300] or 'empty response'}"}
        return False, {"error": f"Endpoint returned non-JSON response: {body[:300] or 'empty response'}"}
    except Exception as exc:  # noqa: BLE001
        return False, {"error": str(exc)}


def init_state() -> None:
    if "backend_url" not in st.session_state:
        st.session_state.backend_url = detect_backend_url() or "http://127.0.0.1:5088"
    if "defaults" not in st.session_state:
        st.session_state.defaults = {}
    if "latest_jsonl" not in st.session_state:
        st.session_state.latest_jsonl = ""
    if "run_result" not in st.session_state:
        st.session_state.run_result = None


def load_defaults(base_url: str) -> dict[str, Any]:
    ok, data = api_get(base_url, "/api/files/defaults")
    if ok and isinstance(data, dict):
        st.session_state.defaults = data
        return data
    return st.session_state.defaults or {}


def render_setup_check(base_url: str, settings: dict[str, Any]) -> None:
    ok, data = api_post_json(
        base_url,
        "/api/precheck",
        {
            "mode": "simplechat-api",
            "url": settings["url"],
            "stateFile": settings["stateFile"],
            "networkTemplate": settings["networkTemplate"],
            "headed": "true",
        },
    )
    if not ok:
        st.error(data.get("error", "Setup check failed."))
        return

    checks = data.get("checks", [])
    lines = [f"[{'OK' if check.get('ok') else 'FAIL'}] {check.get('key')}: {check.get('message')}" for check in checks]
    if data.get("ok"):
        st.success("Setup looks good for SimpleChat API mode.")
    else:
        st.warning("Setup incomplete. Follow the checklist and retry.")
    st.code("\n".join(lines) if lines else "No checks returned.")


def render_setup_step(base_url: str, settings: dict[str, Any]) -> None:
    st.subheader("Step 0: One-time SimpleChat setup")
    st.markdown(
        """
1. Open SimpleChat.
2. Sign in if prompted.
3. Send one manual chat message.
4. Run setup readiness check.
"""
    )

    c1, c2, c3 = st.columns(3)
    with c1:
        st.link_button("Open SimpleChat", settings["url"])
    with c2:
        if st.button("Refresh login session"):
            payload = {
                "url": settings["url"],
                "stateFile": settings["stateFile"],
                "networkTemplate": settings["networkTemplate"],
                "timeoutSec": 300,
            }

            ok, data = api_post_json(base_url, "/api/refresh-auth", payload)

            err_text = str(data.get("error", "")) if isinstance(data, dict) else ""
            if (not ok) and "Cannot POST /api/refresh-auth" in err_text:
                discovered = detect_backend_url()
                if discovered and discovered.rstrip("/") != base_url.rstrip("/"):
                    st.warning(f"Backend mismatch detected. Retrying with {discovered}")
                    ok, data = api_post_json(discovered, "/api/refresh-auth", payload)
                    if ok and data.get("ok"):
                        st.session_state.backend_url = discovered

            if ok and data.get("ok"):
                st.success(data.get("message", "Login refresh complete."))
                if data.get("details"):
                    st.code(data["details"])
            else:
                st.error(data.get("error", "Login refresh failed."))

    with c3:
        if st.button("Check setup readiness"):
            render_setup_check(base_url, settings)

    with st.container(border=True):
        st.markdown("#### Import a copied request manually")
        st.caption("Paste fetch(...), Invoke-WebRequest, or raw JSON body. Only the /api/chat/stream URL and JSON body are saved. Cookies and headers are discarded.")
        with st.form("manual_request_import", clear_on_submit=True):
            request_text = st.text_area(
                "Copied request or JSON body",
                height=220,
                placeholder="Paste fetch(...), Invoke-WebRequest, or raw JSON body",
            )
            import_request = st.form_submit_button(
                "Create network template",
                icon=":material/data_object:",
            )

        if import_request:
            if not request_text.strip():
                st.error("Paste a copied PowerShell request first.")
            else:
                ok, data = api_post_json(
                    base_url,
                    "/api/import-network-template",
                    {
                        "requestText": request_text,
                        "networkTemplate": settings["networkTemplate"],
                        "url": settings["url"],
                    },
                )
                if ok and data.get("ok"):
                    st.success(data.get("message", "Network template created."))
                    render_setup_check(base_url, settings)
                else:
                    st.error(data.get("error", "Could not create the network template."))


def render_mode_and_files(settings: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    st.subheader("Step 1-2: Mode and files")

    show_advanced = st.checkbox("Show advanced modes (UI Playwright, Generic API)", value=False)
    mode_options = ["simplechat-api"] + (["ui", "api"] if show_advanced else [])
    mode = st.radio("Execution mode", mode_options, horizontal=True)

    uploaded_input = st.file_uploader("Input spreadsheet (.xlsx/.csv)", type=["xlsx", "xlsm", "csv", "tsv"], key="inputFile")
    uploaded_network = None
    uploaded_selectors = None
    if mode == "simplechat-api":
        uploaded_network = st.file_uploader("Network template file (optional)", type=["json"], key="networkTemplateFile")
    if mode == "ui":
        uploaded_selectors = st.file_uploader("Selectors file (optional)", type=["json"], key="selectorsFile")

    file_state = {
        "input": uploaded_input,
        "network": uploaded_network,
        "selectors": uploaded_selectors,
    }

    return {"mode": mode}, file_state


def render_config(settings: dict[str, Any], mode: str) -> dict[str, Any]:
    st.subheader("Step 3: Run configuration")

    c1, c2, c3 = st.columns(3)
    with c1:
        query_column = st.text_input("Query column", value="query")
    with c2:
        reference_column = st.text_input("Reference column", value="response")
    with c3:
        context_column = st.text_input("Context column", value="context")

    c4, c5, c6 = st.columns(3)
    with c4:
        url = st.text_input("Chat URL", value=settings["url"])
    with c5:
        state_file = st.text_input("State file", value=settings["stateFile"])
    with c6:
        output_dir = st.text_input("Output directory", value=settings["outputDir"])

    network_template = st.text_input("Network template path", value=settings["networkTemplate"])

    headed = True
    new_chat = True
    debug_network = False
    selectors = settings["selectors"]

    if mode == "ui":
        c7, c8, c9 = st.columns(3)
        with c7:
            headed = st.checkbox("Headed", value=True)
        with c8:
            new_chat = st.checkbox("New chat per row", value=True)
        with c9:
            debug_network = st.checkbox("Capture network log", value=False)
        selectors = st.text_input("Selectors path", value=settings["selectors"])

    timeout_ms = st.number_input("Timeout (ms)", min_value=1000, step=500, value=45000)
    wait_ms = st.number_input("Wait after send (ms)", min_value=0, step=100, value=500)

    st.markdown("### JSONL output options")
    profile = st.selectbox(
        "Export profile",
        ["foundry-basic", "foundry-context", "custom"],
        index=0,
        format_func=lambda x: {
            "foundry-basic": "Foundry Basic (query, response, ground_truth)",
            "foundry-context": "Foundry + Context (query, response, ground_truth, context)",
            "custom": "Custom mapping",
        }[x],
    )

    include_ground_truth = st.checkbox("Include ground_truth", value=True)
    include_context = st.checkbox("Include context", value=(profile == "foundry-context"))
    include_metadata = st.checkbox("Include meta block", value=True)
    strict_schema = st.checkbox("Strict schema mode", value=False)
    mask_logs = st.checkbox("Mask sensitive values in run logs", value=True)

    jsonl_query_key = st.text_input("JSONL key for query", value="query")
    jsonl_response_key = st.text_input("JSONL key for response", value="response")
    jsonl_ground_truth_key = st.text_input("JSONL key for ground truth", value="ground_truth")
    jsonl_context_key = st.text_input("JSONL key for context", value="context")

    st.code(
        json.dumps(
            {
                jsonl_query_key: "Example query",
                jsonl_response_key: "Example model response",
                jsonl_ground_truth_key: "Example reference" if include_ground_truth else "",
                **({jsonl_context_key: "Example context"} if include_context else {}),
                **(
                    {
                        "meta": {
                            "id": 1,
                            "status": "ok",
                            "error": "",
                            "captured_at_utc": "2026-01-01T00:00:00.000Z",
                        }
                    }
                    if include_metadata
                    else {}
                ),
            },
            indent=2,
        ),
        language="json",
    )

    api_url = settings["apiUrl"]
    api_method = settings["apiMethod"]
    api_headers = ""
    api_body_template = ""
    api_response_path = settings["apiResponsePath"]

    if mode == "api":
        st.markdown("### Generic API advanced fields")
        api_url = st.text_input("API URL", value=settings["apiUrl"])
        api_method = st.text_input("API method", value=settings["apiMethod"])
        api_headers = st.text_area("API headers (JSON)", value="", height=90)
        api_body_template = st.text_area(
            "API body template (JSON)",
            value='{"messages":[{"role":"user","content":"{{query}}"}]}',
            height=120,
        )
        api_response_path = st.text_input("Response path", value=settings["apiResponsePath"])

    return {
        "queryColumn": query_column,
        "referenceColumn": reference_column,
        "contextColumn": context_column,
        "url": url,
        "stateFile": state_file,
        "outputDir": output_dir,
        "networkTemplate": network_template,
        "selectors": selectors,
        "headed": "true" if headed else "false",
        "newChat": "true" if new_chat else "false",
        "debugNetwork": "true" if debug_network else "false",
        "timeoutMs": str(timeout_ms),
        "waitMs": str(wait_ms),
        "jsonlProfile": profile,
        "includeGroundTruth": "true" if include_ground_truth else "false",
        "includeContext": "true" if include_context else "false",
        "includeMetadata": "true" if include_metadata else "false",
        "strictSchema": "true" if strict_schema else "false",
        "maskLogs": mask_logs,
        "jsonlQueryKey": jsonl_query_key,
        "jsonlResponseKey": jsonl_response_key,
        "jsonlGroundTruthKey": jsonl_ground_truth_key,
        "jsonlContextKey": jsonl_context_key,
        "apiUrl": api_url,
        "apiMethod": api_method,
        "apiHeaders": api_headers,
        "apiBodyTemplate": api_body_template,
        "apiResponsePath": api_response_path,
    }


def render_precheck(base_url: str, mode: str, cfg: dict[str, Any]) -> None:
    if st.button("Run precheck"):
        ok, data = api_post_json(
            base_url,
            "/api/precheck",
            {
                "mode": mode,
                "url": cfg["url"],
                "stateFile": cfg["stateFile"],
                "networkTemplate": cfg["networkTemplate"],
                "apiUrl": cfg["apiUrl"],
                "headed": cfg["headed"],
            },
        )
        if not ok:
            st.error(data.get("error", "Precheck failed."))
            return
        checks = data.get("checks", [])
        lines = [f"[{'OK' if c.get('ok') else 'FAIL'}] {c.get('key')}: {c.get('message')}" for c in checks]
        if data.get("ok"):
            st.success("Precheck passed.")
        else:
            st.warning("Precheck has failures.")
        st.code("\n".join(lines) if lines else "No checks returned.")


def render_result_blocks(base_url: str) -> None:
    result = st.session_state.run_result
    if not result:
        return

    outputs = result.get("outputs") or {}
    links = parse_outputs_paths(outputs, base_url)

    st.markdown("### Artifacts")
    cards = []
    for key in ["excel", "jsonl", "network"]:
        if key in links:
            cards.append(
                f"""
<div class=\"artifact-card\">
  <div class=\"artifact-label\">{key.upper()}</div>
  <a class=\"artifact-link\" href=\"{links[key]}\" target=\"_blank\" rel=\"noopener\">{links[key]}</a>
</div>
"""
            )
    if cards:
        st.markdown(f"<div class=\"artifact-grid\">{''.join(cards)}</div>", unsafe_allow_html=True)
    else:
        st.caption("No artifacts found for this run.")

    if result.get("runContext"):
        st.markdown("### Run context")
        st.json(result["runContext"])

    if outputs.get("jsonl"):
        st.session_state.latest_jsonl = outputs["jsonl"]


def run_batch(base_url: str, mode: str, cfg: dict[str, Any], file_state: dict[str, Any]) -> None:
    uploaded_input = file_state.get("input")
    if uploaded_input is None:
        st.error("Input spreadsheet is required.")
        return

    data: dict[str, Any] = {
        "mode": mode,
        "queryColumn": cfg["queryColumn"],
        "referenceColumn": cfg["referenceColumn"],
        "contextColumn": cfg["contextColumn"],
        "outputDir": cfg["outputDir"],
        "url": cfg["url"],
        "stateFile": cfg["stateFile"],
        "timeoutMs": cfg["timeoutMs"],
        "waitMs": cfg["waitMs"],
        "includeGroundTruth": cfg["includeGroundTruth"],
        "includeContext": cfg["includeContext"],
        "includeMetadata": cfg["includeMetadata"],
        "strictSchema": cfg["strictSchema"],
        "jsonlProfile": cfg["jsonlProfile"],
        "jsonlQueryKey": cfg["jsonlQueryKey"],
        "jsonlResponseKey": cfg["jsonlResponseKey"],
        "jsonlGroundTruthKey": cfg["jsonlGroundTruthKey"],
        "jsonlContextKey": cfg["jsonlContextKey"],
        "networkTemplate": cfg["networkTemplate"],
        "selectors": cfg["selectors"],
        "headed": cfg["headed"],
        "newChat": cfg["newChat"],
        "debugNetwork": cfg["debugNetwork"],
        "apiUrl": cfg["apiUrl"],
        "apiMethod": cfg["apiMethod"],
        "apiHeaders": cfg["apiHeaders"],
        "apiBodyTemplate": cfg["apiBodyTemplate"],
        "apiResponsePath": cfg["apiResponsePath"],
    }

    files: dict[str, tuple[str, bytes, str]] = {
        "inputFile": (
            uploaded_input.name,
            uploaded_input.getvalue(),
            uploaded_input.type or "application/octet-stream",
        )
    }

    if file_state.get("network") is not None:
        net = file_state["network"]
        files["networkTemplateFile"] = (net.name, net.getvalue(), net.type or "application/json")

    if file_state.get("selectors") is not None:
        sel = file_state["selectors"]
        files["selectorsFile"] = (sel.name, sel.getvalue(), sel.type or "application/json")

    with st.spinner("Running batch..."):
        ok, resp = api_post_form(base_url, "/api/run", data, files)

    output_text = "\n\n".join([v for v in [resp.get("command"), resp.get("stdout"), resp.get("stderr")] if v])
    if cfg["maskLogs"]:
        output_text = mask_sensitive_text(output_text)

    if not ok or not resp.get("ok"):
        st.error(resp.get("error", f"Run failed (exit {resp.get('exitCode', 'n/a')})."))
        if output_text.strip():
            st.code(output_text)
        return

    st.success("Run complete. Artifacts are ready.")
    if output_text.strip():
        with st.expander("Run logs", expanded=False):
            st.code(output_text)
    st.session_state.run_result = resp


def rerun_last_config(base_url: str, mask_logs: bool) -> None:
    with st.spinner("Rerunning last config..."):
        ok, resp = api_post_json(base_url, "/api/rerun", {})

    output_text = "\n\n".join([v for v in [resp.get("command"), resp.get("stdout"), resp.get("stderr")] if v])
    if mask_logs:
        output_text = mask_sensitive_text(output_text)

    if not ok or not resp.get("ok"):
        st.error(resp.get("error", f"Rerun failed (exit {resp.get('exitCode', 'n/a')})."))
        if output_text.strip():
            st.code(output_text)
        return

    st.success("Rerun complete.")
    if output_text.strip():
        with st.expander("Rerun logs", expanded=False):
            st.code(output_text)
    st.session_state.run_result = resp


def preview_latest_jsonl(base_url: str) -> None:
    rel = st.session_state.latest_jsonl
    if not rel:
        st.info("Run first to preview JSONL.")
        return

    url = f"{base_url}/{str(rel).lstrip('/')}"
    try:
        res = requests.get(url, timeout=20)
        if not res.ok:
            st.error(f"Preview failed (HTTP {res.status_code}).")
            return
        text = res.text
    except Exception as exc:  # noqa: BLE001
        st.error(f"Preview failed: {exc}")
        return

    lines = [ln for ln in text.splitlines() if ln.strip()]
    invalid = 0
    for line in lines:
        try:
            obj = json.loads(line)
            for key in ["query", "response", "ground_truth"]:
                if key not in obj:
                    invalid += 1
                    break
        except Exception:  # noqa: BLE001
            invalid += 1

    if invalid:
        st.warning(f"Validation: {invalid} invalid line(s) out of {len(lines)}.")
    else:
        st.success(f"Validation: all {len(lines)} line(s) passed required keys.")

    preview = "\n".join(lines[:3]) if lines else "(empty file)"
    st.code(preview)


def render_history(base_url: str) -> None:
    c1, c2 = st.columns(2)
    with c1:
        refresh = st.button("Refresh history")
    with c2:
        clear = st.button("Clear history")

    if clear:
        ok, data = api_post_json(base_url, "/api/run-history/clear", {})
        if ok and data.get("ok"):
            st.success("History cleared.")
        else:
            st.error(data.get("error", "Failed to clear history."))

    if refresh or True:
        ok, data = api_get(base_url, "/api/run-history")
        if not ok:
            st.error(data.get("error", "Failed to load history."))
            return
        items = data.get("items", [])
        if not items:
            st.info("No runs yet.")
            return

        for item in items:
            st.write(f"**{'OK' if item.get('ok') else 'FAIL'}** | {item.get('mode', 'unknown')} | {item.get('createdAt', '')}")
            outputs = item.get("outputs") or {}
            links = parse_outputs_paths(outputs, base_url)
            if links:
                for key, link in links.items():
                    st.caption(f"{key.upper()}: {link}")
            else:
                st.caption("No artifacts")


def export_foundry(base_url: str) -> None:
    st.markdown("### Foundry export helper")
    target_dir = st.text_input("Target folder", value="foundry_exports")
    if st.button("Copy latest JSONL to Foundry folder"):
        rel = st.session_state.latest_jsonl
        if not rel:
            st.error("Run first to produce JSONL.")
            return
        ok, data = api_post_json(base_url, "/api/export-foundry", {"jsonlPath": rel, "targetDir": target_dir})
        if ok and data.get("ok"):
            st.success(f"Exported to {data.get('targetPath')}")
        else:
            st.error(data.get("error", "Export failed."))


def main() -> None:
    st.set_page_config(page_title="Prompt Runner Wizard (Python)", page_icon=":material/analytics:", layout="wide")
    inject_app_styles()
    render_shell_header()

    init_state()

    with st.expander("Backend connection", expanded=False):
        backend_url = st.text_input("Wizard backend URL", value=st.session_state.backend_url)
        c1, c2 = st.columns(2)
        with c1:
            if st.button("Auto-detect backend"):
                found = detect_backend_url()
                if found:
                    st.session_state.backend_url = found
                    backend_url = found
                    st.success(f"Detected {found}")
                else:
                    st.warning("No backend detected on common ports.")
        with c2:
            if st.button("Health check backend"):
                ok, data = api_get(backend_url, "/api/health")
                if ok and data.get("ok"):
                    st.success("Backend is healthy.")
                else:
                    st.error(data.get("error", "Backend health check failed."))

    st.session_state.backend_url = backend_url.rstrip("/")

    defaults = load_defaults(st.session_state.backend_url)
    settings = {
        "url": defaults.get("defaultChatUrl") or "https://simplechatdemo-fjgpaqe7h6c7akbr.eastus-01.azurewebsites.net/chats",
        "stateFile": defaults.get("defaultStateFile") or ".auth/storage-state.json",
        "networkTemplate": defaults.get("defaultNetworkTemplate") or "outputs/network-log-ui-full.json",
        "selectors": defaults.get("defaultSelectors") or "selectors.example.json",
        "outputDir": defaults.get("defaultOutputDir") or "outputs",
        "apiUrl": defaults.get("defaultApiUrl") or "",
        "apiMethod": defaults.get("defaultApiMethod") or "POST",
        "apiResponsePath": defaults.get("defaultApiResponsePath") or "choices.0.message.content",
    }

    st.markdown('<div id="step-setup" class="anchor-target"></div>', unsafe_allow_html=True)
    with st.expander("Step 0: Setup", expanded=True):
        render_setup_step(st.session_state.backend_url, settings)

    st.markdown('<div id="step-mode-files" class="anchor-target"></div>', unsafe_allow_html=True)
    with st.expander("Step 1-2: Mode and files", expanded=True):
        mode_state, file_state = render_mode_and_files(settings)

    st.markdown('<div id="step-config" class="anchor-target"></div>', unsafe_allow_html=True)
    with st.expander("Step 3: Config", expanded=True):
        cfg = render_config(settings, mode_state["mode"])

    st.markdown('<div id="step-run" class="anchor-target"></div>', unsafe_allow_html=True)
    with st.expander("Step 4: Run", expanded=True):
        c1, c2, c3 = st.columns(3)
        with c1:
            if st.button("Run batch", type="primary"):
                run_batch(st.session_state.backend_url, mode_state["mode"], cfg, file_state)
        with c2:
            if st.button("Rerun last config"):
                rerun_last_config(st.session_state.backend_url, bool(cfg["maskLogs"]))
        with c3:
            render_precheck(st.session_state.backend_url, mode_state["mode"], cfg)

        render_result_blocks(st.session_state.backend_url)

        st.markdown("### JSONL preview and validation")
        if st.button("Preview latest JSONL"):
            preview_latest_jsonl(st.session_state.backend_url)

        export_foundry(st.session_state.backend_url)

    with st.expander("Recent runs", expanded=False):
        render_history(st.session_state.backend_url)


if __name__ == "__main__":
    main()
