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

  // ── Nom de fichier sûr pour Supabase Storage ──────────────────────────
  // Storage rejette les clés contenant des caractères non-ASCII (« é » →
  // "Invalid key"). On translittère les accents et on ne garde que
  // [a-zA-Z0-9._-]. Le nom AFFICHÉ (colonne documents.name) reste l'original ;
  // seul le CHEMIN de stockage passe par ici.
  window.sanitizeStorageName = function(filename) {
    if (!filename) return 'document';
    var dot = filename.lastIndexOf('.');
    var name = dot > 0 ? filename.slice(0, dot) : filename;
    var ext  = dot > 0 ? filename.slice(dot) : '';
    var clean = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9\-_.]/g, '')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .substring(0, 200);
    ext = ext.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9.]/g, '');
    return (clean || 'document') + ext;
  };

  // ── Design system : une pastille de compteur vide (0 / —) est du bruit.
  //    On la marque [data-empty] pour que juria-ui.css la masque, quel que
  //    soit le code qui la met à jour (observation continue du DOM).
  function tagEmptyCounts(root) {
    root.querySelectorAll('.nav-count, .nav-badge-red').forEach(function(el) {
      var t = el.textContent.trim();
      if (t === '0' || t === '—' || t === '-' || t === '') el.setAttribute('data-empty', '');
      else el.removeAttribute('data-empty');
    });
  }
  document.addEventListener('DOMContentLoaded', function() {
    tagEmptyCounts(document);
    new MutationObserver(function() { tagEmptyCounts(document); })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
  });
})();
