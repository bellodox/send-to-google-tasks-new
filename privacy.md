---
title: Privacy — Send to Google Tasks community patch
---

# Privacy notice for the unofficial extension patch

**Last revised:** November 10, 2026.

This notice describes the public source in the [`new` branch](https://github.com/bellodox/send-to-google-tasks-new/tree/new). It is **not** the privacy notice of the original Chrome Web Store publisher, and this community patch is not an official release.

## Information processed

When you explicitly choose to capture a page, link, or selected text, the extension builds a Google Task containing the chosen title, URL and/or selected content. If **Ask me to edit every task** is enabled, you can modify or remove this information before submission. With review mode enabled, no task is sent until you approve the editor. Review mode is disabled by default; when it is disabled, selecting Send to Google Tasks immediately submits the task.

The extension reads the available Google Tasks lists so you can choose a destination, and sends your confirmed task directly to `tasks.googleapis.com`. Google authentication is handled through browser identity and Google's OAuth endpoints. It does **not** request your Google account password.

## Permissions

- Browser: `activeTab`, `contextMenus`, `identity`, `notifications`, and `storage`.
- Google Tasks: `https://www.googleapis.com/auth/tasks`, which can **view, edit, create, organize, and delete** tasks at the API permission level. The implementation currently uses task-list listing and task creation only. This broader authorization is a significant remaining trust consideration.

## Storage and network

User preferences are stored in browser extension storage. Unsubmitted drafts are temporarily held in `chrome.storage.session` and removed upon completion or closure, and drafts older than 20 minutes are rejected. Authentication-related state is held by the extension and browser identity subsystem. Based on static source inspection, this patch includes no developer-hosted analytics, advertising service, or server endpoint receiving captured task data. Its supported network destinations are Google's OAuth/Tasks endpoints. No network-level production audit has been performed.

Task contents sent to Google are thereafter handled under Google's account and service policies. Avoid creating tasks containing secret tokens or sensitive page information.

## Revocation and deletion

Use the extension's Sign out control to clear local credentials and account/list selection. Because the extension cannot verify the OAuth revocation endpoint's response, this **does not guarantee** the OAuth grant is revoked on Google's servers. To withdraw authorization, visit [Google Account — connections](https://myaccount.google.com/connections) and remove the app's access. Remove the extension in `opera://extensions` to delete the local extension installation. Tasks already created in Google Tasks must be managed/deleted in Google Tasks itself.

## Important disclaimer

No claims are made regarding the official extension's future releases, unpublished backend operations, publisher practices, or the behavior of Google beyond its documented APIs. This is a source-based description of the local community patch, not a verified legal GDPR compliance assessment. Do not assume the author of this patch acts as the data controller for data Google receives.
