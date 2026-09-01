# qk-api-mock v1.0.1

Chrome extension for API mocking with per-tab activation, projects, dynamic rule updates and hit counters.

## What's New in v1.0.1

- **Per-Tab Activation** — mocking is now off by default for all tabs. Press the Play button in the popup to enable mocking only for the current tab. Press Pause to disable it instantly.
- **No More Domain Blocklists** — removed whitelists/blacklists. The extension runs on all URLs and delegates control entirely to the tab-level toggle.
- **Tab Badge** — when mocking is active on a tab, the extension icon shows an **ON** badge so you always know where interception is running.
- **Zero Side-Effects When Off** — when mocking is disabled, `fetch` and `XMLHttpRequest` work exactly like the browser's native implementations with no overhead.

## Features

- Toggle mocking per tab via Play/Pause button
- Organize mocks into projects
- Glob-style URL patterns (`**` for any path, `*` for any characters)
- Match by HTTP method or `ALL`
- Mutate request body / query params before sending to the server
- Return custom JSON responses with custom status codes
- Hit counters for every rule
- Rules update instantly without page reload

## Installation

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the project folder

## How to Use

1. Open the extension popup on any page.
2. Click the **▶ Play** button in the header to enable mocking for the **current tab only**.
3. Create a project (or use the default one).
4. Click **+ Add Mock** and fill in:
   - **URL Pattern** — e.g. `**/api/users` or `*/graphql`
   - **Method** — `GET`, `POST`, etc. or `ALL`
   - **Status Code** — e.g. `200`
   - **Response Body** — JSON you want to return
   - *(Optional)* **Request Body** — override outgoing data
5. Make requests on the page — matching ones will be intercepted.
6. Click **⏸ Pause** at any time to instantly stop mocking on this tab.

## File Structure

```
├── manifest.json      # Extension manifest (MV3)
├── background.js      # Service worker: badge management, tab cleanup
├── content.js         # Content script: bridge between page and extension
├── injected.js        # Injected into page MAIN world: fetch/XHR interception
├── popup.html         # Popup UI markup
├── popup.js           # Popup logic, tab state management
├── popup.css          # Popup styles
├── icons/             # Extension icons
└── README.md          # This file
```

## Architecture

- **injected.js** lives in the page's `MAIN` world and replaces `window.fetch` and `window.XMLHttpRequest`. When mocking is off, it immediately delegates to the original native APIs without any checks or delays.
- **content.js** acts as a bridge: it receives `UPDATE_ACTIVE_RULES` messages from the popup (with `isEnabled` flag) and passes rules into the page via `postMessage`.
- **popup.js** manages projects/rules storage and the per-tab toggle. Tab activation state is stored in `chrome.storage.session` under `tabEnabledStatus`.
- **background.js** listens for `SET_TAB_ENABLED` to show the **ON** badge, and cleans up session storage when tabs are closed.

## Changelog

### v1.0.1
- Switched from global domain allow/block lists to per-tab activation
- Added Play/Pause master toggle in popup header
- Added `ON` badge for active tabs
- Removed `BLOCKED_DOMAINS`, whitelists and `exclude_matches` from manifest
- Native fetch/XHR are completely untouched when mocking is disabled

### v1.0.0
- Initial release
- Projects with enable/disable toggles
- Mock rules with URL glob matching, method filtering, status code and response body
- Request body mutation support
- Real-time rule updates
- Hit counters
