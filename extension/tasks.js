// Turning a page or link into a Google Tasks task, and the two Tasks API calls the
// extension makes.
import { forgetToken, getToken, SignInError } from './auth.js';
const API = 'https://tasks.googleapis.com/tasks/v1/';
// Google rejects a task whose title or notes run past these lengths, so they are cut here.
const MAX_TITLE = 1024;
const MAX_NOTES = 8192;
// Why a send failed, in words the notification can show.
export class SendError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
export function buildTask(item, dueDays, now) {
    const title = cut(item.title?.trim() || item.url, MAX_TITLE);
    const selection = item.selection?.trim();
    const notes = cut(selection ? `${item.url}\n\n"${selection}"` : item.url, MAX_NOTES);
    const task = { title, notes, status: 'needsAction' };
    if (dueDays !== null) {
        task.due = dueDate(dueDays, now);
    }
    return task;
}
// A reviewed task is constructed only from explicit editor inputs. No HTML,
// query string, or URL containing task contents is used for transmission.
export function buildEditedTask(input) {
    if (!input || typeof input !== 'object') throw new SendError('Invalid task draft.');
    if (typeof input.title !== 'string' || !input.title.trim()) throw new SendError('Enter a task title.');
    if (typeof input.notes !== 'string') throw new SendError('Invalid task details.');
    if (Array.from(input.title).length > MAX_TITLE) throw new SendError('Title is too long (maximum 1024 characters).');
    if (Array.from(input.notes).length > MAX_NOTES) throw new SendError('Details are too long (maximum 8192 characters).');
    const task = { title: input.title.trim(), notes: input.notes, status: 'needsAction' };
    if (input.date !== '') {
        if (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
            throw new SendError('Choose a valid due date.');
        }
        const [year, month, day] = input.date.split('-').map(Number);
        const check = new Date(Date.UTC(year, month - 1, day));
        if (year < 1900 || year > 9999 || check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
            throw new SendError('Choose a valid due date.');
        }
        task.due = `${input.date}T00:00:00.000Z`;
    }
    return task;
}

// Cuts by characters rather than UTF-16 units, so an emoji is never split in half.
function cut(text, max) {
    const chars = Array.from(text);
    return chars.length <= max ? text : chars.slice(0, max - 1).join('') + '…';
}
// Google Tasks keeps only the date of "due" and reads it as UTC, so the local calendar date
// goes in as UTC midnight. Building it from local parts keeps "today" right near midnight.
export function dueDate(days, now) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
    const pad = (n) => String(n).padStart(2, '0');
    return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T00:00:00.000Z`;
}
// Runs one or more API calls with a single token. A rejected token is dropped and the calls
// run once more with a fresh one, which may mean one sign-in window.
export async function withToken(calls, interactive = true) {
    const token = await getToken(interactive);
    try {
        return await calls(token.value);
    }
    catch (error) {
        if (!(error instanceof ExpiredToken)) {
            throw error;
        }
        await forgetToken(token);
        const fresh = await getToken(interactive);
        try {
            return await calls(fresh.value);
        }
        catch (retryError) {
            if (retryError instanceof ExpiredToken) {
                throw new SignInError('Google rejected the sign-in twice');
            }
            throw retryError;
        }
    }
}
class ExpiredToken extends Error {
}
async function call(token, path, init = {}) {
    let response;
    try {
        response = await fetch(API + path, {
            ...init,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
    }
    catch {
        throw new SendError("Couldn't reach Google Tasks. Check your connection and try again.");
    }
    if (response.status === 401) {
        throw new ExpiredToken();
    }
    if (!response.ok) {
        const advice = response.status >= 500 || response.status === 429 ? ' Try again in a minute.' : '';
        const reason = await errorReason(response);
        throw new SendError(`Google Tasks turned the request down (HTTP ${response.status}${reason ? `, ${reason}` : ''}).${advice}`, response.status);
    }
    return (await response.json());
}
// Google's error body names the cause, such as accessNotConfigured or rateLimitExceeded,
// which tells a 403 from the API being off apart from one for a missing scope.
async function errorReason(response) {
    try {
        const body = (await response.json());
        return body.error?.errors?.[0]?.reason ?? body.error?.status ?? '';
    }
    catch {
        return '';
    }
}
export async function listTaskLists(token) {
    const lists = [];
    let nextPageToken;
    let pages = 0;
    do {
        const params = new URLSearchParams({ maxResults: '1000' });
        if (nextPageToken) params.set('pageToken', nextPageToken);
        const data = await call(token, `users/@me/lists?${params}`);
        lists.push(...(data.items ?? []));
        nextPageToken = data.nextPageToken;
        if (++pages >= 100 && nextPageToken) throw new SendError('Task-list pagination exceeded a safety limit.');
    } while (nextPageToken);

    // A pinned list ID serves as a stable, low-privilege account anchor. It
    // catches browser identity changes without needing a new Google OAuth scope.
    if (lists.length) {
        const { accountAnchor } = await chrome.storage.local.get('accountAnchor');
        if (accountAnchor && !lists.some((list) => list.id === accountAnchor)) {
            throw new SignInError('Google account changed. Sign out in Options to choose another account.');
        }
        if (!accountAnchor) await chrome.storage.local.set({ accountAnchor: lists[0].id });
    }
    return lists;
}
export async function insertTask(token, taskList, task) {
    await call(token, `lists/${encodeURIComponent(taskList)}/tasks`, { method: 'POST', body: JSON.stringify(task) });
}
// The list to send to: the one picked in settings, or else the account's first list.
export async function resolveTaskList(token, chosen) {
    const lists = await listTaskLists(token);
    if (chosen) {
        if (!lists.some((list) => list.id === chosen)) {
            throw new SendError('The selected task list is not available in this account. Open Options and choose another.', 404);
        }
        return chosen;
    }
    const [first] = lists;
    if (!first) {
        throw new SendError('Your Google Tasks has no task list yet. Open Google Tasks once to create one, then try again.');
    }
    return first.id;
}
// Google's Tasks page for a list. List ids are base64 of the id the web app uses.
export function taskListPage(taskList) {
    try {
        return `https://tasks.google.com/embed/list/${atob(taskList)}?origin=https://calendar.google.com&fullWidth=1`;
    }
    catch {
        return 'https://tasks.google.com/';
    }
}
