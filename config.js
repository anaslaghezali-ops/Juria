// ================================================
// JURIA — CONFIGURATION GLOBALE
// ================================================
// ⚠️  SECURITY: Credentials hardcoded for development only
// For production deployment with build system (Vite, webpack, etc):
// 1. Use build-time environment variable injection
// 2. Never commit .env.local files
// 3. Rotate credentials after testing

const JURIA_CONFIG = {
  SUPABASE_URL:      'https://dnrudcpaqcqyybpbbrum.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRucnVkY3BhcWNxeXlicGJicnVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyODQwMjMsImV4cCI6MjA5Njg2MDAyM30.f6_byMzZBE2SQH2XjNmRQFQpRkRIfXE2OC0mNxQt5z4',
  EDGE_FUNCTION_URL: 'https://dnrudcpaqcqyybpbbrum.supabase.co/functions/v1/smart-endpoint',
};

console.warn('⚠️  Using hardcoded Supabase credentials (development only)');
