// Options page: the task list to send to, the default due date, and the toolbar icon.
// Every control saves as soon as it changes.
import { signOut, SignInError } from './auth.js';
import { readSettings, saveDueDays, saveIconColor, saveTaskList, saveReviewBeforeSend } from './settings.js';
import { listTaskLists, withToken } from './tasks.js';
const listsEl = document.querySelector('#tasklists');
const statusEl = document.querySelector('#tasklist-status');
const signInButton = document.querySelector('#signin');
const signOutButton = document.querySelector('#signout');
const dueSelect = document.querySelector('#duedays');
const diagnosticsEl = document.querySelector('#diagnostics');
const copyButton = document.querySelector('#copy');
const reviewCheckbox = document.querySelector('#review-before-send');
const reviewStatus = document.querySelector('#review-saved');
const settings = await readSettings();
// Opening the page only signs in silently; a sign-in window waits for the button.
async function showTaskLists(interactive) {
    statusEl.textContent = 'Loading your task lists…';
    signInButton.hidden = true;
    signOutButton.hidden = true;
    try {
        const lists = await withToken(listTaskLists, interactive);
        listsEl.replaceChildren(radio('', 'The first list in your account', settings.taskList === ''), ...lists.map((list) => radio(list.id, list.title, list.id === settings.taskList)));
        statusEl.textContent = '';
        signOutButton.hidden = false;
    }
    catch (error) {
        if (error instanceof SignInError) {
            statusEl.textContent = error.message;
            signInButton.hidden = false;
            signOutButton.hidden = false;
            return;
        }
        statusEl.textContent = error instanceof Error ? error.message : String(error);
    }
}
function radio(id, title, checked) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'tasklist';
    input.checked = checked;
    input.addEventListener('change', () => void saveTaskList(id));
    label.append(input, title);
    return label;
}
signInButton.addEventListener('click', () => void showTaskLists(true));
signOutButton.addEventListener('click', async () => {
    signOutButton.disabled = true;
    try {
        const result = await signOut();
        listsEl.replaceChildren();
        statusEl.textContent = result.revocationAttempted
            ? 'Signed out locally. Google was sent a revocation request, but its result cannot be verified. Confirm removal in Google Account connections.'
            : 'Signed out locally. Google authorization may still be active. Remove the app in Google Account connections.';
        settings.taskList = '';
        signOutButton.hidden = true;
        signInButton.hidden = false;
    } catch (error) {
        statusEl.textContent = `Could not finish signing out: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
        signOutButton.disabled = false;
    }
});
void showTaskLists(false);
// Days that aren't in the menu, from older versions' free-form box, get their own entry.
if (settings.dueDays !== null && !dueSelect.querySelector(`option[value="${settings.dueDays}"]`)) {
    dueSelect.add(new Option(`in ${settings.dueDays} days`, String(settings.dueDays)));
}
dueSelect.value = settings.dueDays === null ? '' : String(settings.dueDays);
dueSelect.addEventListener('change', () => void saveDueDays(dueSelect.value === '' ? null : Number(dueSelect.value)));
for (const input of document.querySelectorAll('input[name="icon"]')) {
    input.checked = input.value === settings.iconColor;
    input.addEventListener('change', () => void saveIconColor(input.value));
}
const { lastSend } = (await chrome.storage.local.get('lastSend'));
diagnosticsEl.textContent = [
    `Send to Google Tasks ${chrome.runtime.getManifest().version}`,
    navigator.userAgent,
    `Last send: ${lastSend ? `${lastSend.at} ${lastSend.result}` : 'none yet'}`,
].join('\n');
copyButton.addEventListener('click', () => void navigator.clipboard.writeText(diagnosticsEl.textContent ?? ''));

reviewCheckbox.checked = settings.reviewBeforeSend;
reviewCheckbox.addEventListener('change', async () => {
    reviewCheckbox.disabled = true;
    try {
        await saveReviewBeforeSend(reviewCheckbox.checked);
        reviewStatus.textContent = reviewCheckbox.checked ? 'Review is on. Every capture opens an editor.' : 'Review is off. Tasks are sent directly.';
    } catch (error) {
        reviewCheckbox.checked = !reviewCheckbox.checked;
        reviewStatus.textContent = `Could not save preference: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
        reviewCheckbox.disabled = false;
    }
});
