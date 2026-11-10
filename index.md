---
title: Send to Google Tasks — community patch
---

# Send to Google Tasks for Opera

**Review a page, link, or selected text before creating a Google Task.** An optional local editor lets you change the **title**, **due date**, and **details** before submitting. When editing is disabled, the original direct-send workflow remains available.

> **Unofficial development build.** This is a community-maintained patch to an installed extension; it is **not** the official Chrome Web Store release and does not imply endorsement by the original developer.

## Install (Opera / Chromium)

1. Download the source from the [`new` branch](https://github.com/bellodox/send-to-google-tasks-new/tree/new).
2. Extract it to a permanent directory and open `opera://extensions`.
3. Enable **Developer mode** and choose **Load unpacked**.
4. Select the `extension` directory (the one containing `manifest.json`).
5. Disable the original extension, so that two copies do not process the same command.
6. Open **Options** and enable **Ask me to edit every task** to review the title, due date, and details before adding the task.

For existing users, verify the selected Google account and destination task list in Options. **Test with a separate account containing non-sensitive tasks before connecting an important account.**

## What's changed

- Optional edit-before-send dialog, default **off**; your task is not created until you select **Add to Google Tasks**.
- Drafts use temporary extension-session storage and are discarded when closed, submitted or expired.
- Prevents silent fallback to another Google account and checks the destination task list.
- Validates OAuth redirect and request state; limits parallel login and duplicate submission behavior.
- Sign-out removes local credentials but **cannot confirm Google-side revocation**. To revoke the grant, use [Google's account connections page](https://myaccount.google.com/connections).
- No third-party analytics or developer-operated data collection service is present in the reviewed application code.

## Permissions and limitations

The extension requests `activeTab`, `contextMenus`, `identity`, `notifications`, and `storage`. It uses Google's Tasks OAuth scope, which grants **read and write access to Google Tasks**, not create-only access. Current application code only lists task lists and creates user-requested tasks. Your task titles, notes, URLs, and selected text are sent directly to Google's Tasks API when you submit. Avoid including passwords, access tokens, or confidential URLs in task details.

The existing publisher-owned OAuth configuration is still used. The compatible web-based login flow is not yet upgraded to authorization-code + PKCE. Live Google sign-in and task creation were **not** validated in this build; offline regression tests cover expected application behavior.

For more details, read the [privacy notice](privacy) and [source/installation notes](https://github.com/bellodox/send-to-google-tasks-new/blob/new/README-LOCAL-PATCH.md).
