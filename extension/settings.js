// Preferences sync across browser profiles. Capture drafts and bearer tokens do not.
export async function readSettings() {
    const stored = await chrome.storage.sync.get(['tasklist', 'dueDays', 'duedate', 'iconColor', 'color', 'reviewBeforeSend']);
    return {
        taskList: stored.tasklist ?? '',
        dueDays: stored.dueDays !== undefined ? stored.dueDays : legacyDueDays(stored.duedate),
        iconColor: stored.iconColor ?? (stored.color === 'white' ? 'white' : 'black'),
        reviewBeforeSend: stored.reviewBeforeSend === true,
    };
}
function legacyDueDays(duedate) {
    const days = Number(duedate);
    return Number.isInteger(days) && days > 0 ? days : null;
}
export function saveTaskList(id) { return chrome.storage.sync.set({ tasklist: id }); }
export function saveDueDays(days) { return chrome.storage.sync.set({ dueDays: days }); }
export function saveIconColor(color) { return chrome.storage.sync.set({ iconColor: color }); }
export function saveReviewBeforeSend(enabled) { return chrome.storage.sync.set({ reviewBeforeSend: Boolean(enabled) }); }
const ICON_SUFFIX = { black: '', white: 'w', blue: 'b' };
export function iconPaths(color) {
    const suffix = ICON_SUFFIX[color] ?? '';
    return Object.fromEntries([16, 32, 48, 128].map((size) => [size, `images/bookmark_${size}${suffix}.png`]));
}
