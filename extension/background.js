// Service worker: the toolbar button and right-click menus send the page or link to Google
// Tasks, and every send ends in a notification that says whether it worked.
import { SignInError } from './auth.js';
import { iconPaths, readSettings } from './settings.js';
import { buildTask, buildEditedTask, insertTask, resolveTaskList, SendError, taskListPage, withToken } from './tasks.js';
const TITLE = 'Send to Google Tasks';
const BADGE_MS = 3000;
// Success notifications go away on their own, as in 1.7; failures stay until dismissed.
const SUCCESS_NOTIFICATION_MS = 6000;
const MAX_NOTIFICATION_TARGETS = 20;
const DRAFT_TTL_MS = 20 * 60_000;
const submittingDrafts = new Set();
const recentCapture = new Map();
const DOUBLE_CLICK_WINDOW_MS = 1400;
// Due-date menu ids, mapped to days from today.
const DUE_MENUS = { 'due-0': 0, 'due-1': 1, 'due-7': 7 };
// A page or link right-click shows exactly one item, so it stays a single click: with two,
// Chrome would fold them under a submenu. The due-date choices live on the toolbar button's
// own right-click menu instead.
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: 'send-page', title: 'Send to Google Tasks', contexts: ['page', 'selection'] });
        chrome.contextMenus.create({ id: 'send-link', title: 'Send link to Google Tasks', contexts: ['link'] });
        chrome.contextMenus.create({ id: 'due-0', title: 'Send this page, due today', contexts: ['action'] });
        chrome.contextMenus.create({ id: 'due-1', title: 'Send this page, due tomorrow', contexts: ['action'] });
        chrome.contextMenus.create({ id: 'due-7', title: 'Send this page, due in a week', contexts: ['action'] });
    });
    void applyIcon();
});
chrome.runtime.onStartup.addListener(() => void applyIcon());
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && ('iconColor' in changes || 'color' in changes)) {
        void applyIcon();
    }
});
chrome.action.onClicked.addListener((tab) => {
    void capture({ url: tab.url ?? '', title: tab.title });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
    const id = String(info.menuItemId);
    const dueDays = DUE_MENUS[id];
    if (id === 'send-link' && info.linkUrl) {
        void capture({ url: info.linkUrl, title: info.selectionText });
    }
    else if (id === 'send-page') {
        void capture({ url: info.pageUrl ?? tab?.url ?? '', title: tab?.title, selection: info.selectionText });
    }
    else if (dueDays !== undefined) {
        void capture({ url: tab?.url ?? '', title: tab?.title }, dueDays);
    }
});
// Registered at the top level so a click still works after Chrome restarts the worker.
chrome.notifications.onClicked.addListener(async (notificationId) => {
    const { notificationTargets = {} } = (await chrome.storage.session.get('notificationTargets'));
    const target = notificationTargets[notificationId];
    await chrome.notifications.clear(notificationId);
    if (target) {
        await chrome.tabs.create({ url: target });
    }
});
// The optional review window opens before OAuth and before any Google Tasks write.
// Draft content remains in storage.session, never in the editor URL or synced storage.
async function capture(item, dueDays) {
    // Prevent two accidental rapid clicks on the same page from creating two
    // windows or tasks. A later deliberate capture remains possible.
    const stamp = Date.now();
    for (const [key, when] of recentCapture) {
        if (stamp - when > DOUBLE_CLICK_WINDOW_MS) recentCapture.delete(key);
    }
    const captureKey = JSON.stringify([item.url, item.title ?? '', item.selection ?? '', dueDays ?? null]);
    if (recentCapture.has(captureKey)) return;
    recentCapture.set(captureKey, stamp);
    if (!item.url) {
        await fail(new SendError("Opera doesn't allow access to this page's address."), false);
        return;
    }
    try {
        const settings = await readSettings();
        const effectiveDueDays = dueDays ?? settings.dueDays;
        if (settings.reviewBeforeSend) {
            await openEditor(item, effectiveDueDays);
        } else {
            await sendPrepared(buildTask(item, effectiveDueDays, new Date()), settings.taskList);
        }
    } catch (error) {
        await fail(error, false);
    }
}

async function openEditor(item, dueDays) {
    const id = crypto.randomUUID();
    const key = `draft:${id}`;
    await chrome.storage.session.set({ [key]: { item, dueDays, createdAt: Date.now() } });
    try {
        const win = await chrome.windows.create({
            url: chrome.runtime.getURL(`editor.html?draft=${encodeURIComponent(id)}`),
            type: 'popup', width: 500, height: 690, focused: true,
        });
        if (win?.id !== undefined) {
            await chrome.storage.session.set({ [`draftWindow:${win.id}`]: id });
        }
    } catch (error) {
        await chrome.storage.session.remove(key);
        throw error;
    }
}

// Closing or cancelling the editor discards its sensitive captured content.
chrome.windows.onRemoved.addListener((windowId) => {
    void (async () => {
        const mapKey = `draftWindow:${windowId}`;
        const mapping = await chrome.storage.session.get(mapKey);
        if (mapping[mapKey]) await chrome.storage.session.remove(`draft:${mapping[mapKey]}`);
        await chrome.storage.session.remove(mapKey);
    })().catch((error) => console.warn('Could not discard closed draft:', error));
});

// Restrict task-submission messages to this extension's own review screen.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'submitReviewedTask') return false;
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('editor.html?'))) {
        sendResponse({ ok: false, error: 'Unauthorized task submission.' });
        return false;
    }
    void submitReviewedTask(message).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true; // Keep message reply open while OAuth/API operations run.
});

async function submitReviewedTask(message) {
    const id = message.draftId;
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new SendError('Invalid draft ID.');
    if (submittingDrafts.has(id)) throw new SendError('This task is already being submitted.');
    submittingDrafts.add(id);
    try {
        const key = `draft:${id}`;
        const stored = await chrome.storage.session.get(key);
        const draft = stored[key];
        if (!draft || Date.now() - draft.createdAt > DRAFT_TTL_MS) {
            await chrome.storage.session.remove(key);
            throw new SendError('This draft has expired. Capture the page again.');
        }
        const task = buildEditedTask(message.task);
        const settings = await readSettings();
        await sendPrepared(task, settings.taskList);
        await chrome.storage.session.remove(key);
    } finally {
        submittingDrafts.delete(id);
    }
}

// One insert per user request; do not retry ambiguous POST network failures.
async function sendPrepared(task, selectedList) {
    await setBadge('…', '#5F6368', false);
    await chrome.action.setTitle({ title: TITLE });
    let sent;
    try {
        const taskList = await withToken(async (token) => {
            const list = await resolveTaskList(token, selectedList);
            await insertTask(token, list, task);
            return list;
        });
        sent = { title: task.title, due: task.due, taskList };
    } catch (error) {
        const { message } = explain(error, selectedList !== '');
        await setBadge('!', '#D93025', false);
        await chrome.action.setTitle({ title: `${TITLE}: the last send failed. ${message}` });
        await recordLastSend(message);
        throw error;
    }
    // A failed OS notification must never cause another POST or claim the task failed.
    await setBadge('✓', '#188038');
    await recordLastSend('Sent');
    const id = await notify('Sent to Google Tasks', 'Task created successfully.', taskListPage(sent.taskList), sent.due ? `Due ${dueLabel(sent.due)}` : '');
    if (id) setTimeout(() => void chrome.notifications.clear(id), SUCCESS_NOTIFICATION_MS);
}

// Google keeps a due date as midnight UTC, so it is shown in UTC to keep the same day.
function dueLabel(due) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(due));
}
// The "!" and the button's tooltip stay until the next send, for people whose notifications
// are hidden or who use a screen reader.
async function fail(error, listWasChosen) {
    console.warn('send failed:', error);
    const { message, target } = explain(error, listWasChosen);
    await setBadge('!', '#D93025', false);
    await chrome.action.setTitle({ title: `${TITLE}: the last send failed. ${message}` });
    await recordLastSend(message);
    await notify("Couldn't send to Google Tasks", message, target);
}
// Kept on this device only, for the options page to show when someone asks for help.
// It holds the outcome, never the page.
async function recordLastSend(result) {
    await chrome.storage.local.set({ lastSend: { at: new Date().toISOString(), result } });
}
// The notification text for a failed send, and where clicking it should go.
function explain(error, listWasChosen) {
    if (error instanceof SignInError) {
        return { message: `Couldn't sign in to Google, so nothing was sent (${error.message}). Click the button again to retry.` };
    }
    // A list from another account, or a deleted one, comes back as 404 or 400.
    if (error instanceof SendError && (error.status === 404 || error.status === 400) && listWasChosen) {
        return { message: "The task list picked in the options doesn't exist in this Google account. Click here to pick another.", target: chrome.runtime.getURL('options.html') };
    }
    if (error instanceof SendError) {
        return { message: error.message };
    }
    return { message: `Something went wrong: ${error instanceof Error ? error.message : String(error)}` };
}
async function notify(title, message, target, contextMessage = '') {
    try {
        // Notifications have a light background, so the white icon shows as black there.
        const { iconColor } = await readSettings();
        const id = await chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL(iconColor === 'blue' ? 'images/bookmark_256b.png' : 'images/bookmark_256.png'),
            title,
            message,
            contextMessage,
            silent: true,
        });
        if (target) {
            const { notificationTargets = {} } = (await chrome.storage.session.get('notificationTargets'));
            const kept = Object.entries(notificationTargets).slice(1 - MAX_NOTIFICATION_TARGETS);
            await chrome.storage.session.set({ notificationTargets: Object.fromEntries([...kept, [id, target]]) });
        }
        return id;
    }
    catch (error) {
        // The badge already shows the outcome.
        console.warn('notification failed:', error);
        return null;
    }
}
async function setBadge(text, color, clearLater = true) {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    if (!clearLater) {
        return;
    }
    setTimeout(() => {
        // Only clear the badge this call set, not one from a later send.
        void chrome.action.getBadgeText({}).then(async (current) => {
            if (current === text) {
                await chrome.action.setBadgeText({ text: '' });
            }
        });
    }, BADGE_MS);
}
async function applyIcon() {
    const { iconColor } = await readSettings();
    await chrome.action.setIcon({ path: iconPaths(iconColor) });
}
