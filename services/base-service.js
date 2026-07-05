/**
 * JURIA — BaseService
 * Classe de base pour tous les services Supabase.
 * Fournit les opérations CRUD génériques.
 * Les services métier héritent de cette classe et surchargent ou étendent.
 */

class BaseService {

  /**
   * @param {Object} supabaseClient  — instance Supabase initialisée
   * @param {string} tableName       — nom de la table Supabase
   * @param {Object} store           — référence au Store central
   */
  constructor(supabaseClient, tableName, store) {
    if (!supabaseClient) throw new Error(`BaseService: supabaseClient requis (table: ${tableName})`);
    if (!tableName)      throw new Error('BaseService: tableName requis');

    this._sb        = supabaseClient;
    this._table     = tableName;
    this._store     = store;
  }

  // ── Lecture ───────────────────────────────────────────────────────────

  /**
   * Récupère un enregistrement par son ID.
   * @param {string} id
   * @param {string} [select='*']
   * @returns {Promise<Object|null>}
   */
  async getById(id, select = '*') {
    const { data, error } = await this._sb
      .from(this._table)
      .select(select)
      .eq('id', id)
      .single();

    if (error) {
      this._handleError('getById', error);
      return null;
    }
    return data;
  }

  /**
   * Récupère tous les enregistrements d'une organisation.
   * @param {string} orgId
   * @param {string} [select='*']
   * @param {Object} [options]          — { order: { column, ascending } }
   * @returns {Promise<Object[]>}
   */
  async getByOrg(orgId, select = '*', options = {}) {
    let query = this._sb
      .from(this._table)
      .select(select)
      .eq('organization_id', orgId);

    if (options.order) {
      query = query.order(options.order.column, {
        ascending: options.order.ascending !== false,
      });
    }

    if (options.filters) {
      options.filters.forEach(({ column, value }) => {
        query = query.eq(column, value);
      });
    }

    const { data, error } = await query;
    if (error) {
      this._handleError('getByOrg', error);
      return [];
    }
    return data || [];
  }

  // ── Écriture ──────────────────────────────────────────────────────────

  /**
   * Crée un enregistrement.
   * @param {Object} payload
   * @param {Object} options — { skipUpdatedAt: boolean }
   * @returns {Promise<Object|null>}
   */
  async create(payload, options = {}) {
    const data_with_ts = {
      ...payload,
      created_at: new Date().toISOString(),
    };

    // Certaines tables n'ont pas de colonne updated_at
    if (!options.skipUpdatedAt) {
      data_with_ts.updated_at = new Date().toISOString();
    }

    const { data, error } = await this._sb
      .from(this._table)
      .insert(data_with_ts)
      .select()
      .single();

    if (error) {
      this._handleError('create', error);
      return null;
    }
    return data;
  }

  /**
   * Met à jour un enregistrement.
   * @param {string} id
   * @param {Object} payload  — uniquement les champs à modifier
   * @param {Object} options — { skipUpdatedAt: boolean }
   * @returns {Promise<Object|null>}
   */
  async update(id, payload, options = {}) {
    const updateData = { ...payload };
    if (!options.skipUpdatedAt) {
      updateData.updated_at = new Date().toISOString();
    }

    const { data, error } = await this._sb
      .from(this._table)
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this._handleError('update', error);
      return null;
    }
    return data;
  }

  /**
   * Supprime un enregistrement (soft delete si is_archived existe, sinon hard delete).
   * @param {string} id
   * @param {string} orgId  — vérification de sécurité
   * @returns {Promise<boolean>}
   */
  async delete(id, orgId) {
    let query = this._sb.from(this._table);

    // Soft delete préféré quand la colonne existe
    const { error } = await query
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);

    if (error) {
      this._handleError('delete', error);
      return false;
    }
    return true;
  }

  /**
   * Upsert : crée ou met à jour selon la présence d'un conflit.
   * @param {Object} payload
   * @param {string} conflictColumn  — colonne de conflit (ex: 'id')
   * @returns {Promise<Object|null>}
   */
  async upsert(payload, conflictColumn = 'id') {
    const { data, error } = await this._sb
      .from(this._table)
      .upsert({ ...payload, updated_at: new Date().toISOString() }, { onConflict: conflictColumn })
      .select()
      .single();

    if (error) {
      this._handleError('upsert', error);
      return null;
    }
    return data;
  }

  // ── Gestion des erreurs ───────────────────────────────────────────────

  /**
   * Centralise la gestion des erreurs Supabase.
   * @param {string} method
   * @param {Object} error
   */
  _handleError(method, error) {
    const msg = `[${this._table}::${method}] ${error.message || JSON.stringify(error)}`;
    console.error(msg, error);
    // Hook extensible : les sous-classes peuvent surcharger
    if (this.onError) this.onError(method, error);
  }

  /**
   * Vérifie si une erreur est liée à une table inexistante (42P01).
   * Utile pour le mode démo.
   */
  _isTableMissing(error) {
    return error?.code === '42P01' || error?.message?.includes('does not exist');
  }
}

if (typeof window !== 'undefined') window.BaseService = BaseService;
