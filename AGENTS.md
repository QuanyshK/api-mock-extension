# qk-api-mock — Agent Guide

This document is intended for AI coding agents working on the `qk-api-mock` project. It assumes no prior knowledge of the codebase.

## Project Overview

`qk-api-mock` is a **Chrome browser extension** (Manifest V3) that intercepts `fetch` and `XMLHttpRequest` calls on web pages and returns mock responses based on user-defined rules. It supports per-tab activation, project-based organization of rules, glob-style URL matching, request body mutation, and hit counters.

- **Version**: 1.0.1
- **Technology**: Pure vanilla JavaScript, HTML, and CSS. No frameworks, no bundlers, no build tools, no package managers.
- **Target platform**: Chrome (Manifest V3)

## File Structure

```
├── manifest.json      # Extension manifest (MV3)
├── background.js      # Service worker: badge management, tab cleanup
├── content.js         # Content script: bridge between popup and injected script
├── injected.js        # Injected into page MAIN world: fetch/XHR interception
├── popup.html         # Popup UI markup
├── popup.js           # Popup logic, project/rule management, tab state
├── popup.css          # Popup styles (dark theme)
├── icons/             # Extension icons (16, 32, 48, 128 px)
├── README.md          # Human-facing documentation
└── AGENTS.md          # This file
```

## Technology Stack & Runtime Architecture

### No Build Process
This project has **no build step**. All files are served directly by Chrome as-is. There is no `package.json`, no transpiler, no bundler, and no npm dependencies.

### Extension Architecture (4 layers)

1. **Popup (`popup.html` + `popup.js` + `popup.css`)**
   - Runs when the user clicks the extension icon.
   - Manages the UI for projects and mock rules.
   - Stores data in `chrome.storage.local`.
   - Tracks per-tab activation state in `chrome.storage.session` under `tabEnabledStatus`.
   - Sends rules to the content script via `chrome.tabs.sendMessage`.

2. **Background Service Worker (`background.js`)**
   - Handles `SET_TAB_ENABLED` messages to show an **ON** badge on active tabs.
   - Increments a hit counter badge (flashing cyan → red) on each `MOCK_HIT`.
   - Cleans up `tabEnabledStatus` and internal Maps/Sets when tabs are closed or reloaded.

3. **Content Script (`content.js`)**
   - Runs in the page's isolated world.
   - Acts as a bridge: receives `UPDATE_ACTIVE_RULES` from the popup, then forwards rules into the page via `window.postMessage`.
   - Listens for `MOCK_HIT` and `MOCK_RULES_REQUEST` events from the injected script.
   - Manages hit counter persistence in `chrome.storage.local`.
   - Handles "Extension context invalidated" errors gracefully.

4. **Injected Script (`injected.js`)**
   - Injected into the page's **MAIN** world (`"world": "MAIN"` in manifest).
   - Replaces `window.fetch` and `window.XMLHttpRequest` with interceptors.
   - When mocking is **disabled** (`isEnabled = false`), delegates immediately to the saved native APIs with zero overhead.
   - Receives rules via `window.postMessage` from the content script.
   - Sends hit notifications back to the content script via `window.postMessage`.

### Data Storage (`chrome.storage.local`)

| Key               | Type    | Description                                      |
|-------------------|---------|--------------------------------------------------|
| `projects`        | Array   | List of project objects `{id, name, enabled}`    |
| `currentProjectId`| String  | ID of the currently selected project             |
| `mockRules`       | Array   | List of rule objects (see schema below)          |
| `hitCounters`     | Object  | Map of `ruleId` → hit count                      |
| `sidebarCollapsed`| Boolean | UI state of the sidebar                          |

**Rule schema:**
```js
{
  id: String,
  projectId: String,
  enabled: Boolean,
  urlPattern: String,   // e.g. "**/api/users" or "*/graphql"
  method: String,       // "ALL", "GET", "POST", "PUT", "DELETE", "PATCH"
  statusCode: String,   // e.g. "200"
  responseBody: String, // JSON string or plain text
  requestBody: String   // For mutation: query params (GET) or body (POST/PUT/PATCH)
}
```

### Key Message Types

- `MOCK_HIT` — injected script → content script → background (hit notification)
- `SET_TAB_ENABLED` — popup → background (toggle badge)
- `GET_TAB_ID` — content script → background (get current tab ID)
- `HIT_COUNTER_UPDATED` — content script → popup (broadcast hit count)
- `MOCK_RULES_UPDATE` — content script → injected script (push rules)
- `MOCK_RULES_REQUEST` — injected script → content script (request rules on load)
- `UPDATE_ACTIVE_RULES` — popup → content script (push rules + isEnabled flag)
- `GET_HIT_COUNTERS` / `RESET_HIT_COUNTERS` / `REFRESH_RULES` — popup ↔ content script

## Code Style Guidelines

- **All scripts are wrapped in IIFEs** with `'use strict';`. There are no ES modules, no `import`/`export`.
- **No external dependencies** — do not introduce npm, webpack, or any build tool without explicit user approval.
- **Use `var` or `const` consistently** with the existing style. The codebase uses `const` for top-level elements and `let` for mutable state, but `var` is acceptable for function-scoped variables.
- **Defensive error handling**: wrap all Chrome API calls and extension messaging in `try/catch`. The codebase explicitly handles `"Extension context invalidated"` errors to avoid breaking the page when the extension is reloaded or disabled.
- **Console logging**: prefix all `console.log` / `console.error` messages with `[qk-api-mock]`.
- **Naming conventions**: use camelCase for variables/functions. Prefix internal globals with `__qk_` when stored on `window` (e.g., `window.__qk_original_fetch`).

## Testing Instructions

There is **no automated test suite** in this project. All testing is manual:

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the project folder
4. Open the extension popup on any web page
5. Click **▶ Play** to enable mocking for the current tab
6. Create a mock rule and trigger a matching request on the page
7. Verify the response is intercepted and the hit counter increments

To test changes after editing files:
- Click the **reload icon** on the extension card in `chrome://extensions/`
- For `injected.js` changes, you must also reload the target web page

## Security Considerations

- The extension requests `host_permissions: ["<all_urls>"]` and injects code into the **MAIN** world of every page. This gives it full access to page globals.
- `injected.js` saves and replaces native `fetch` and `XMLHttpRequest`. When disabled, it restores the exact original implementations with no wrappers.
- `window.postMessage` is used with `'*'` origin for communication between the injected script and the content script. This is intentional and safe because the content script filters by `event.source !== window`.
- All data is stored locally in `chrome.storage.local`. No data is sent to remote servers.
- When mocking is disabled, the extension leaves native APIs completely untouched — there is no overhead or side effect.

## Common Pitfalls for Agents

- **Do not add a build system** unless explicitly asked. The project is designed to work as plain static files loaded directly by Chrome.
- **Do not use ES modules** (`import`/`export`) in `.js` files — the extension loads them as classic scripts.
- **Always handle `chrome.runtime.lastError`** when using Chrome storage or messaging APIs.
- **Test in Chrome** (or Chromium). Firefox and Safari may require manifest adjustments.
- When modifying `manifest.json`, remember Manifest V3 restrictions: no `eval`, no inline scripts, service workers instead of background pages.
