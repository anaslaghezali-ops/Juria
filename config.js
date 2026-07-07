// ================================================
// JURIA — CONFIGURATION GLOBALE
// ================================================
// Load Supabase config from window._SECRETS (set by secrets.js)
// secrets.js must be loaded BEFORE this file

const JURIA_CONFIG = {
  SUPABASE_URL: 'https://dnrudcpaqcqyybpbbrum.supabase.co',
  // SUPABASE_ANON_KEY loaded from secrets.js below
  SUPABASE_ANON_KEY: undefined,

  EDGE_FUNCTION_URL: 'https://dnrudcpaqcqyybpbbrum.supabase.co/functions/v1/smart-endpoint',
  CHAT_DOC_URL: 'https://dnrudcpaqcqyybpbbrum.supabase.co/functions/v1/chat-with-doc',
};

// Load ANON_KEY from window._SECRETS (populated by secrets.js)
if (typeof window._SECRETS !== 'undefined' && window._SECRETS.SUPABASE_ANON_KEY) {
  JURIA_CONFIG.SUPABASE_ANON_KEY = window._SECRETS.SUPABASE_ANON_KEY;
  console.info('✅ Supabase ANON_KEY loaded from secrets.js');
} else {
  console.error('❌ SUPABASE_ANON_KEY not found! Make sure secrets.js is loaded before config.js');
}
