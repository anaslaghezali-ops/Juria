/**
 * JURIA — Store Central
 * Source unique de vérité pour toutes les données de l'application.
 * Maintient des indexes relationnels O(1) pour éviter les filter() en rendu.
 */

const Store = (() => {

  // ── État brut ─────────────────────────────────────────────────────────
  const state = {
    documents:      [],
    risks:          [],
    tasks:          [],
    folders:        [],
    counterparties: [],
    deadlines:      [],
    comments:       {},   // { [riskId]: Comment[] }
    history:        {},   // { [riskId]: HistoryEntry[] }
    activityLog:    [],   // ActivityEntry[]
    currentUser:    null,
    currentOrgId:   null,
  };

  // ── Indexes relationnels ──────────────────────────────────────────────
  // Tous les indexes sont reconstruits après chaque mutation de données.
  // Accès en O(1) au lieu de O(n) avec filter().
  const indexes = {
    // Lookups primaires
    docsById:              {},
    risksById:             {},
    tasksById:             {},
    foldersById:           {},
    counterpartiesById:    {},

    // Relations document
    docsByFolder:          {},   // folderId   → Document[]
    docsByCounterparty:    {},   // cpId       → Document[]

    // Relations risque
    risksByDocument:       {},   // documentId → Risk[]
    risksByFolder:         {},   // folderId   → Risk[]
    risksByCounterparty:   {},   // cpId       → Risk[]
    risksByStatus:         {},   // status     → Risk[]

    // Relations tâche
    tasksById:             {},
    tasksByRisk:           {},   // riskId     → Task[]
    tasksByFolder:         {},   // folderId   → Task[]
    tasksByCounterparty:   {},   // cpId       → Task[]
    tasksByStatus:         {},   // status     → Task[]
    tasksByAssignee:       {},   // assignee   → Task[]

    // Relations dossier ↔ contrepartie
    foldersByCounterparty: {},   // cpId       → Folder[]
  };

  // ── Reconstruction des indexes ────────────────────────────────────────
  function _buildIndexes() {
    // Reset
    Object.keys(indexes).forEach(k => { indexes[k] = {}; });

    // ── Documents ──
    state.documents.forEach(doc => {
      indexes.docsById[doc.id] = doc;

      if (doc.folder_id) {
        _push(indexes.docsByFolder, doc.folder_id, doc);
      }
      if (doc.counterparty_id) {
        _push(indexes.docsByCounterparty, doc.counterparty_id, doc);
      }
    });

    // ── Folders ──
    state.folders.forEach(f => {
      indexes.foldersById[f.id] = f;
      if (f.counterparty_id) {
        _push(indexes.foldersByCounterparty, f.counterparty_id, f);
      }
    });

    // ── Counterparties ──
    state.counterparties.forEach(cp => {
      indexes.counterpartiesById[cp.id] = cp;
    });

    // ── Risks ──
    state.risks.forEach(r => {
      indexes.risksById[r.id] = r;

      // Par document
      if (r.document_id) {
        _push(indexes.risksByDocument, r.document_id, r);
      }

      // Par dossier (via document)
      const doc = indexes.docsById[r.document_id];
      if (doc && doc.folder_id) {
        _push(indexes.risksByFolder, doc.folder_id, r);
      }

      // Par contrepartie (via document)
      if (doc && doc.counterparty_id) {
        _push(indexes.risksByCounterparty, doc.counterparty_id, r);
      }

      // Par statut
      const status = r.status || 'open';
      _push(indexes.risksByStatus, status, r);
    });

    // ── Tasks ──
    state.tasks.forEach(t => {
      indexes.tasksById[t.id] = t;

      if (t.risk_id)          _push(indexes.tasksByRisk,          t.risk_id,          t);
      if (t.folder_id)        _push(indexes.tasksByFolder,        t.folder_id,        t);
      if (t.counterparty_id)  _push(indexes.tasksByCounterparty,  t.counterparty_id,  t);
      if (t.assignee)         _push(indexes.tasksByAssignee,       t.assignee,         t);

      const status = t.status || 'todo';
      _push(indexes.tasksByStatus, status, t);
    });
  }

  // Utilitaire : push dans un index tableau
  function _push(index, key, value) {
    if (!index[key]) index[key] = [];
    index[key].push(value);
  }

  // ── Mutations d'état ──────────────────────────────────────────────────
  // Toute modification passe par ces méthodes pour garantir
  // la cohérence des indexes.

  function setDocuments(docs) {
    state.documents = docs;
    _buildIndexes();
    _log('documents_loaded', { count: docs.length });
  }

  function setRisks(risks) {
    state.risks = risks;
    // Initialiser statuts et métadonnées absents
    state.risks.forEach(r => {
      if (!r.status)   r.status   = 'open';
      if (!state.comments[r.id]) state.comments[r.id] = [];
      if (!state.history[r.id])  state.history[r.id]  = [{
        type: 'created',
        text: 'Risque identifié lors de l\'analyse du document',
        time: r.created_at || new Date().toISOString(),
      }];
    });
    _buildIndexes();
  }

  function setTasks(tasks) {
    state.tasks = tasks;
    _buildIndexes();
  }

  function setFolders(folders) {
    state.folders = folders;
    _buildIndexes();
  }

  function setCounterparties(cps) {
    state.counterparties = cps;
    _buildIndexes();
  }

  function setDeadlines(deadlines) {
    state.deadlines = deadlines;
  }

  function setCurrentUser(user, orgId) {
    state.currentUser  = user;
    state.currentOrgId = orgId;
  }

  // ── Mutations granulaires ─────────────────────────────────────────────

  function upsertDocument(doc) {
    const idx = state.documents.findIndex(d => d.id === doc.id);
    if (idx !== -1) state.documents[idx] = { ...state.documents[idx], ...doc };
    else            state.documents.unshift(doc);
    _buildIndexes();
  }

  function removeDocument(docId) {
    state.documents = state.documents.filter(d => d.id !== docId);
    _buildIndexes();
  }

  function upsertRisk(risk) {
    const idx = state.risks.findIndex(r => r.id === risk.id);
    if (idx !== -1) state.risks[idx] = { ...state.risks[idx], ...risk };
    else            state.risks.unshift(risk);
    if (!state.comments[risk.id]) state.comments[risk.id] = [];
    if (!state.history[risk.id])  state.history[risk.id]  = [];
    _buildIndexes();
  }

  function setRiskStatus(riskId, status, updatedBy) {
    const risk = indexes.risksById[riskId];
    if (!risk) return;
    const prev = risk.status || 'open';
    risk.status     = status;
    risk.updated_at = new Date().toISOString();
    risk.updated_by = updatedBy || null;
    _addHistory(riskId, 'status', `Statut : ${prev} → ${status}`, updatedBy);
    _buildIndexes();
    _log('risk_status_changed', { riskId, from: prev, to: status });
  }

  function upsertTask(task) {
    const idx = state.tasks.findIndex(t => t.id === task.id);
    if (idx !== -1) state.tasks[idx] = { ...state.tasks[idx], ...task };
    else            state.tasks.unshift(task);
    _buildIndexes();
    _log(idx !== -1 ? 'task_updated' : 'task_created', { taskId: task.id, title: task.title });
  }

  function removeTask(taskId) {
    state.tasks = state.tasks.filter(t => t.id !== taskId);
    _buildIndexes();
  }

  function setTaskDone(taskId, done, completedBy) {
    const task = indexes.tasksById[taskId];
    if (!task) return;
    task.status       = done ? 'done' : 'todo';
    task.completed_at = done ? new Date().toISOString() : null;
    task.completed_by = done ? (completedBy || null) : null;
    _buildIndexes();
    _log(done ? 'task_completed' : 'task_reopened', { taskId, title: task.title });
  }

  function upsertCounterparty(cp) {
    const idx = state.counterparties.findIndex(c => c.id === cp.id);
    if (idx !== -1) state.counterparties[idx] = { ...state.counterparties[idx], ...cp };
    else            state.counterparties.unshift(cp);
    _buildIndexes();
  }

  function upsertFolder(folder) {
    const idx = state.folders.findIndex(f => f.id === folder.id);
    if (idx !== -1) state.folders[idx] = { ...state.folders[idx], ...folder };
    else            state.folders.unshift(folder);
    _buildIndexes();
  }

  // ── Commentaires et historique ────────────────────────────────────────

  function addComment(riskId, text, author) {
    if (!state.comments[riskId]) state.comments[riskId] = [];
    const comment = {
      id:        'c-' + Date.now(),
      risk_id:   riskId,
      author_id: null,
      author:    author || 'Vous',
      text,
      created_at: new Date().toISOString(),
    };
    state.comments[riskId].unshift(comment);
    _addHistory(riskId, 'comment', `Commentaire : "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`, author);
    _log('comment_added', { riskId, text: text.slice(0, 60) });
    return comment;
  }

  function getComments(riskId) {
    return state.comments[riskId] || [];
  }

  function getHistory(riskId) {
    return state.history[riskId] || [];
  }

  function _addHistory(riskId, type, text, author) {
    if (!state.history[riskId]) state.history[riskId] = [];
    state.history[riskId].unshift({
      type,
      text,
      author: author || null,
      time:   new Date().toISOString(),
    });
  }

  // ── Activity Log ──────────────────────────────────────────────────────

  function _log(event, payload) {
    state.activityLog.unshift({
      id:        'al-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      event,
      payload:   payload || {},
      timestamp: new Date().toISOString(),
    });
    // Garder les 200 derniers événements
    if (state.activityLog.length > 200) state.activityLog.length = 200;
  }

  function logActivity(event, payload) {
    _log(event, payload);
  }

  function getActivityLog(limit) {
    return state.activityLog.slice(0, limit || 50);
  }

  // ── Sélecteurs dérivés ────────────────────────────────────────────────
  // Calculs pré-agrégés utilisés par les services et les modules UI.

  const computed = {

    // Risques d'un dossier (via ses documents)
    risksForFolder(folderId) {
      return indexes.risksByFolder[folderId] || [];
    },

    // Risques d'une contrepartie
    risksForCounterparty(cpId) {
      return indexes.risksByCounterparty[cpId] || [];
    },

    // Tâches d'un risque
    tasksForRisk(riskId) {
      return indexes.tasksByRisk[riskId] || [];
    },

    // Tâches d'une contrepartie
    tasksForCounterparty(cpId) {
      return indexes.tasksByCounterparty[cpId] || [];
    },

    // Tâches d'un dossier
    tasksForFolder(folderId) {
      return indexes.tasksByFolder[folderId] || [];
    },

    // Documents d'un dossier
    docsForFolder(folderId) {
      return indexes.docsByFolder[folderId] || [];
    },

    // Documents d'une contrepartie
    docsForCounterparty(cpId) {
      return indexes.docsByCounterparty[cpId] || [];
    },

    // Dossiers d'une contrepartie
    foldersForCounterparty(cpId) {
      return indexes.foldersByCounterparty[cpId] || [];
    },

    // Risques élevés non traités (Open ou Under Review)
    criticalOpenRisks() {
      return state.risks.filter(r =>
        (r.severity === 'critical' || r.severity === 'high') &&
        (r.status === 'open' || r.status === 'review')
      );
    },

    // Tâches en retard
    overdueTasks() {
      const now = new Date();
      return state.tasks.filter(t =>
        t.status !== 'done' && t.due_date && new Date(t.due_date) < now
      );
    },

    // Taux de résolution risques (0–100)
    riskResolutionRate() {
      if (!state.risks.length) return 0;
      const resolved = state.risks.filter(r =>
        ['mitigated', 'accepted', 'closed'].includes(r.status || '')
      ).length;
      return Math.round(resolved / state.risks.length * 100);
    },

    // Score risque d'un dossier (0–100) — pondéré par sévérité et statut
    folderRiskScore(folderId) {
      const risks = computed.risksForFolder(folderId);
      if (!risks.length) return 0;
      const SEV = { critical: 1.0, high: 0.8, medium: 0.4, low: 0.1 };
      const ST  = { open: 1.0, review: 0.6, mitigated: 0.2, accepted: 0.1, closed: 0.0 };
      const raw = risks.reduce((sum, r) =>
        sum + (SEV[r.severity] || 0.1) * (ST[r.status || 'open'] || 1.0) * 20, 0
      );
      return Math.min(100, Math.round(raw));
    },

    // Stats tâches
    taskStats(tasks) {
      const now = new Date();
      const list = tasks || state.tasks;
      return {
        open:    list.filter(t => t.status !== 'done').length,
        overdue: list.filter(t => t.status !== 'done' && t.due_date && new Date(t.due_date) < now).length,
        soon:    list.filter(t => {
          if (t.status === 'done' || !t.due_date) return false;
          const diff = (new Date(t.due_date) - now) / 86400000;
          return diff >= 0 && diff <= 7;
        }).length,
        done: list.filter(t => {
          if (t.status !== 'done' || !t.completed_at) return false;
          const c = new Date(t.completed_at);
          return c.getMonth() === now.getMonth() && c.getFullYear() === now.getFullYear();
        }).length,
      };
    },

    // Risques par statut (objet { open: N, review: N, ... })
    risksByStatusCounts() {
      const counts = { open: 0, review: 0, mitigated: 0, accepted: 0, closed: 0 };
      state.risks.forEach(r => { counts[r.status || 'open'] = (counts[r.status || 'open'] || 0) + 1; });
      return counts;
    },
  };

  // ── API publique ──────────────────────────────────────────────────────
  return {
    state,
    indexes,
    computed,

    // Setters bulk (chargement initial)
    setDocuments,
    setRisks,
    setTasks,
    setFolders,
    setCounterparties,
    setDeadlines,
    setCurrentUser,

    // Mutations granulaires
    upsertDocument,
    removeDocument,
    upsertRisk,
    setRiskStatus,
    upsertTask,
    removeTask,
    setTaskDone,
    upsertCounterparty,
    upsertFolder,

    // Commentaires / historique
    addComment,
    getComments,
    getHistory,

    // Activity log
    logActivity,
    getActivityLog,

    // Rebuild forcé (utile après mutations batch externes)
    rebuildIndexes: _buildIndexes,
  };

})();

// Export pour usage module (GitHub Pages = pas de bundler → variable globale)
if (typeof window !== 'undefined') window.Store = Store;
