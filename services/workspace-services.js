/**
 * ═══════════════════════════════════════════════════════════════
 * JURIA WORKSPACE SERVICES
 * ═══════════════════════════════════════════════════════════════
 * Couche d'abstraction pour Favoris, Récents, Command Palette, Workspace
 * Implémentation avec localStorage, extensible vers Supabase
 */

// ─ CONSTANTES DE STOCKAGE
const FAVORITES_KEY = 'juria.favorites.v1';
const RECENTS_KEY = 'juria.recents.v1';
const WORKSPACE_TAB_MEMORY_KEY = 'juria.workspace.tabs.v1';

// ─ HELPERS LOCALSTORAGE
function _storageGet(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch (e) {
    console.warn(`[storage] Erreur lecture ${key}:`, e);
    return null;
  }
}

function _storageSave(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`[storage] Erreur écriture ${key}:`, e);
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. FAVORITES SERVICE
// ═══════════════════════════════════════════════════════════════

const FavoritesService = {
  /**
   * Liste les dossiers favoris (dossiers principaux uniquement).
   * @returns {Array<string>} Liste des folder IDs favoris, dans l'ordre
   */
  list: function() {
    const favs = _storageGet(FAVORITES_KEY) || [];
    // Filtrer les dossiers qui existent toujours et qui ne sont pas des sous-dossiers
    return favs.filter(folderId => {
      const f = typeof allFolders !== 'undefined' ? allFolders.find(ff => ff.id === folderId) : null;
      return f && !f.parent_id;
    });
  },

  /**
   * Ajoute/retire un dossier des favoris (bascule).
   * @param {string} folderId - Dossier à basculer
   * @returns {boolean} Nouvel état (true = favori)
   */
  toggle: function(folderId) {
    const folder = typeof allFolders !== 'undefined' ? allFolders.find(f => f.id === folderId) : null;
    if (!folder || folder.parent_id) return false; // Pas de favoris pour les sous-dossiers
    
    let favs = _storageGet(FAVORITES_KEY) || [];
    const isFav = favs.includes(folderId);
    
    if (isFav) {
      favs = favs.filter(id => id !== folderId);
    } else {
      favs = [folderId, ...favs]; // Ajouter en tête
    }
    
    _storageSave(FAVORITES_KEY, favs);
    return !isFav; // Nouvel état
  },

  /**
   * Test rapide : ce dossier est-il favori?
   */
  isFavorite: function(folderId) {
    const favs = _storageGet(FAVORITES_KEY) || [];
    return favs.includes(folderId);
  },

  /**
   * Nettoie les favoris qui n'existent plus.
   */
  cleanup: function() {
    const favs = _storageGet(FAVORITES_KEY) || [];
    const valid = favs.filter(folderId => {
      const f = typeof allFolders !== 'undefined' ? allFolders.find(ff => ff.id === folderId) : null;
      return f && !f.parent_id;
    });
    _storageSave(FAVORITES_KEY, valid);
  }
};

// ═══════════════════════════════════════════════════════════════
// 2. RECENT WORKSPACES SERVICE
// ═══════════════════════════════════════════════════════════════

const RecentWorkspacesService = {
  /**
   * Liste les Workspaces visités récemment (max `limit`, dossiers principaux uniquement).
   * @param {number} limit - Max nombre d'entrées (défaut 5)
   * @returns {Array<{folderId, openedAt}>}
   */
  list: function(limit = 5) {
    const recents = _storageGet(RECENTS_KEY) || [];
    const favs = FavoritesService.list();
    
    return recents
      .filter(item => {
        const f = typeof allFolders !== 'undefined' ? allFolders.find(ff => ff.id === item.folderId) : null;
        return f && !f.parent_id;
      })
      .filter(item => !favs.includes(item.folderId)) // Pas de duplication avec favoris
      .slice(0, limit);
  },

  /**
   * Enregistre une visite d'un Workspace.
   * @param {string} folderId - Dossier visité
   */
  record: function(folderId) {
    const folder = typeof allFolders !== 'undefined' ? allFolders.find(f => f.id === folderId) : null;
    if (!folder || folder.parent_id) return; // Pas d'enregistrement pour les sous-dossiers
    
    let recents = _storageGet(RECENTS_KEY) || [];
    // Supprimer si déjà présent
    recents = recents.filter(item => item.folderId !== folderId);
    // Ajouter en tête
    recents.unshift({ folderId, openedAt: new Date().toISOString() });
    // Limiter à 20
    recents = recents.slice(0, 20);
    
    _storageSave(RECENTS_KEY, recents);
  },

  /**
   * Nettoie les entrées dont le dossier a été supprimé.
   */
  cleanup: function() {
    const recents = _storageGet(RECENTS_KEY) || [];
    const valid = recents.filter(item => {
      const f = typeof allFolders !== 'undefined' ? allFolders.find(ff => ff.id === item.folderId) : null;
      return f && !f.parent_id;
    });
    _storageSave(RECENTS_KEY, valid);
  }
};

// ═══════════════════════════════════════════════════════════════
// 3. WORKSPACE SERVICE
// ═══════════════════════════════════════════════════════════════

const WorkspaceService = {
  /**
   * Charge le digest d'un Workspace : KPIs, docs récents, risques ouverts.
   * @param {string} folderId
   * @returns {Object} { kpis, recentDocs, openRisks }
   */
  getDigest: function(folderId) {
    const folder = typeof allFolders !== 'undefined' ? allFolders.find(f => f.id === folderId) : null;
    if (!folder) return null;
    
    const isMain = !folder.parent_id;
    const subs = isMain && typeof allFolders !== 'undefined'
      ? allFolders.filter(f => f.parent_id === folderId)
      : [];
    
    const relatedIds = [folderId, ...subs.map(s => s.id)];
    const docs = typeof allDocs !== 'undefined'
      ? allDocs.filter(d => relatedIds.includes(d.folder_id))
      : [];
    
    const risks = typeof allRisks !== 'undefined'
      ? allRisks.filter(r => docs.find(d => d.id === r.document_id))
      : [];
    
    const tasks = typeof allTasks !== 'undefined'
      ? allTasks.filter(t => t.folder_id === folderId && t.status !== 'done' && t.status !== 'closed')
      : [];
    
    const highRisks = risks.filter(r => r.severity === 'high' || r.severity === 'critical');
    const recentDocs = [...docs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 3);
    const openRisks = risks.filter(r => r.status !== 'closed').sort((a, b) => 
      (b.severity === 'critical' ? 2 : b.severity === 'high' ? 1 : 0) - 
      (a.severity === 'critical' ? 2 : a.severity === 'high' ? 1 : 0)
    ).slice(0, 3);

    return {
      kpis: {
        docs: docs.length,
        subs: subs.length,
        risks: highRisks.length,
        tasks: tasks.length
      },
      recentDocs,
      openRisks,
      totalRisks: risks.length,
      totalTasks: tasks.length
    };
  },

  /**
   * Prépare les suggestions IA pour ce Workspace.
   * @param {string} folderId
   * @returns {Array<string>} Suggestions pour le prompt IA
   */
  getIASuggestions: function(folderId) {
    return [
      'Quels sont les risques principaux de ce dossier?',
      'Résume les documents importés cette semaine',
      'Y a-t-il des clauses non-conformes à la loi marocaine?',
      'Quelles échéances dois-je surveiller?'
    ];
  },

  /**
   * Récupère les actions rapides disponibles pour ce Workspace.
   * @param {string} folderId
   * @returns {Array<{label, fn}>}
   */
  getQuickActions: function(folderId) {
    return [
      { label: '+ Importer un document', fn: () => openUploadModal ? openUploadModal(folderId) : null },
      { label: '+ Créer une tâche', fn: () => openTaskModal ? openTaskModal(null, null, folderId) : null },
      { label: '? Poser une question', fn: () => wsAskIA ? wsAskIA() : null }
    ];
  }
};

// ═══════════════════════════════════════════════════════════════
// 4. COMMAND PALETTE SERVICE
// ═══════════════════════════════════════════════════════════════

const CommandPaletteService = {
  /**
   * Suggestions rapides (favoris + actions).
   * Affichées quand on ouvre la palette sans rien taper.
   * @returns {Array<{groups: Array}>}
   */
  quickSuggestions: function() {
    const groups = [];
    
    // Groupe 1: Favoris
    const favs = FavoritesService.list();
    if (favs.length) {
      groups.push({
        label: 'Favoris',
        items: favs.map(folderId => {
          const f = typeof allFolders !== 'undefined' ? allFolders.find(ff => ff.id === folderId) : null;
          return {
            icon: '📁',
            title: f ? f.name : '?',
            sub: '',
            type: 'Favori',
            fn: () => openWorkspace ? openWorkspace(folderId) : null
          };
        })
      });
    }
    
    // Groupe 2: Actions courantes
    groups.push({
      label: 'Actions',
      items: [
        { icon: '📄', title: 'Importer un document', type: 'Action', fn: () => openUploadModal ? openUploadModal() : null },
        { icon: '📁', title: 'Créer un dossier', type: 'Action', fn: () => openFolderModal ? openFolderModal() : null },
        { icon: '✅', title: 'Créer une tâche', type: 'Action', fn: () => openTaskModal ? openTaskModal() : null },
        { icon: '▦', title: 'Vue portefeuille', type: 'Action', fn: () => openPortfolio ? openPortfolio() : null },
        { icon: '📚', title: 'Bibliothèque juridique', type: 'Action', fn: () => window.location.href = 'base-juridique.html' }
      ]
    });
    
    return groups;
  },

  /**
   * Cherche dans tous les items (dossiers, documents, risques, tâches, contreparties).
   * @param {string} q - Requête de recherche
   * @returns {Array<{groups: Array}>}
   */
  search: function(q) {
    if (!q || !q.trim()) {
      return CommandPaletteService.quickSuggestions();
    }
    
    const ql = q.toLowerCase();
    const groups = [];
    
    // Dossiers principaux
    const folders = typeof allFolders !== 'undefined'
      ? allFolders.filter(f => !f.parent_id && f.name.toLowerCase().includes(ql)).slice(0, 6)
      : [];
    if (folders.length) {
      groups.push({
        label: 'Dossiers',
        items: folders.map(f => ({
          icon: '📁',
          title: f.name,
          sub: '',
          type: 'Dossier',
          fn: () => openWorkspace ? openWorkspace(f.id) : null
        }))
      });
    }
    
    // Documents
    const docs = typeof allDocs !== 'undefined'
      ? allDocs.filter(d => d.name.toLowerCase().includes(ql)).slice(0, 6)
      : [];
    if (docs.length) {
      groups.push({
        label: 'Documents',
        items: docs.map(d => {
          const folder = typeof allFolders !== 'undefined' ? allFolders.find(f => f.id === d.folder_id) : null;
          return {
            icon: '📄',
            title: d.name,
            sub: folder ? folder.name : '',
            type: 'Document',
            fn: () => openWorkspace && folder ? (openWorkspace(folder.id), setTimeout(() => wsSwitchTab('docs'), 50)) : null
          };
        })
      });
    }
    
    // Risques
    const risks = typeof allRisks !== 'undefined'
      ? allRisks.filter(r => (r.title || '').toLowerCase().includes(ql)).slice(0, 6)
      : [];
    if (risks.length) {
      groups.push({
        label: 'Risques',
        items: risks.map(r => {
          const doc = typeof allDocs !== 'undefined' ? allDocs.find(d => d.id === r.document_id) : null;
          const folder = doc && typeof allFolders !== 'undefined' ? allFolders.find(f => f.id === doc.folder_id) : null;
          return {
            icon: '⚠️',
            title: r.title || 'Risque',
            sub: folder ? folder.name : '',
            type: 'Risque',
            fn: () => folder && openWorkspace ? (openWorkspace(folder.id), setTimeout(() => wsSwitchTab('risks'), 50)) : null
          };
        })
      });
    }
    
    // Tâches
    const tasks = typeof allTasks !== 'undefined'
      ? allTasks.filter(t => (t.title || '').toLowerCase().includes(ql)).slice(0, 6)
      : [];
    if (tasks.length) {
      groups.push({
        label: 'Tâches',
        items: tasks.map(t => {
          const folder = t.folder_id && typeof allFolders !== 'undefined' ? allFolders.find(f => f.id === t.folder_id) : null;
          return {
            icon: '✅',
            title: t.title || 'Tâche',
            sub: folder ? folder.name : '',
            type: 'Tâche',
            fn: () => folder && openWorkspace ? (openWorkspace(folder.id), setTimeout(() => wsSwitchTab('tasks'), 50)) : null
          };
        })
      });
    }
    
    // Contreparties
    const cps = typeof allCounterparties !== 'undefined'
      ? allCounterparties.filter(c => c.name.toLowerCase().includes(ql)).slice(0, 5)
      : [];
    if (cps.length) {
      groups.push({
        label: 'Contreparties',
        items: cps.map(c => ({
          icon: '🏢',
          title: c.name,
          sub: '',
          type: 'Contrepartie',
          fn: () => showPage ? showPage('dossiers') : null
        }))
      });
    }
    
    // Bibliothèque juridique
    if (ql) {
      groups.push({
        label: 'Bibliothèque juridique',
        items: [{
          icon: '📚',
          title: `Chercher « ${q} » dans la loi`,
          sub: '',
          type: 'Loi',
          fn: () => window.location.href = 'base-juridique.html?q=' + encodeURIComponent(q)
        }]
      });
    }
    
    return groups;
  }
};

// ═══════════════════════════════════════════════════════════════
// 5. WORKSPACE TAB MEMORY
// ═══════════════════════════════════════════════════════════════

const WorkspaceTabMemory = {
  /**
   * Sauvegarde l'onglet actif pour un Workspace donné.
   * @param {string} folderId
   * @param {string} tabName
   */
  save: function(folderId, tabName) {
    const memory = _storageGet(WORKSPACE_TAB_MEMORY_KEY) || {};
    memory[folderId] = tabName;
    _storageSave(WORKSPACE_TAB_MEMORY_KEY, memory);
  },

  /**
   * Récupère l'onglet mémorisé pour un Workspace (ou défaut 'overview').
   * @param {string} folderId
   * @returns {string} Nom de l'onglet
   */
  get: function(folderId) {
    const memory = _storageGet(WORKSPACE_TAB_MEMORY_KEY) || {};
    return memory[folderId] || 'overview';
  },

  /**
   * Nettoie les entrées pour les dossiers supprimés.
   */
  cleanup: function() {
    const memory = _storageGet(WORKSPACE_TAB_MEMORY_KEY) || {};
    const valid = {};
    Object.keys(memory).forEach(folderId => {
      const f = typeof allFolders !== 'undefined' ? allFolders.find(ff => ff.id === folderId) : null;
      if (f) valid[folderId] = memory[folderId];
    });
    _storageSave(WORKSPACE_TAB_MEMORY_KEY, valid);
  }
};

// ═══════════════════════════════════════════════════════════════
// 6. INIT AUTOMATIQUE DES SERVICES
// ═══════════════════════════════════════════════════════════════

function initWorkspaceServices() {
  FavoritesService.cleanup();
  RecentWorkspacesService.cleanup();
  WorkspaceTabMemory.cleanup();
}

// Appel auto au chargement
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initWorkspaceServices);
}
