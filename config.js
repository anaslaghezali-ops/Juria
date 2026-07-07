// ================================================
// JURIA — CONFIGURATION GLOBALE
// ================================================
// ⚠️  SECURITY: Credentials should be loaded from environment variables, not hardcoded
// For production deployment, use build system (Vite, webpack, etc) to inject values
// See .env.example for configuration template

// Attempt to load from environment/window object (set by build system)
const SUPABASE_URL = (typeof window !== 'undefined' && window.__ENV?.SUPABASE_URL)
  || (typeof import !== 'undefined' && import.meta?.env?.VITE_SUPABASE_URL);
const SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.__ENV?.SUPABASE_ANON_KEY)
  || (typeof import !== 'undefined' && import.meta?.env?.VITE_SUPABASE_ANON_KEY);
const EDGE_FUNCTION_URL = (typeof window !== 'undefined' && window.__ENV?.EDGE_FUNCTION_URL)
  || (typeof import !== 'undefined' && import.meta?.env?.VITE_EDGE_FUNCTION_URL);

// Fallback to hardcoded values for development (temporary)
// TODO: Rotate these credentials and enforce environment-based configuration
const DEFAULT_URL = 'https://dnrudcpaqcqyybpbbrum.supabase.co';
const DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRucnVkY3BhcWNxeXlicGJicnVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyODQwMjMsImV4cCI6MjA5Njg2MDAyM30.f6_byMzZBE2SQH2XjNmRQFQpRkRIfXE2OC0mNxQt5z4';
const DEFAULT_EDGE = 'https://dnrudcpaqcqyybpbbrum.supabase.co/functions/v1/smart-endpoint';

const JURIA_CONFIG = {
  SUPABASE_URL:      SUPABASE_URL || DEFAULT_URL,
  SUPABASE_ANON_KEY: SUPABASE_ANON_KEY || DEFAULT_KEY,
  EDGE_FUNCTION_URL: EDGE_FUNCTION_URL || DEFAULT_EDGE,
};

// Warn if using fallback credentials
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    '⚠️  WARNING: Using hardcoded Supabase credentials. ' +
    'For production, set environment variables: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY'
  );
}
