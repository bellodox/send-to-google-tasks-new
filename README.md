# Send to Google Tasks — community security patch

This branch contains an **unofficial**, locally testable Opera/Chromium extension derived from an installed release of Send to Google Tasks 1.8.1. The modification is **not published by or affiliated with the original Chrome Web Store publisher**.

## What is included

- [`extension/`](extension/) — Manifest V3 unpacked extension, version 1.8.1.1.
- [`tests/`](tests/) — mocked offline regression suite (14 tests).
- [`index.md`](index.md) and [`privacy.md`](privacy.md) — updated website documentation for this community patch.
- [`README-LOCAL-PATCH.md`](README-LOCAL-PATCH.md) — installation, scope, known limitations and security notes.

## Install in Opera

1. Download or clone this branch and keep it in a permanent local directory.
2. Open `opera://extensions` and enable Developer mode.
3. Disable the original Web Store extension to avoid duplicate handlers.
4. Choose **Load unpacked** and select the `extension/` folder containing `manifest.json`.
5. Open **Options** and enable **Ask me to edit every task** if desired.
6. Test with a disposable Google account first.

To test with Node 22+:

```sh
node --experimental-default-type=module --test tests/extension.test.mjs
```

## Security limitations

Google's `tasks` scope can read and modify all of an account's Google Tasks, although the current implementation only reads task-list metadata and creates tasks on explicit user action. The web login still uses OAuth implicit grant with added state/redirect checks, **not PKCE**; it relies on OAuth client configuration controlled by the original publisher. The local sign-out cannot guarantee successful server-side OAuth revocation; remove third-party access at [Google Account connections](https://myaccount.google.com/connections). The review dialog holds drafts only in local session storage. No live OAuth or Google Tasks write test was performed; the tests are mocked.

Do not treat this branch as an official Web Store update or a security-certified release. User should review the source before authorizing important accounts.
