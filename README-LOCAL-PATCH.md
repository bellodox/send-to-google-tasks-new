# Send to Google Tasks for Opera — local security patch 1.8.1.1

This is a modified unpacked extension based on the user's uploaded Opera installation of Send to Google Tasks 1.8.1. It is **not** a signed Chrome Web Store release and is not affiliated with the original publisher.

## Included

- `send-to-google-tasks-1.8.1.1/` — unpacked extension directory for Opera's Load unpacked button.
- `tests/extension.test.mjs` — 14 automated offline regression tests; does not contact Google.

## Install on Opera (Windows)

1. Extract the ZIP to a permanent directory on your computer (for example `Documents\\SendToTasksPatched`).
2. Open `opera://extensions` and enable **Developer mode**.
3. Disable the existing Store-installed **Send to Google Tasks** extension to avoid two copies processing the same click. If Opera reports an extension-ID collision, remove the original before loading the patch. This may reset its preferences.
4. Select **Load unpacked** and select the extracted **send-to-google-tasks-1.8.1.1** directory (the folder containing `manifest.json`).
5. Open the new extension's **Options**. Enable **Ask me to edit every task** to open a review window before each send.
6. Right-click a web page, selected text, or link and choose Send to Google Tasks, or click the toolbar icon. With review on, edit title, due date and details, then click **Add to Google Tasks**. Cancel or close the window to discard the draft.
7. Test with a disposable Google account before using the extension with important tasks. Verify the destination Google account and task list in Options.

The embedded public key is retained from the original installation so an unpacked copy can retain the original extension ID; the Web Store `update_url` is removed, and browser-managed signed `_metadata` files are deliberately omitted because modifying signed files invalidates the original package verification metadata. **Do not upload this package as if it were an official Store release.**

## Behavior changes

- Added synced checkbox `reviewBeforeSend` (default `false`). Existing one-click behavior remains by default. When enabled, every capture opens a separate compact edit window with editable title, due date and details/notes.
- Draft data is held in `chrome.storage.session`, not URL parameters, sync storage, or a remote server. It is deleted on successful submission or closing the window, and rejected after 20 minutes.
- A selected web Google account is no longer silently replaced by a browser account after access-token expiry. After expiry/restart the user is asked to select an account again.
- A task-list ID is pinned in local storage to detect silent Google account changes without requesting another OAuth scope. Changing accounts requires Sign out in Options. This can also require sign-out if all previous task lists were deleted.
- OAuth redirect origin/path and a cryptographically random request `state` are validated. Silent/interactive login requests no longer suppress an interactive window after a silent failure.
- Local sign-out clears token state, account anchor and selected task list. A best-effort OAuth revocation request is sent without putting tokens in the URL. Because Google's endpoint does not expose its result to cross-origin extension code, the UI **does not claim remote revocation succeeded**. Verify/remove the app at https://myaccount.google.com/connections.
- Google task-list API pagination is followed, and selected task lists are confirmed to exist.
- Duplicate simultaneous submissions from the same draft are blocked, and rapid duplicate captures are suppressed for 1.4 seconds. Success notifications no longer reveal private task titles. Edited text is validated and sent using JSON, never interpreted as HTML.

## Known limitations / security scope

- The original publisher's Google OAuth client IDs are still present; the extension may still require user consent and authorization to that Google Cloud OAuth app.
- To preserve compatibility with the existing publisher-controlled Google OAuth client configuration, the custom web flow still uses OAuth **implicit grant**. It now uses `state` and strict redirect validation, but **it is not a full authorization-code + PKCE migration**. Migrating that flow safely may require control of the Google Cloud project and compatible OAuth client configuration; do not ship an untested flow change in this local patch.
- Google Tasks' write scope also grants task-reading/modification privileges; Google does not expose a create-only Tasks OAuth scope. This patch uses only task-list reads and user-triggered task creates.
- No live login or real Google Tasks mutation was performed. All 14 automated tests use mocked browser/Google APIs. An attempted headless Chromium visual smoke test could not complete in the container; Opera UI must be verified manually.
- The provided original package had differences in some images/manifest against its packaged verification metadata. This patch reuses those local images and does not certify independent store-package provenance.
- The modified unpacked extension will **not** automatically inherit publisher Web Store updates. Only install future changes after reviewing them.

## Tests

From the extracted ZIP's root, with Node.js 22 or newer:

```sh
node --experimental-default-type=module --test tests/extension.test.mjs
```

Expected: `14` tests pass. They cover edit field validation, due date, preferences, account pinning, token expiry, OAuth state/redirect checks, race escalation, sign-out semantics, task-list pagination, no early write in preview mode, direct send, duplicate-submit prevention, and draft deletion on window close, duplicate-click suppression and notification privacy.

## Source files modified

`manifest.json`, `auth.js`, `background.js`, `tasks.js`, `settings.js`, `options.html`, `options.js`, `options.css`; added `editor.html`, `editor.js`, and `editor.css`. Original images are retained unchanged from the user's uploaded package.
