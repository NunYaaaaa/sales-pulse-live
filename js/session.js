// ─── SESSION STORAGE ───────────────────────────────────────────────────────
// Everything persisted for this tab lives under spl_* keys in sessionStorage.
export const session = {
  get: key        => sessionStorage.getItem(`spl_${key}`),
  set: (key, val) => sessionStorage.setItem(`spl_${key}`, val),
  remove: key     => sessionStorage.removeItem(`spl_${key}`),
  clear: ()       => sessionStorage.clear(),
};

/** Credentials needed by every API call. */
export function creds() {
  return {
    token:  session.get('token'),
    apiKey: session.get('api_key'),
    shopId: session.get('shop_id'),
  };
}
