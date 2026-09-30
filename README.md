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
- **You always submit** — no auto-submit, ever. Undo is always available, and a "review list before writing" mode can be enabled in Settings for first-time sites.
- **Multi-library profiles** — one `shared` profile (name, contact, education, sensitive info) plus any number of per-direction libraries (e.g. product vs. operations) that auto-switch based on the detected job direction. English ATS sites' `First name`/`Last name` split is fed from explicit fields — the extension never guesses how to split your name.
- **Yes/No questions, answered once** — availability questions (on-site/online interview, travel, relocation, overtime…) are stored once per profile and matched by polarity, so it will never tick "No" just because a library is missing an experience entry.
- **Plain-text resume import** — paste a Chinese resume as text and an offline rule parser (no network, no upload, no API key) extracts sections, experiences and skills, with a preview before anything is saved; unparseable input is rejected wholesale and existing data is untouched.
- **Optional AI providers** — Mock (offline) / DeepSeek / OpenAI-compatible endpoints. API keys live only in `chrome.storage.local`, never in code or logs.
- **Job pipeline tracking** — a local Job → Session → Timeline state machine (saved → preparing → applying → submitted → assessment → interview → offer/rejected/…) with no backend and no telemetry.

## 🚀 Quick Start

**Prerequisites**: Node.js 18+, npm, and Google Chrome or Microsoft Edge 114+.

```bash
git clone https://github.com/zhangtt08/application-form-assistant.git
cd application-form-assistant
npm install
npm run build
```

Then load the extension:

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the generated `dist/` folder.

Pin the extension, open any job page, and click **Start** in the side panel.

Optional checks:

```bash
npm test                 # unit tests (Vitest, offline & deterministic)
npm run test:e2e         # Playwright end-to-end scenarios
python smoke/smoke.py    # real-Chromium UI smoke test with screenshots (needs Python)
npm run eval:generation  # generation-quality eval (needs a provider; see README.zh-CN.md)
```

## 🏗️ Architecture / How it works

Data flow: **Scan → Recognize → Match → Risk Check → Fill**, with results bucketed as `filled / awaiting your input / fill manually`. All data lives in `chrome.storage.local` — there is no backend and no telemetry.

```
public/manifest.json     MV3 manifest: side panel + service worker + all-frames content script
src/
  background/            MV3 service worker (tab & runtime orchestration)
  content/               in-page connector and field writer (runs in every frame)
  sidepanel/             React UI: Apply / Jobs / Profile / Settings (bottom nav)
  pipeline/              scan → recognize → match → fill orchestration
  matching/              field ↔ profile matching
  profile/               multi-library store (afa.profiles.v2) + plain-text resume parser
  rules/                 deterministic rules (yes/no polarity, etc.)
  answering/ generation/ job/ context/ workspace/ compatibility/ types/ utils/
tests/  e2e/  smoke/  evaluation/    Vitest unit · Playwright e2e · smoke · gen-eval
```

Key storage keys: `afa.profiles.v2` (shared + libraries, auto-migrated from legacy `afa.profile.v1`), `afa.jobs.v2` / `afa.sessions.v2` / `afa.events.v1` (job lifecycle). A detailed Chinese walkthrough of the UI model, the generation-eval harness and the application lifecycle is in the [Chinese README](README.zh-CN.md).

## 📄 License

[MIT](LICENSE)
