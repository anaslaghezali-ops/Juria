/**
 * JURIA — Safe Fetch Wrapper
 * Handles timeouts, error checking, and proper JSON parsing
 */

async function fetchSafe(url, options = {}) {
  const timeout = options.timeout || 15000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    // ✅ Check res.ok before parsing JSON
    if (!res.ok) {
      const error = await res.text();
      console.error(`[fetchSafe] ${res.status} ${url}`, error);
      throw new Error(`API Error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return data;

  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      console.error(`[fetchSafe] Timeout (${timeout}ms): ${url}`);
      throw new Error('Délai d\'attente dépassé. Veuillez réessayer.');
    }

    console.error(`[fetchSafe] ${url}`, err.message);
    throw err;

  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Escape HTML to prevent XSS in content
 */
function escapeHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Échappe une chaîne pour utilisation sécurisée en attribut HTML (onclick, href, etc).
 * Prévient les injections XSS via les événements.
 * @param {string} str - Chaîne à échapper
 * @returns {string} - Chaîne échappée sûre pour les attributs
 */
function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Safely set HTML content with basic sanitization
 */
function safeSetHTML(el, html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // Remove dangerous tags
  doc.querySelectorAll('script, iframe, embed, object, form, input, button').forEach(el => el.remove());
  
  // Remove on* attributes
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    });
  });
  
  el.innerHTML = doc.body.innerHTML;
}
