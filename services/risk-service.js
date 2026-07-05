/**
 * JURIA — RiskService
 * Calibré sur les vraies colonnes Supabase de document_risks :
 *   id, analysis_id, document_id, organization_id,
 *   clause_name, clause_ref, problem, suggestion,
 *   severity, category, legal_reference,
 *   is_resolved, resolved_note, resolved_by, resolved_at,
 *   status (ajouté par migration), assignee (ajouté),
 *   extract (ajouté), updated_at (ajouté), updated_by (ajouté)
 */

class RiskService extends BaseService {

  constructor(supabaseClient, store) {
    super(supabaseClient, 'document_risks', store);
    this._commentsTable = 'risk_comments';
  }

  // ── Chargement ────────────────────────────────────────────────────────

  async loadRisks(orgId) {
    try {
      const { data, error } = await this._sb
        .from('document_risks')
        .select(`
          id,
          document_id,
          organization_id,
          clause_name,
          clause_ref,
          problem,
          suggestion,
          severity,
          category,
          legal_reference,
          is_resolved,
          resolved_note,
          status,
          assignee,
          extract,
          updated_at,
          updated_by,
          created_at
        `)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) {
        if (this._isTableMissing(error)) {
          console.warn('[RiskService] table document_risks inaccessible — mode démo');
          return [];
        }
        this._handleError('loadRisks', error);
        return [];
      }

      // Normaliser vers le format attendu par l'UI
      const risks = (data || []).map(r => this._normalize(r));

      this._store.setRisks(risks);
      await this.loadAllComments(orgId);
      return risks;

    } catch (err) {
      console.error('[RiskService] loadRisks exception:', err);
      return [];
    }
  }

  /**
   * Normalise une ligne document_risks vers le format UI.
   * Mappe les vraies colonnes vers les noms utilisés dans documents.html.
   */
  _normalize(r) {
    const doc    = this._store.indexes.docsById[r.document_id] || {};
    const folder = this._store.indexes.foldersById[doc.folder_id] || {};
    return {
      // Colonnes réelles
      id:              r.id,
      document_id:     r.document_id,
      organization_id: r.organization_id,
      clause_name:     r.clause_name,
      clause_ref:      r.clause_ref,
      problem:         r.problem,
      suggestion:      r.suggestion,
      severity:        r.severity || 'medium',
      category:        r.category,
      legal_reference: r.legal_reference,
      is_resolved:     r.is_resolved,
      status:          r.status || (r.is_resolved ? 'closed' : 'open'),
      assignee:        r.assignee || null,
      extract:         r.extract  || null,
      created_at:      r.created_at,
      updated_at:      r.updated_at,

      // Aliases UI (pour compatibilité avec le code de rendu existant)
      title:           r.problem    || r.clause_name || '—',
      risk_type:       r.category   || 'OTHER',
      clause_reference:r.clause_ref || r.legal_reference || '—',

      // Enrichissement depuis le Store
      docName:    doc.name    || '—',
      folderName: folder.name || '—',
    };
  }

  // ── Statut ────────────────────────────────────────────────────────────

  async updateRiskStatus(riskId, status, userId) {
    const VALID = ['open', 'review', 'mitigated', 'accepted', 'closed'];
    if (!VALID.includes(status)) return false;

    const payload = {
      status,
      updated_by: userId || null,
    };
    // Si fermé, marquer is_resolved aussi
    if (status === 'closed' || status === 'accepted') {
      payload.is_resolved  = true;
      payload.resolved_by  = userId || null;
      payload.resolved_at  = new Date().toISOString();
    } else if (status === 'open' || status === 'review') {
      payload.is_resolved = false;
      payload.resolved_by = null;
      payload.resolved_at = null;
    }

    const updated = await this.update(riskId, payload);
    if (!updated) return false;

    this._store.setRiskStatus(riskId, status, userId);
    this._store.logActivity('risk_status_changed', { riskId, to: status, by: userId });
    return true;
  }

  // ── Commentaires ──────────────────────────────────────────────────────

  async loadAllComments(orgId) {
    try {
      const { data, error } = await this._sb
        .from(this._commentsTable)
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) {
        if (this._isTableMissing(error)) {
          console.warn('[RiskService] commentaires table inexistante');
          return;
        }
        this._handleError('loadAllComments', error);
        return;
      }

      if (!data || data.length === 0) return;

      (data || []).forEach(c => {
        if (!this._store.state.comments[c.risk_id]) {
          this._store.state.comments[c.risk_id] = [];
        }
        const exists = this._store.state.comments[c.risk_id].find(x => x.id === c.id);
        if (!exists) this._store.state.comments[c.risk_id].push({
          ...c,
          text:   c.content || '',
          author: c.author_id || 'Utilisateur',
          time:   c.created_at,
        });
      });

      console.log('[RiskService] Commentaires chargés:', data.length);

    } catch (err) {
      console.warn('[RiskService] loadAllComments exception:', err?.message);
    }
  }

  async addComment(riskId, text, orgId, userId, authorName) {
    // Optimistic update local
    const localComment = this._store.addComment(riskId, text, authorName || 'Vous');

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
        if (this._isTableMissing(error)) return localComment;
        this._handleError('addComment', error);
        return localComment;
      }

      // Remplacer le local par le serveur
      const comments = this._store.state.comments[riskId] || [];
      const idx = comments.findIndex(c => c.id === localComment.id);
      if (idx !== -1) comments[idx] = {
        ...data,
        text:   data.content,
        author: authorName || 'Vous',
        time:   data.created_at,
      };
      return data;

    } catch (err) {
      console.warn('[RiskService] addComment exception:', err);
      return localComment;
    }
  }

  // ── KPIs ──────────────────────────────────────────────────────────────

  getResolutionKPIs() {
    const counts = this._store.computed.risksByStatusCounts();
    const rate   = this._store.computed.riskResolutionRate();
    return {
      total:       this._store.state.risks.length,
      open:        counts.open      || 0,
      review:      counts.review    || 0,
      mitigated:   counts.mitigated || 0,
      accepted:    counts.accepted  || 0,
      closed:      counts.closed    || 0,
      resolved:    (counts.mitigated||0) + (counts.accepted||0) + (counts.closed||0),
      rate,
      criticalOpen: this._store.computed.criticalOpenRisks().length,
    };
  }

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

    const statusOrder = { open:0, review:1, mitigated:2, accepted:3, closed:4 };
    const sevOrder    = { critical:0, high:1, medium:2, low:3 };
    return [...risks].sort((a, b) => {
      const sd = (statusOrder[a.status||'open']||0) - (statusOrder[b.status||'open']||0);
      if (sd !== 0) return sd;
      return (sevOrder[a.severity]||2) - (sevOrder[b.severity]||2);
    });
  }
}

if (typeof window !== 'undefined') window.RiskService = RiskService;
