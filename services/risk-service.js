/**
 * JURIA — RiskService
 * Gestion complète du cycle de vie des risques juridiques.
 * Tables Supabase : document_risks, risk_comments (à créer)
 */

class RiskService extends BaseService {

  constructor(supabaseClient, store) {
    super(supabaseClient, 'document_risks', store);
    this._commentsTable = 'risk_comments';
  }

  // ── Chargement ────────────────────────────────────────────────────────

  /**
   * Charge tous les risques de l'organisation depuis Supabase.
   * Injecte les noms de documents et dossiers pour l'affichage.
   * @param {string} orgId
   * @returns {Promise<Object[]>}
   */
  async loadRisks(orgId) {
    try {
      // Récupérer les risques avec leur document associé
      const { data, error } = await this._sb
        .from('document_risks')
        .select(`
          id,
          document_id,
          severity,
          risk_type,
          title,
          clause_reference,
          extract,
          status,
          assignee,
          owner_id,
          created_at,
          updated_at,
          updated_by,
          documents (
            id,
            name,
            folder_id,
            counterparty_id,
            organization_id
          )
        `)
        .eq('documents.organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) {
        if (this._isTableMissing(error)) {
          console.warn('[RiskService] table document_risks inexistante — mode démo');
          return [];
        }
        this._handleError('loadRisks', error);
        return [];
      }

      // Enrichir avec docName / folderName depuis le Store
      const risks = (data || []).map(r => {
        const doc    = r.documents || {};
        const folder = this._store.indexes.foldersById[doc.folder_id] || {};
        return {
          ...r,
          documents: undefined,        // ne pas garder l'objet imbriqué
          document_id:     r.document_id,
          docName:         doc.name    || '—',
          folderName:      folder.name || '—',
          status:          r.status    || 'open',
        };
      });

      this._store.setRisks(risks);
      await this.loadAllComments(orgId);
      return risks;

    } catch (err) {
      console.error('[RiskService] loadRisks exception:', err);
      return [];
    }
  }

  // ── Statut ────────────────────────────────────────────────────────────

  /**
   * Met à jour le statut d'un risque (Open → Under Review → Mitigated …).
   * Persiste en Supabase et met à jour le Store.
   * @param {string} riskId
   * @param {string} status   — 'open' | 'review' | 'mitigated' | 'accepted' | 'closed'
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async updateRiskStatus(riskId, status, userId) {
    const VALID = ['open', 'review', 'mitigated', 'accepted', 'closed'];
    if (!VALID.includes(status)) {
      console.error('[RiskService] Statut invalide:', status);
      return false;
    }

    const updated = await this.update(riskId, {
      status,
      updated_by: userId || null,
    });

    if (!updated) return false;

    // Mettre à jour le Store local
    this._store.setRiskStatus(riskId, status, userId);
    this._store.logActivity('risk_status_changed', {
      riskId,
      to: status,
      by: userId,
    });

    return true;
  }

  // ── Commentaires ──────────────────────────────────────────────────────

  /**
   * Charge tous les commentaires de risques de l'organisation.
   * @param {string} orgId
   */
  async loadAllComments(orgId) {
    try {
      const { data, error } = await this._sb
        .from(this._commentsTable)
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) {
        if (this._isTableMissing(error)) return; // table optionnelle
        this._handleError('loadAllComments', error);
        return;
      }

      // Répartir dans le Store par risk_id
      (data || []).forEach(c => {
        if (!this._store.state.comments[c.risk_id]) {
          this._store.state.comments[c.risk_id] = [];
        }
        // Éviter les doublons
        const exists = this._store.state.comments[c.risk_id].find(x => x.id === c.id);
        if (!exists) this._store.state.comments[c.risk_id].push(c);
      });

    } catch (err) {
      console.warn('[RiskService] loadAllComments exception:', err);
    }
  }

  /**
   * Ajoute un commentaire sur un risque.
   * @param {string} riskId
   * @param {string} text
   * @param {string} orgId
   * @param {string} userId
   * @param {string} authorName
   * @returns {Promise<Object|null>}
   */
  async addComment(riskId, text, orgId, userId, authorName) {
    // 1. Optimistic update dans le Store
    const localComment = this._store.addComment(riskId, text, authorName || 'Vous');

    // 2. Persister en Supabase
    try {
      const { data, error } = await this._sb
        .from(this._commentsTable)
        .insert({
          risk_id:         riskId,
          organization_id: orgId,
          content:         text,
          author_id:       userId || null,
          created_at:      new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        if (this._isTableMissing(error)) return localComment; // mode démo OK
        this._handleError('addComment', error);
        return localComment; // garder le local en cas d'échec
      }

      // Remplacer le commentaire local par celui du serveur (avec vrai ID)
      const comments = this._store.state.comments[riskId] || [];
      const idx = comments.findIndex(c => c.id === localComment.id);
      if (idx !== -1) comments[idx] = { ...data, author: authorName || 'Vous' };

      return data;

    } catch (err) {
      console.warn('[RiskService] addComment exception:', err);
      return localComment;
    }
  }

  // ── KPIs ──────────────────────────────────────────────────────────────

  /**
   * Calcule les KPIs de résolution des risques.
   * @returns {Object}
   */
  getResolutionKPIs() {
    const risks   = this._store.state.risks;
    const counts  = this._store.computed.risksByStatusCounts();
    const rate    = this._store.computed.riskResolutionRate();
    const critical= this._store.computed.criticalOpenRisks();

    return {
      total:      risks.length,
      open:       counts.open       || 0,
      review:     counts.review     || 0,
      mitigated:  counts.mitigated  || 0,
      accepted:   counts.accepted   || 0,
      closed:     counts.closed     || 0,
      resolved:   (counts.mitigated || 0) + (counts.accepted || 0) + (counts.closed || 0),
      rate,
      criticalOpen: critical.length,
    };
  }

  /**
   * Filtre les risques selon sévérité et/ou statut.
   * Utilise les indexes — aucun filter() en O(n).
   * @param {Object} filters  — { severity?, status? }
   * @returns {Object[]}
   */
  filterRisks({ severity, status } = {}) {
    let risks = this._store.state.risks;

    if (status && status !== 'all') {
      risks = this._store.indexes.risksByStatus[status] || [];
    }

    if (severity && severity !== 'all') {
      if (severity === 'high') {
        risks = risks.filter(r => r.severity === 'high' || r.severity === 'critical');
      } else {
        risks = risks.filter(r => r.severity === severity);
      }
    }

    // Tri : Open + Critical en premier
    const statusOrder = { open: 0, review: 1, mitigated: 2, accepted: 3, closed: 4 };
    const sevOrder    = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...risks].sort((a, b) => {
      const sd = (statusOrder[a.status || 'open'] || 0) - (statusOrder[b.status || 'open'] || 0);
      if (sd !== 0) return sd;
      return (sevOrder[a.severity] || 2) - (sevOrder[b.severity] || 2);
    });
  }
}

if (typeof window !== 'undefined') window.RiskService = RiskService;
