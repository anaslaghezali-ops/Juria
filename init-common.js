/**
 * JURIA — Common Initialization
 * Centralized setup for Supabase client and global config
 * Load this AFTER config.js in every HTML file
 */

(function() {
  'use strict';

  // Vérifier que config.js est chargé
  if (typeof JURIA_CONFIG === 'undefined') {
    console.error('[init-common] config.js must be loaded first');
    return;
  }

  // Vérifier que Supabase est disponible
  if (typeof window.supabase === 'undefined') {
    console.error('[init-common] @supabase/supabase-js must be loaded first');
    return;
  }

  // ✅ Créer le client Supabase global une seule fois
  window._sb = window.supabase.createClient(
    JURIA_CONFIG.SUPABASE_URL,
    JURIA_CONFIG.SUPABASE_ANON_KEY
  );

  // Exposer globalement pour compatibilité
  window.CONFIG = JURIA_CONFIG;

  console.log('[init-common] Supabase client initialized');
})();
