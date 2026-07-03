/**
 * JURIA — TaskService
 * Gestion des tâches liées aux risques, dossiers, documents et contreparties.
 * Table Supabase : tasks
 */

class TaskService extends BaseService {

  constructor(supabaseClient, store) {
    super(supabaseClient, 'tasks', store);
  }

  // ── Chargement ────────────────────────────────────────────────────────

  /**
   * Charge toutes les tâches de l'organisation.
   * @param {string} orgId
   * @returns {Promise<Object[]>}
   */
  async loadTasks(orgId) {
    try {
      // SELECT * temporaire — sera affiné après validation du schéma réel
      const data = await this.getByOrg(orgId, '*', {
        order: { column: 'created_at', ascending: false },
      });

      console.log('[TaskService] Colonnes reçues:', data[0] ? Object.keys(data[0]).join(', ') : 'aucune');
      this._store.setTasks(data);
      return data;

    } catch (err) {
      if (this._isTableMissing(err)) {
        console.warn('[TaskService] table tasks inexistante — mode démo');
        return [];
      }
      console.error('[TaskService] loadTasks exception:', err);
      return [];
    }
  }

  // ── Création ──────────────────────────────────────────────────────────

  /**
   * Crée une tâche et met à jour le Store.
   * @param {Object} payload
   * @param {string} orgId
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  async createTask(payload, orgId, userId) {
    const taskData = {
      ...payload,
      organization_id: orgId,
      created_by:      userId || null,
      status:          payload.status   || 'todo',
      priority:        payload.priority || 'medium',
    };

    // Optimistic update
    const tempId   = 't-' + Date.now();
    const tempTask = { ...taskData, id: tempId };
    this._store.upsertTask(tempTask);

    const created = await this.create(taskData);

    if (!created) {
      // Rollback
      this._store.removeTask(tempId);
      return null;
    }

    // Remplacer le temp par le vrai
    this._store.removeTask(tempId);
    this._store.upsertTask(created);
    this._store.logActivity('task_created', { taskId: created.id, title: created.title });

    return created;
  }

  // ── Mise à jour ───────────────────────────────────────────────────────

  /**
   * Met à jour une tâche.
   * @param {string} taskId
   * @param {Object} payload
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  async updateTask(taskId, payload, userId) {
    // Optimistic update
    this._store.upsertTask({ id: taskId, ...payload });

    const updated = await this.update(taskId, { ...payload, updated_by: userId || null });

    if (!updated) {
      // Recharger depuis le Store pour annuler l'optimistic update
      console.warn('[TaskService] updateTask échec, état local peut être incohérent');
      return null;
    }

    this._store.upsertTask(updated);
    return updated;
  }

  // ── Statut Done / Undone ──────────────────────────────────────────────

  /**
   * Marque une tâche comme terminée ou la réouvre.
   * @param {string} taskId
   * @param {boolean} done
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async setDone(taskId, done, userId) {
    const payload = done
      ? { status: 'done', completed_at: new Date().toISOString(), completed_by: userId || null }
      : { status: 'todo', completed_at: null, completed_by: null };

    // Optimistic
    this._store.setTaskDone(taskId, done, userId);

    const updated = await this.update(taskId, payload);
    if (!updated) {
      // Rollback
      this._store.setTaskDone(taskId, !done, null);
      return false;
    }

    this._store.logActivity(done ? 'task_completed' : 'task_reopened', {
      taskId,
      title: this._store.indexes.tasksById[taskId]?.title,
    });

    return true;
  }

  // ── Suppression ───────────────────────────────────────────────────────

  /**
   * Supprime une tâche.
   * @param {string} taskId
   * @param {string} orgId
   * @returns {Promise<boolean>}
   */
  async deleteTask(taskId, orgId) {
    this._store.removeTask(taskId);
    return this.delete(taskId, orgId);
  }

  // ── Requêtes dérivées (utilise les indexes) ───────────────────────────

  /**
   * Tâches d'un risque — O(1).
   */
  forRisk(riskId) {
    return this._store.computed.tasksForRisk(riskId);
  }

  /**
   * Tâches d'une contrepartie — O(1).
   */
  forCounterparty(cpId) {
    return this._store.computed.tasksForCounterparty(cpId);
  }

  /**
   * Tâches d'un dossier — O(1).
   */
  forFolder(folderId) {
    return this._store.computed.tasksForFolder(folderId);
  }

  /**
   * Filtres combinés avec indexes.
   * @param {Object} filters — { status?, counterparty_id?, priority?, assignee? }
   * @returns {Object[]}
   */
  filterTasks({ status, counterparty_id, priority, assignee } = {}) {
    let tasks = this._store.state.tasks;

    // Utiliser l'index de statut si disponible
    if (status && status !== 'all' && status !== 'overdue') {
      tasks = this._store.indexes.tasksByStatus[status] || [];
    } else if (status === 'overdue') {
      tasks = this._store.computed.overdueTasks();
    }

    if (counterparty_id) {
      const cpTasks = new Set((this._store.indexes.tasksByCounterparty[counterparty_id] || []).map(t => t.id));
      tasks = tasks.filter(t => cpTasks.has(t.id));
    }

    if (priority) {
      tasks = tasks.filter(t => t.priority === priority);
    }

    if (assignee) {
      tasks = tasks.filter(t => t.assignee === assignee);
    }

    // Tri : en retard → haute priorité → date d'échéance
    const now = new Date();
    const prioOrder = { high: 0, medium: 1, low: 2 };
    return [...tasks].sort((a, b) => {
      const aOver = a.due_date && new Date(a.due_date) < now;
      const bOver = b.due_date && new Date(b.due_date) < now;
      if (aOver && !bOver) return -1;
      if (!aOver && bOver) return 1;
      const pDiff = (prioOrder[a.priority] || 1) - (prioOrder[b.priority] || 1);
      if (pDiff !== 0) return pDiff;
      return new Date(a.due_date || '9999') - new Date(b.due_date || '9999');
    });
  }

  /**
   * Stats agrégées (utilise le computed du Store).
   * @param {Object[]?} tasks  — sous-ensemble optionnel
   */
  getStats(tasks) {
    return this._store.computed.taskStats(tasks);
  }
}

if (typeof window !== 'undefined') window.TaskService = TaskService;
