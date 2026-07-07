// ================================================
// JURIA — CONFIGURATION GLOBALE (Secure)
// ================================================
// 🔐 SECURITY: Credentials stored in Supabase Vault/Secrets
//
// Frontend NEVER has direct access to sensitive credentials.
// All sensitive operations go through Edge Functions which:
// - Load credentials from Supabase Secrets
// - Execute protected logic server-side
// - Return only safe data to client
//
// Setup: supabase secrets set SUPABASE_ANON_KEY="..."

// Load from environment variables (injected by build system or .env.local)
// For development: Create .env.local with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
const JURIA_CONFIG = {
  SUPABASE_URL: import.meta?.env?.VITE_SUPABASE_URL || 'https://dnrudcpaqcqyybpbbrum.supabase.co',
  SUPABASE_ANON_KEY: import.meta?.env?.VITE_SUPABASE_ANON_KEY || undefined,

  EDGE_FUNCTION_URL: 'https://dnrudcpaqcqyybpbbrum.supabase.co/functions/v1/smart-endpoint',
  CHAT_DOC_URL: 'https://dnrudcpaqcqyybpbbrum.supabase.co/functions/v1/chat-with-doc',
};

// Fallback for vanilla JS without build process: read from window._SECRETS
if (!JURIA_CONFIG.SUPABASE_ANON_KEY && typeof window._SECRETS !== 'undefined') {
  JURIA_CONFIG.SUPABASE_ANON_KEY = window._SECRETS.SUPABASE_ANON_KEY;
}

if (JURIA_CONFIG.SUPABASE_ANON_KEY) {
  console.info('ℹ️  Supabase credentials loaded from environment');
} else {
  console.warn('⚠️  SUPABASE_ANON_KEY not found. Create .env.local or set window._SECRETS');
}
