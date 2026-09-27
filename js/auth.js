// ─── OAUTH (PKCE) ──────────────────────────────────────────────────────────
import { ETSY_AUTH_URL, ETSY_TOKEN_URL, SCOPES } from './config.js';
import { session } from './session.js';
import { showConnect, showError, showLoading } from './ui.js';
import { sleep } from './util.js';

function base64URLEncode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function generateCodeVerifier() {
  const arr = new Uint8Array(32); crypto.getRandomValues(arr); return base64URLEncode(arr);
}
async function generateCodeChallenge(v) {
  const enc = new TextEncoder().encode(v);
  return base64URLEncode(await crypto.subtle.digest('SHA-256', enc));
}

export async function startOAuth() {
  const apiKey       = document.getElementById('api-key-input').value.trim();
  const sharedSecret = document.getElementById('shared-secret-input').value.trim();
  const redirectUri  = document.getElementById('redirect-uri-input').value.trim();
  if (!apiKey)       { showError('Please enter your Etsy API keystring.'); return; }
  if (!sharedSecret) { showError('Please enter your Etsy shared secret.'); return; }
  if (!redirectUri)  { showError('Please enter a redirect URI.'); return; }

  session.set('api_key',       apiKey);
  session.set('shared_secret', sharedSecret);
  session.set('redirect_uri',  redirectUri);

  const verifier  = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state     = base64URLEncode(crypto.getRandomValues(new Uint8Array(16)));
  session.set('verifier', verifier);
  session.set('state',    state);

  const params = new URLSearchParams({
    response_type:'code', redirect_uri:redirectUri, scope:SCOPES,
    client_id:apiKey, state, code_challenge:challenge, code_challenge_method:'S256',
  });
  window.location.href = `${ETSY_AUTH_URL}?${params}`;
}

/** Exchange the OAuth code for a token, then call onConnected(). */
export async function handleCallback(code, returnedState, onConnected) {
  const storedState = session.get('state');
  const verifier    = session.get('verifier');
  const apiKey      = session.get('api_key');
  const redirectUri = session.get('redirect_uri');
  history.replaceState({}, '', window.location.pathname); // drop ?code= from the URL right away
  if (!storedState || returnedState !== storedState) { showConnect(); showError('OAuth state mismatch — please try connecting again.'); return; }

  showLoading('Exchanging auth code…');
  try {
    const resp = await fetch(ETSY_TOKEN_URL, {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({ grant_type:'authorization_code', client_id:apiKey, redirect_uri:redirectUri, code, code_verifier:verifier }).toString(),
    });
    if (!resp.ok) { const e = await resp.json().catch(()=>({})); throw new Error(e.error_description||`Token exchange failed (${resp.status})`); }
    const data = await resp.json();
    const userId = data.access_token ? data.access_token.split('.')[0] : null;
    if (!userId || !/^\d+$/.test(userId)) throw new Error('Could not parse user ID from access token. Token format may have changed.');
    session.set('token',   data.access_token);
    session.set('user_id', userId);
    if (data.refresh_token) session.set('refresh_token', data.refresh_token);
    session.remove('verifier');
    session.remove('state');
    // Brief pause after OAuth — Worker rate-limit window resets every second
    await sleep(1200);
    await onConnected();
  } catch(e) { showConnect(); showError(`Token exchange error: ${e.message}`); }
}
