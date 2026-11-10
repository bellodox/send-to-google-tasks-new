// Local review screen. Nothing is sent to Google until the user presses Add.
import { buildTask } from './tasks.js';

const form = document.querySelector('#task-form');
const title = document.querySelector('#title');
const notes = document.querySelector('#notes');
const due = document.querySelector('#due');
const feedback = document.querySelector('#feedback');
const submit = document.querySelector('#submit');
const draftId = new URLSearchParams(location.search).get('draft');
const draftKey = `draft:${draftId}`;

function message(text, success = false) {
    feedback.textContent = text;
    feedback.classList.toggle('success', success);
}
function disable() {
    form.querySelectorAll('input, textarea, button').forEach((el) => { el.disabled = true; });
}

if (!draftId || !/^[0-9a-f-]{36}$/i.test(draftId)) {
    disable();
    message('Invalid task draft. Capture the page again.');
} else {
    try {
        const saved = await chrome.storage.session.get(draftKey);
        const draft = saved[draftKey];
        if (!draft || Date.now() - draft.createdAt > 20 * 60_000) {
            disable();
            message('Draft expired. Capture the page again.');
        } else {
            const task = buildTask(draft.item, draft.dueDays, new Date());
            title.value = task.title;
            notes.value = task.notes;
            due.value = task.due?.slice(0, 10) ?? '';
            title.focus();
            title.select();
        }
    } catch (error) {
        disable();
        message(error instanceof Error ? error.message : String(error));
    }
}

document.querySelector('#clear-date').addEventListener('click', () => { due.value = ''; });
document.querySelector('#cancel').addEventListener('click', () => { window.close(); });
form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled || !form.reportValidity()) return;
    submit.disabled = true;
    submit.textContent = 'Adding…';
    message('Contacting Google Tasks…', true);
    try {
        const result = await chrome.runtime.sendMessage({
            type: 'submitReviewedTask',
            draftId,
            task: { title: title.value, date: due.value, notes: notes.value },
        });
        if (!result?.ok) throw new Error(result?.error || 'Google Tasks did not confirm creation.');
        message('Task created successfully.', true);
        // Closing only after the service worker confirms a successful API write.
        window.close();
    } catch (error) {
        message(error instanceof Error ? error.message : String(error));
    } finally {
        submit.disabled = false;
        submit.textContent = 'Add to Google Tasks';
    }
});
