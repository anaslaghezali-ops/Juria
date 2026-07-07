// ================================================
// JURIA — CONFIGURATION GLOBALE
// ================================================
// NOTE: The Supabase ANON_KEY is safe to expose in frontend code.
// It only allows access permitted by your Row-Level Security (RLS) policies.
// This is the standard, documented way to use Supabase from a browser.

const JURIA_CONFIG = {
  SUPABASE_URL:      'https://dnrudcpaqcqyybpbbrum.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRucnVkY3BhcWNxeXlicGJicnVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyODQwMjMsImV4cCI6MjA5Njg2MDAyM30.f6_byMzZBE2SQH2XjNmRQFQpRkRIfXE2OC0mNxQt5z4',
  EDGE_FUNCTION_URL: 'https://dnrudcpaqcqyybpbbrum.supabase.co/functions/v1/smart-endpoint',
  CHAT_DOC_URL:      'https://dnrudcpaqcqyybpbbrum.supabase.co/functions/v1/chat-with-doc',
};
