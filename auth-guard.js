/**
 * JURIA — Authentication Guard
 * Centralized auth checks for all pages
 * Load this AFTER init-common.js
 */

/**
 * Require valid authentication session
 * Redirects to auth.html if not logged in
 * @returns {Promise<Object|null>} session object or null
 */
async function requireAuth() {
  if (!window._sb) {
    console.error('[Auth] Supabase client not initialized');
    return null;
  }

  try {
    const { data: { session }, error } = await window._sb.auth.getSession();

    if (error || !session) {
      console.warn('[Auth] No session found, redirecting to auth.html');
      window.location.href = 'auth.html';
      return null;
    }

    return session;

  } catch (err) {
    console.error('[Auth] getSession failed:', err);
    window.location.href = 'auth.html';
    return null;
  }
}

/**
 * Require auth and verify org access
 * @param {string} expectedOrgId
 * @returns {Promise<Object|null>} session object or null
 */
async function requireAuthWithOrgId(expectedOrgId) {
  const session = await requireAuth();
  if (!session) return null;

  const userOrgId = session.user?.user_metadata?.org_id;
  if (expectedOrgId && userOrgId && userOrgId !== expectedOrgId) {
    console.error('[Auth] Org ID mismatch:', expectedOrgId, 'vs', userOrgId);
    window.location.href = 'auth.html';
    return null;
  }

  return session;
}

/**
 * Sign out and redirect to auth
 */
async function signOut() {
  try {
    if (window._sb) {
      await window._sb.auth.signOut();
    }
  } catch (err) {
    console.warn('[Auth] Sign out error:', err);
  }
  window.location.href = 'auth.html';
}
