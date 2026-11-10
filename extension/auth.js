// Google Tasks authentication. Never silently switch identity providers after a web
// account has been selected. OAuth access tokens live only in storage.session.
const SCOPE = 'https://www.googleapis.com/auth/tasks';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const WEB_CLIENT_ID = '639946696688-o895ocvjk5dq1ra0ggmh81dg4u140985.apps.googleusercontent.com';
const EXPIRY_MARGIN_MS = 60_000;
const CHOOSE_ACCOUNT = 'chooseAccount';
const AUTH_MODE = 'authMode';

export class SignInError extends Error {}

let silentPending = null;
let interactivePending = null;

// An explicit interactive request may escalate a simultaneously running silent
// attempt. It must not inherit a silent failure and silently suppress the window.
export function getToken(interactive = true) {
    if (interactive) {
        if (!interactivePending) {
            interactivePending = (async () => {
                if (silentPending) {
                    try {
                        return await silentPending;
                    } catch (error) {
                        if (!(error instanceof SignInError)) throw error;
                    }
                }
                return findToken(true);
            })().finally(() => { interactivePending = null; });
        }
        return interactivePending;
    }
    if (interactivePending) return interactivePending;
    if (!silentPending) {
        silentPending = findToken(false).finally(() => { silentPending = null; });
    }
    return silentPending;
}

async function findToken(interactive) {
    const { chooseAccount, authMode } = await chrome.storage.local.get([CHOOSE_ACCOUNT, AUTH_MODE]);
    if (chooseAccount) return chooseInWindow(interactive);

    // A web-selected account MUST NOT be silently replaced by the browser's
    // default Chrome/Opera account after token expiry or after browser restart.
    if (authMode === 'web') {
        const token = await freshSessionToken();
        return token ? { value: token, source: 'web' } : chooseInWindow(interactive);
    }
    if (authMode === 'chrome') {
        const token = await chromeToken();
        if (token) return { value: token, source: 'chrome' };
        return chooseInWindow(interactive);
    }

    // Upgrade path from older releases, for browser profiles with existing grants.
    const fromChrome = await chromeToken();
    if (fromChrome) {
        await chrome.storage.local.set({ [AUTH_MODE]: 'chrome' });
        return { value: fromChrome, source: 'chrome' };
    }
    if (!interactive) throw new SignInError('Choose a Google account to continue');
    return chooseInWindow(true);
}

async function chooseInWindow(interactive) {
    if (!interactive) throw new SignInError('Choose a Google account to continue');
    const token = await webSignIn();
    await chrome.storage.local.set({ [AUTH_MODE]: 'web', [CHOOSE_ACCOUNT]: false });
    return { value: token, source: 'web' };
}

export async function forgetToken(token) {
    if (token.source === 'chrome') {
        await chrome.identity.removeCachedAuthToken({ token: token.value });
        return;
    }
    const { webToken } = await chrome.storage.session.get('webToken');
    if (webToken?.value === token.value) await chrome.storage.session.remove('webToken');
}

// Local sign-out is reliable; remote OAuth grant revocation cannot be verified
// from an extension's no-CORS request. Never tell the user it was confirmed.
export async function signOut() {
    const { authMode } = await chrome.storage.local.get(AUTH_MODE);
    let token = null;
    if (authMode === 'web') token = await freshSessionToken();
    if (authMode === 'chrome') token = await chromeToken();

    // Clear state even when offline or the remote revocation request fails.
    await chrome.storage.local.set({ [CHOOSE_ACCOUNT]: true });
    await chrome.storage.local.remove([AUTH_MODE, 'accountAnchor']);
    await chrome.storage.session.remove('webToken');
    // A list belongs to an account, so it must not be carried into a new login.
    await chrome.storage.sync.remove('tasklist');
    await chrome.identity.clearAllCachedAuthTokens();

    let revocationAttempted = false;
    if (token) {
        try {
            // URL-encoded POST body instead of a token in the query string.
            await fetch(REVOKE_URL, {
                method: 'POST', mode: 'no-cors',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token }),
            });
            revocationAttempted = true;
        } catch (error) {
            console.warn('OAuth revocation request could not be sent:', error);
        }
    }
    return { localSignedOut: true, revocationAttempted, revocationVerified: false };
}

async function freshSessionToken() {
    const { webToken } = await chrome.storage.session.get('webToken');
    return webToken && webToken.expiresAt - EXPIRY_MARGIN_MS > Date.now() ? webToken.value : null;
}

async function chromeToken() {
    try {
        const response = await chrome.identity.getAuthToken({ interactive: false, scopes: [SCOPE] });
        return response?.token || null;
    } catch {
        return null;
    }
}

function nonce() {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function webSignIn() {
    const redirectUri = chrome.identity.getRedirectURL('oauth2');
    const expectedState = nonce();
    const params = new URLSearchParams({
        client_id: WEB_CLIENT_ID,
        response_type: 'token',
        redirect_uri: redirectUri,
        scope: SCOPE,
        state: expectedState,
        prompt: 'select_account',
    });
    let redirect;
    try {
        redirect = await chrome.identity.launchWebAuthFlow({
            interactive: true,
            url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
        });
    } catch (error) {
        throw new SignInError(error instanceof Error ? error.message : String(error));
    }

    let returned;
    try { returned = new URL(redirect); }
    catch { throw new SignInError('Invalid Google sign-in response'); }
    const expected = new URL(redirectUri);
    if (returned.origin !== expected.origin || returned.pathname !== expected.pathname || returned.search !== expected.search) {
        throw new SignInError('Google sign-in redirect did not match this extension');
    }
    const fragment = new URLSearchParams(returned.hash.slice(1));
    if (fragment.getAll('state').length !== 1 || fragment.get('state') !== expectedState) {
        throw new SignInError('Google sign-in state verification failed');
    }
    const value = fragment.get('access_token');
    if (!value) throw new SignInError(fragment.get('error') ?? 'No access token in Google sign-in response');
    if (fragment.get('token_type') && fragment.get('token_type')?.toLowerCase() !== 'bearer') {
        throw new SignInError('Google returned an unexpected token type');
    }
    const expiresIn = Number(fragment.get('expires_in'));
    const lifetime = Number.isFinite(expiresIn) && expiresIn > 0 ? Math.min(expiresIn, 3600) : 3600;
    await chrome.storage.session.set({ webToken: { value, expiresAt: Date.now() + lifetime * 1000 } });
    return value;
}
