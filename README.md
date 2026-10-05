# Application Form Assistant

A Chrome/Edge (Manifest V3) extension that scans the job application form in front of you, matches it against your local profile library, and fills it in with one click — it never invents values and never auto-submits.

网申自动填写助手：识别岗位 → 识别字段 → 按资料库一键填写。不逐项确认，但绝不自动提交。

**English** | [简体中文](README.zh-CN.md)

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20MV3-4CAF50)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6)
![React](https://img.shields.io/badge/React-18-61DAFB)
![Vite](https://img.shields.io/badge/Vite-5-646CFF)
![Playwright](https://img.shields.io/badge/tested%20with-Playwright-2EAD33)

## Why

Every careers site makes you re-type the same name, phone number, education and project history into a slightly different web form — and Chinese campus-hiring sites, plus Greenhouse/Lever/Workday-style ATS forms, each have their own quirks. Application Form Assistant is a side-panel extension that reads the application form already open in your browser, recognizes which fields it needs, matches them against a profile library you maintain locally, and writes the values into the page for you. You stay in control: it fills, you review, **you** press submit.

## ✨ Features

- **One-click pipeline** — a single "Start" action chains every step with deterministic per-step status (no fake spinners): connect to the page (including all frames) → recognize the job and application direction → wait for SPA fields to render → recognize the fields that need filling → match your profile → write into the page.
- **One primary action per screen** — after recognition finishes, the four progress lines collapse into one (`Recognized · 4/4 steps · 17 fields, 14 filled`), expanding only if a step failed; "re-scan" and "undo this fill" become text links, "I have submitted" is a small button, and the page URL shows up only in developer mode. Library renaming / copying / deleting and job notes / archiving / deleting live behind a "more actions" fold, so each screen leaves exactly one obvious next click.
- **Context gating** — only controls inside the application flow enter the fill process. Login panels, captchas, nav search boxes and footer subscribe forms are excluded and shown as a one-line statistic, never as fake "fields to fill".
- **Conservative write rules** — it only writes what exists in your profile library: empty stays empty (no invented values); values that exceed a field's length limit or don't fit a number box are marked "please fill manually" instead of being truncated or forced; commitments / declarations / e-signatures / consent checkboxes are **never** filled on your behalf; file uploads, captchas and password boxes are not touched.
- **Explained matches, not a magic percentage** — every field card carries a "why this field" disclosure built from the matcher's own evidence (which signal hit, which alias, which section boosted it), plus the runner-up candidate. When two fields are close, you can switch this one to the alternative in one click and the field is re-scored through the same risk/status pipeline — not just re-labelled.
- **Fill receipt** — after writing, the panel reports what was filled, what the red lines deliberately blocked and *why* (commitment/consent/adjustment checkboxes, controls excluded by context gating, option sets your data doesn't answer, values too long for the field), what failed to write, and what your library has no content for. Skipped fields can be un-skipped without re-scanning the page.
- **You always submit** — no auto-submit, ever. Undo is always available, and a "review list before writing" mode can be enabled in Settings for first-time sites.
- **Multi-library profiles** — one `shared` profile (name, contact, education, sensitive info) plus any number of per-direction libraries (e.g. product vs. operations) that auto-switch based on the detected job direction. English ATS sites' `First name`/`Last name` split is fed from explicit fields — the extension never guesses how to split your name.
- **Yes/No questions, answered once** — availability questions (on-site/online interview, travel, relocation, overtime…) are stored once per profile and matched by polarity, so it will never tick "No" just because a library is missing an experience entry.
- **Plain-text resume import** — paste a Chinese resume as text and an offline rule parser (no network, no upload, no API key) extracts sections, experiences and skills, with a preview before anything is saved; unparseable input is rejected wholesale and existing data is untouched.
- **Optional AI providers** — Mock (offline) / DeepSeek / OpenAI-compatible endpoints. By default the API key is held **in memory for the current side-panel session only and is never written to disk**; keeping it on the machine is an explicit, separately-labelled opt-in (checkbox) that spells out the warning in the UI. Either way the key never appears in code, logs, traces or the bundle. What the opt-in gives you is *storage*, not *protection*: `chrome.storage.local` is an unencrypted leveldb file with no access control, so any process running as your user that can read the profile directory can read the key.
- **Job pipeline tracking** — a local Job → Session → Timeline state machine (saved → preparing → applying → submitted → assessment → interview → offer/rejected/…) with no backend and no telemetry.
- **Local Agent API / MCP** — a read-only `afa.*` tool surface that reuses the extension's own matching, risk and fill-plan code, so an external agent gets the same verdicts the side panel shows. See [Agent API / MCP](#-agent-api--mcp).

## 🛑 Safety red lines

These are product decisions, not limitations to be optimised away. Each one is enforced in code and covered by a test:

| Red line | Where it is enforced |
| --- | --- |
| **Never clicks submit** — the extension fills, a human submits | `src/rules/ignoreRules.ts` (`BLOCKED_ACTIONS`) + `e2e/safety-flow.spec.ts` |
| **Risk fields are manual-only** — commitments, declarations, e-signatures, consent, job-adjustment, background-check and visa/work-authorisation statements are never written on your behalf | `src/rules/riskRules.ts` (`MANUAL_ONLY_KEYWORDS`) |
| **Scanning never writes to the DOM** — the scanner is read-only; every write goes through a confirmed fill plan created only by the user's own "confirm" action | `src/content/scanner.ts` + `src/pipeline/fillPlan.ts` + `e2e/scan-does-not-write.spec.ts` |
| **No invented values** — empty stays empty; over-length values and values a numeric control cannot hold are handed back to you instead of being truncated or rewritten | `src/pipeline/scanPipeline.ts` (`deriveStatus`) |
| **Demographics are not "profile data"** — EEO / ethnicity / disability / veteran self-declaration questions are never auto-answered, even when an alias matches | `src/matching/matcher.ts` (`PROTECTED_CLASS_MARKERS`) |
| **Other people's fields are not yours** — a label saying "referee / 推荐人 / parent" is never filled with *your* name or phone | `src/matching/matcher.ts` (`OTHER_PERSON_MARKERS`) |
| **Local only** — no cloud backend, no telemetry; the only outbound network calls are the AI providers you explicitly configure. The API key is in memory for the session by default; only the labelled opt-in puts it in `chrome.storage.local`, which is unencrypted storage, not protection | `src/generation/provider.ts` |

## 🚀 Quick Start

**Prerequisites**: Node.js 18+, npm, and Microsoft Edge (or Chrome) 114+.

```bash
git clone https://github.com/<your-account>/application-form-assistant.git
cd application-form-assistant
npm install
npm run build          # builds dist/ : side panel + content script + service worker
```

Install into **Edge**:

1. Open `edge://extensions` in Edge.
2. Turn on **Developer mode** (toggle in the left sidebar, bottom).
3. Click **Load unpacked** and select the generated **`dist/`** folder.
4. Pin the extension (optional), then open any job application page.
5. Open the side panel: the extensions toolbar button → **Application Form Assistant**
   (or right-click the page → *More actions* → *Application Form Assistant*).
6. First run: go to the **Profile** tab and paste your resume text — parsing is fully offline.
   Then return to **Apply** and click **开始识别 / Start**.

The same `dist/` loads unchanged in Chrome via `chrome://extensions` → **Load unpacked**.

> `dist/` is a build output and is not committed. Re-run `npm run build` after any change,
> and press the reload icon on the extension card in `edge://extensions` afterwards.

Optional checks:

```bash
npm test                 # unit tests (Vitest + jsdom, offline & deterministic)
npm run typecheck        # tsc --noEmit
npm run test:e2e         # Playwright end-to-end scenarios (real Chromium + dist/ extension)
npm run test:compat      # compatibility matrix -> compatibility-results/report.md (regenerable, not committed)
npm run privacy:scan     # PII / credential scan over tracked files — must report 0 ERROR
python smoke/smoke.py    # real-Chromium UI smoke test with screenshots (needs Python)
npm run eval:generation  # generation-quality eval (needs a provider; see README.zh-CN.md)
```

## 🤖 Agent API / MCP

The extension has no server, so the agent runs as a **separate local process** on port **8797**:

```bash
npm run agent:serve      # HTTP  → http://127.0.0.1:8797
npm run agent:mcp        # MCP stdio bridge (same tools, any MCP client)
```

Eight tools, all prefixed `afa.` and all `risk: 'read'`:
`list_fields`, `read_profile` (redacted summary), `validate_profile`, `scan_form`,
`match_question`, `plan_fill`, `export_results`, `storage_overview`.

They do **not** reimplement anything: `agent/tools.mjs` imports `src/core`, which re-exports the
same matcher / risk rules / scan pipeline / fill-plan gates the side panel runs — so the agent's
confidence and the UI badge can never disagree. There is deliberately **no** tool that writes to a
page, clicks submit, or posts to a third-party site: exposing that would remove the red line above.
See [`agent/README.md`](agent/README.md) for the contract, schemas and the jsdom caveat.

## 🏗️ Architecture / How it works

Data flow: **Scan → Recognize → Match → Risk Check → Fill**, with results bucketed as `filled / awaiting your input / fill manually`. Your profile, jobs and timeline live in `chrome.storage.local` — there is no cloud backend and no telemetry. The one thing that by default is *not* on disk is the AI provider API key (session memory unless you tick the labelled opt-in; see [Safety red lines](#-safety-red-lines)).

```
public/manifest.json     MV3 manifest: side panel + service worker + all-frames content script
src/
  core/                  ★ shared pure-logic facade: field labels + "why this matched" explanation,
                         and re-exports of matcher / risk rules / pipeline / profile schema.
                         Imported by BOTH the side panel and agent/tools.mjs — one source of truth.
  background/            MV3 service worker (tab & runtime orchestration)
  content/               in-page connector and field writer (runs in every frame)
  sidepanel/             React UI: Apply / Jobs / Profile / Settings (bottom nav)
  pipeline/              scan → recognize → match → fill orchestration
  matching/              field ↔ profile matching
  profile/               multi-library store (afa.profiles.v2) + plain-text resume parser
  rules/                 deterministic rules (aliases, risk, yes/no polarity, ignore list)
  answering/ generation/ job/ context/ workspace/ compatibility/ types/ utils/
agent/                   local Agent API (server.mjs + tools.mjs + mcp-server.mjs) — see agent/README.md
tests/  e2e/  smoke/  evaluation/    Vitest unit · Playwright e2e · smoke · gen-eval
docs/                  design principles, test-data policy, privacy & safety audits
real-validation-results/             real-site pilot evidence (sessions / issues; private/ is gitignored)
```

Key storage keys: `afa.profiles.v2` (shared + libraries, auto-migrated from legacy `afa.profile.v1`), `afa.jobs.v2` / `afa.sessions.v2` / `afa.events.v1` (job lifecycle), `afa.apply.prefs.v1` (behaviour toggles). A detailed Chinese walkthrough of the UI model, the generation-eval harness and the application lifecycle is in the [Chinese README](README.zh-CN.md).

**Repository hygiene**: build output, test runs, regenerable verification reports and any screenshot
that can show a filled-in value are gitignored. Real resumes, contact details and cookies never
enter the repo — enforced by `npm run privacy:scan` and documented in
[`docs/TEST_DATA_POLICY.md`](docs/TEST_DATA_POLICY.md).

## 📄 License

[MIT](LICENSE)
