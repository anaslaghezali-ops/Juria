/**
 * JURIA — Rate Limiting Utilities
 * Client-side rate limiting to prevent spam and overload
 */

/**
 * Debounce: delay execution until N milliseconds have passed without call
 * @param {Function} fn
 * @param {number} delay milliseconds
 * @returns {Function}
 */
function debounce(fn, delay) {
  let timeout;
  return function debounced(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Throttle: execute at most once per N milliseconds
 * @param {Function} fn
 * @param {number} delay milliseconds
 * @returns {Function}
 */
function throttle(fn, delay) {
  let lastCall = 0;
  return function throttled(...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      return fn.apply(this, args);
    }
  };
}

/**
 * Rate limit: allow max N calls per M milliseconds
 * @param {Function} fn
 * @param {number} maxCalls
 * @param {number} intervalMs
 * @returns {Function}
 */
function rateLimit(fn, maxCalls, intervalMs) {
  let calls = [];
  return async function limited(...args) {
    const now = Date.now();
    calls = calls.filter(t => now - t < intervalMs);

    if (calls.length >= maxCalls) {
      console.warn(`[RateLimit] Exceeded: ${maxCalls} calls per ${intervalMs}ms`);
      return;
    }

    calls.push(now);
    return fn.apply(this, args);
  };
}

/**
 * Once: execute function only once, ignore subsequent calls
 * @param {Function} fn
 * @returns {Function}
 */
function once(fn) {
  let called = false;
  let result;
  return function(...args) {
    if (!called) {
      called = true;
      result = fn.apply(this, args);
    }
    return result;
  };
}
