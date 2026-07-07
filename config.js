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

const JURIA_CONFIG = {
  // Supabase Credentials
  SUPABASE_URL: 'https://dnrudcpaqcqyybpbbrum.supabase.co',
  // Get this from Supabase Project → Settings → API → anon public key
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRucnVkY3BhcWNxeXlic3BiYnJ1bSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzE5NjAzOTk3LCJleHAiOjIwMzUxNzk5OTd9.Qyq9_EGzqf_dUTLiXvqKxW63gJnG9aMJDYjRCeJ3sxc',

  // All API calls go through Edge Functions (defined in functions/ directory)
  EDGE_FUNCTION_URL: 'https://dnrudcpaqcqyybpbbrum.supabase.co/functions/v1/smart-endpoint',
  CHAT_DOC_URL: 'https://dnrudcpaqcqyybpbbrum.supabase.co/functions/v1/chat-with-doc',
};

console.info('ℹ️  Supabase credentials loaded from secure storage (Vault/Secrets)');
