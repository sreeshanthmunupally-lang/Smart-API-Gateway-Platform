# Smart API Gateway Platform — Technical Whitepaper

> **Document scope:** Architecture, modules, data flow, database, protocol adapters, runtime modes, and implementation details.
> **Last updated:** 2026-07-28
> **Repository:** https://github.com/pythonistsawlani/Smart-API-Gateway-Platform

---

## 1. System Overview

Smart API Gateway Platform is a local-first, personal AI API management and forwarding hub. It provides a unified endpoint for client tools and routes requests to multiple upstream AI providers, handling channel management, model pool management, protocol adaptation, routing, failover, logging, and Web/Desktop administration.

Designed for personal local use, it trusts the local machine by default and is not architected as a public multi-tenant security boundary.

### Core request path:

```text
Client / AI Tool
  -> Smart API Gateway Proxy Endpoint (Port 9090)
  -> Protocol parser / compatibility layer
  -> Router / failover / cooldown
  -> Upstream AI provider
  -> Response converter / stream relay
  -> Usage log / dashboard stats
```

### Management path:

```text
Desktop UI / Web Admin
  -> Unified ApiAdapter
  -> Tauri commands (desktop) or Admin HTTP API (web)
  -> Backend command handlers
  -> SQLite database
```

---

## 2. Runtime Modes

| Mode | Description |
|------|-------------|
| **Desktop** | Tauri v2 app with embedded WebView and system tray |
| **Web Admin** | Browser-based UI pointing to the HTTP Admin API |
| **Headless** | Rust binary only — proxy + admin services, no GUI |
| **Android** | Tauri Android app (same Rust core + React UI) |

The frontend uses `isTauriRuntime()` to detect the environment and dispatches calls either through Tauri IPC (`invoke`) or HTTP requests to the admin API.

---

## 3. Technology Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Tauri v2 |
| Backend | Rust, axum, reqwest, tokio |
| Database | SQLite (rusqlite, WAL mode) |
| Frontend | React 19, TypeScript, Vite |
| UI components | Radix UI, Tailwind CSS v4 |
| State management | TanStack React Query |
| Charts | Recharts |
| i18n | i18next / react-i18next |

---

## 4. Module Architecture

### 4.1 Proxy Server (`proxy.rs`)

The proxy server listens on a configurable port (default `9090`) and implements:
- Protocol detection and routing based on URL path and request headers
- Connection to the appropriate upstream provider using the selected API entry
- Streaming response relay with empty-stream protection
- Usage logging for every completed request

### 4.2 Admin HTTP Server (`admin.rs`)

The admin HTTP server (default port `9099` or single-port mode sharing the proxy port) exposes REST endpoints for:
- Channel CRUD
- API pool management
- Access key management
- Settings read/write
- Dashboard statistics
- Import/export operations

All endpoints require Bearer Token authentication when `web_admin_enabled` is configured.

### 4.3 Unified API Adapter (`unifiedApiAdapter.ts`)

The single source of truth on the frontend for all data operations. Dispatches to either:
- **Tauri IPC** via `invoke()` when running inside the desktop app
- **HTTP `fetch()`** against the Admin API when running in web mode

Error messages from Tauri IPC are classified by text pattern matching (since the structured error code is lost during serialization) to allow the frontend to display precise, user-facing error messages.

### 4.4 Model Pool Manager (`PoolManager.tsx`)

The primary UI module. Handles:
- Paginated API entry list with virtual scrolling (IntersectionObserver)
- Drag-and-drop reordering
- Batch enable/disable (Shift+Click = all, Ctrl+Click = pin to top)
- Per-entry latency testing with score computation
- Channel-level delete (removes all associated entries)
- Group management

### 4.5 Channel Manager (`ChannelManager.tsx`)

Multi-step channel editor:
1. Fill in channel name, API type, base URL, API key, and notes
2. Probe endpoint reachability
3. Fetch model list from upstream
4. Select models to sync to the API pool
5. Save channel + sync selected models in a single transaction

---

## 5. Database Schema

All data is stored in a local SQLite database in WAL mode for concurrent read performance.

### Key tables:

| Table | Purpose |
|-------|---------|
| `channels` | Upstream provider configurations |
| `api_entries` | Individual model-channel pairs in the pool |
| `access_keys` | Bearer tokens for access key validation |
| `usage_logs` | Per-request logs (model, tokens, latency, status) |
| `config` | Key-value settings store |

### Schema evolution:

New columns are added using `ensure_column()` which runs `PRAGMA table_info` to check existence before issuing `ALTER TABLE ADD COLUMN`. New config keys are inserted with `INSERT OR IGNORE`. This ensures forward-compatible schema upgrades without breaking existing databases.

---

## 6. Protocol Adaptation

Smart API Gateway supports five protocol families:

| Protocol | Inbound Format | Outbound Format |
|----------|---------------|-----------------|
| OpenAI-compatible | OpenAI Chat Completions | OpenAI Chat Completions |
| OpenAI Responses | OpenAI Responses API | OpenAI Responses API |
| Claude Messages | Claude Messages API | Claude Messages API |
| Gemini | Gemini generateContent | Gemini generateContent |
| Azure OpenAI | Azure OpenAI format | Azure OpenAI format |

Protocol passthrough (same in/out) avoids double-conversion overhead. Cross-protocol conversion is performed when client and upstream use different protocol families.

---

## 7. Routing and Failover

### 7.1 Model Matching

Requests are matched to pool entries via:
1. **Exact match** — model name matches entry exactly
2. **Alias match** — model name matches an entry's display name alias
3. **AUTO** — any enabled entry is eligible; best entry is chosen by ordering strategy

### 7.2 Entry Ordering

Pool entries are ordered by one of:
- **Custom order** — user-defined drag-and-drop order
- **Fastest first** — ordered by measured latency (lowest first)
- **Latest models** — ordered by model release date (newest first)

### 7.3 Three-Layer Resilience

| Layer | Scope | Duration | Description |
|-------|-------|----------|-------------|
| Model cooldown | Per model | Configurable (seconds) | After N consecutive failures, cool the model temporarily |
| Circuit breaker | Per channel | In-memory | Freezes all models in a channel for 6 hours after triggering |
| Channel freeze by keyword | Per model or channel | Configurable | Matches upstream error text; configurable freeze scope |

### 7.4 Auto-Retry

Configured status codes trigger automatic failover to the next available entry. 504 and 524 are never retried (gateway timeout should be surfaced immediately). The retry code list is user-configurable.

---

## 8. Stream Protection

HTTP 200 responses with valid status but no usable stream output (empty SSE events, empty `data:` fields, or immediate stream close) are treated as failures. This prevents clients from hanging on a "succeeded" but empty response.

---

## 9. Usage Logging

Every proxied request generates a usage log entry with:
- Timestamp, model, actual resolved model, channel
- Token counts (prompt, completion, total)
- Latency (total and first-token)
- Success/failure status with error category
- Stream mode (streaming vs. non-streaming)
- Attempt path (which entries were tried before success)
- Optional raw protocol data (disabled by default)

Sensitive fields (API keys, tokens, bearer values) are redacted before storage.

---

## 10. Web Admin Authentication

### 10.1 Bearer Token Flow

Web Admin uses Bearer Token authentication. The HTTP helper reads the token from `localStorage`, attaches it as `Authorization: Bearer <token>`, and on 401/403 responses clears the token and emits a global `AUTH_EXPIRED` event, triggering automatic logout.

### 10.2 Settings Versioning

Settings updates use optimistic concurrency control via a `_version` field. On conflict (HTTP 409), the client automatically retries by fetching the latest version and reapplying the patch (up to 3 attempts). This prevents lost updates when multiple tabs edit settings simultaneously.

### 10.3 Desktop-Only Features

Features that require native OS capabilities (system tray, auto-start, file system access for app connectors, translation relay) are only available in the desktop Tauri app and are hidden or disabled in Web Admin mode.

---

## 11. Security Considerations

- All upstream API keys are stored locally in SQLite and never logged or transmitted in responses.
- Client Access Keys are separated from upstream API keys. Upstream keys are never exposed to API consumers.
- Web Admin uses login + Bearer Token. Tokens are stored in `localStorage` (session-scoped).
- Logs redact `Authorization` headers, API key query parameters, and token values before writing.
- The proxy is not designed for public internet exposure. Add a reverse proxy with TLS before exposing externally.

---

## 12. App Connectors

The Connect Apps feature generates or directly writes minimal configuration files for popular AI coding tools:

| App | Config file | Format |
|-----|------------|--------|
| OpenCode CLI | `~/.config/opencode/opencode.jsonc` | JSONC |
| Codex CLI | `~/.codex/config.toml` | TOML |
| Claude Code | `~/.claude/settings.json` | JSON |
| Zed Editor | `~/.config/zed/settings.json` | JSON |

On Windows desktop, the original file is backed up before overwrite. On non-Windows or web mode, the config is displayed for manual copying.

---

## 13. Data Import / Export

Channel and model data can be exported as a JSON payload and imported on another device. The import flow:
1. Validate the payload schema completely before applying any changes
2. Show a preview of incoming vs. current data
3. Require explicit user confirmation
4. Atomically clear all existing channels and models, then rebuild from the payload

System settings, access keys, logs, model pool ordering, and proxy state are not included in exports.

---

## 14. Development Setup

### Web Admin (no Rust required):

```bash
npm install
npm run dev:renderer
```

The dev server runs at `http://127.0.0.1:1430/` with mock admin API middleware enabled.

Default credentials: `admin` / `password`

### Full Desktop Build (Rust + Cargo required):

```bash
pnpm tauri build --features desktop
```

### Android Build:

```bash
pnpm android:init
pnpm android:dev
pnpm android:build
```

---

*Smart API Gateway Platform — Personal AI API management and forwarding hub*

*Repository: https://github.com/pythonistsawlani/Smart-API-Gateway-Platform*
