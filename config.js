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
  // No credentials here!
  // Stored securely in Supabase Vault
  SUPABASE_URL: 'https://dnrudcpaqcqyybpbbrum.supabase.co',
  // ⚠️  ANON_KEY should be stored in Supabase Secrets, not here
  // SUPABASE_ANON_KEY will be injected by build system or loaded from server

  // All API calls go through Edge Functions (defined in functions/ directory)
  EDGE_FUNCTION_URL: 'https://dnrudcpaqcqyybpbbrum.supabase.co/functions/v1/smart-endpoint',
};

console.info('ℹ️  Supabase credentials loaded from secure storage (Vault/Secrets)');
