/**
 * JURIA — FolderService
 * Gestion des dossiers juridiques et de leur score de risque.
 * Table Supabase : folders
 */

class FolderService extends BaseService {

  constructor(supabaseClient, store) {
    super(supabaseClient, 'folders', store);
  }

  // ── Chargement ────────────────────────────────────────────────────────

  /**
   * Charge tous les dossiers de l'organisation.
   * @param {string} orgId
   * @returns {Promise<Object[]>}
   */
  async loadFolders(orgId) {
    try {
      const data = await this.getByOrg(orgId, `
        id, name, description, color, icon,
        organization_id, parent_id, counterparty_id,
        created_by, documents_count, position,
        created_at, updated_at
      `, {
        order: { column: 'updated_at', ascending: false },
      });

      console.log('[FolderService] Chargés:', data.length);
      this._store.setFolders(data);
      return data;

    } catch (err) {
      if (this._isTableMissing(err)) {
        console.warn('[FolderService] table folders inexistante — mode démo');
        return [];
      }
      console.error('[FolderService] loadFolders exception:', err);
      return [];
    }
  }

  // ── Création ──────────────────────────────────────────────────────────

  /**
   * Crée un dossier.
   * @param {Object} payload — { name, client, project, owner, counterparty_id, tags, description }
   * @param {string} orgId
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  async createFolder(payload, orgId, userId) {
    // Colonnes réelles : id, name, description, color, icon, organization_id,
    // parent_id, counterparty_id, created_by, documents_count, position
    const folderData = {
      name:            payload.name,
      description:     payload.description || null,
      organization_id: orgId,
      created_by:      userId || null,
      counterparty_id: payload.counterparty_id || null,
      parent_id:       payload.parent_id || null,
      color:           payload.color || '#6366f1',  // Couleur par défaut (indigo)
      icon:            payload.icon || '📁',        // Icon par défaut
    };

    const created = await this.create(folderData);
    if (!created) return null;

    this._store.upsertFolder(created);
    this._store.logActivity('folder_created', { folderId: created.id, name: created.name });
    return created;
  }

  /**
   * Met à jour un dossier.
   * @param {string} folderId
   * @param {Object} payload
   * @returns {Promise<Object|null>}
   */
  async updateFolder(folderId, payload) {
    const updated = await this.update(folderId, payload);
    if (!updated) return null;
    this._store.upsertFolder(updated);
    return updated;
  }

  // ── Données enrichies ─────────────────────────────────────────────────

  /**
   * Retourne un dossier enrichi avec ses KPIs.
   * Utilise les indexes — aucun filter() en O(n).
   * @param {string} folderId
   * @returns {Object}
   */
  getFolderWithKPIs(folderId) {
    const folder = this._store.indexes.foldersById[folderId];
    if (!folder) return null;

    const docs    = this._store.computed.docsForFolder(folderId);
    const risks   = this._store.computed.risksForFolder(folderId);
    const tasks   = this._store.computed.tasksForFolder(folderId);
    const score   = this._store.computed.folderRiskScore(folderId);

    const highRisks = risks.filter(r =>
      (r.severity === 'high' || r.severity === 'critical') &&
      (r.status === 'open' || r.status === 'review')
    ).length;

    const medRisks = risks.filter(r =>
      r.severity === 'medium' &&
      (r.status === 'open' || r.status === 'review')
    ).length;

    const openTasks    = tasks.filter(t => t.status !== 'done').length;
    const overdueTasks = tasks.filter(t =>
      t.status !== 'done' && t.due_date && new Date(t.due_date) < new Date()
    ).length;

    const cp = folder.counterparty_id
      ? this._store.indexes.counterpartiesById[folder.counterparty_id]
      : null;

    return {
      ...folder,
      docCount:      docs.length,
      riskCount:     risks.length,
      highRisks,
      medRisks,
      taskCount:     tasks.length,
      openTasks,
      overdueTasks,
      riskScore:     score,
      counterparty:  cp || null,
    };
  }

  /**
   * Retourne tous les dossiers principaux (parent_id IS NULL).
   * @returns {Object[]}
   */
  getMainFolders() {
    return this._store.state.folders.filter(f => !f.parent_id) || [];
  }

  /**
   * Retourne tous les sous-dossiers d'un parent.
   * Utilise l'index foldersByParent — O(1) lookup.
   * @param {string} parentId
   * @returns {Object[]}
   */
  getSubFolders(parentId) {
    return this._store.indexes.foldersByParent[parentId] || [];
  }

  /**
   * Crée un sous-dossier.
   * Hérite automatiquement :
   * - organization_id du parent
   * - counterparty_id du parent
   * @param {string} parentId
   * @param {Object} payload — { name, description }
   * @param {string} orgId — pour vérification de sécurité
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  async createSubFolder(parentId, payload, orgId, userId) {
    const parent = this._store.indexes.foldersById[parentId];
    if (!parent) {
      console.error('[FolderService] Parent folder not found:', parentId);
      return null;
    }

    // Vérifier que le parent appartient bien à cette organisation (sécurité RLS)
    if (parent.organization_id !== orgId) {
      console.error('[FolderService] Parent folder not in org:', parentId);
      return null;
    }

    // Héritage du parent
    const subFolderData = {
      name:             payload.name,
      description:      payload.description || null,
      organization_id:  parent.organization_id,
      parent_id:        parentId,
      counterparty_id:  parent.counterparty_id,  // ← Héritage automatique
      created_by:       userId || null,
      color:            payload.color || '#6366f1',
      icon:             payload.icon || '📂',  // Icon différente pour sous-dossier
    };

    const created = await this.create(subFolderData);
    if (!created) return null;

    this._store.upsertFolder(created);
    this._store.logActivity('subfolder_created', {
      subFolderId: created.id,
      parentId:    parentId,
      name:        created.name
    });
    return created;
  }

  /**
   * Vérifie si un dossier est principal.
   * @param {Object} folder
   * @returns {boolean}
   */
  isMainFolder(folder) {
    return !folder || !folder.parent_id;
  }

  /**
   * Vérifie si un dossier est un sous-dossier.
   * @param {Object} folder
   * @returns {boolean}
   */
  isSubFolder(folder) {
    return folder && !!folder.parent_id;
  }
}

if (typeof window !== 'undefined') window.FolderService = FolderService;
