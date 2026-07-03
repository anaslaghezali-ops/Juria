/**
 * JURIA — CounterpartyService
 * Gestion des contreparties et calcul de l'exposition juridique.
 * Table Supabase : counterparties
 */

class CounterpartyService extends BaseService {

  constructor(supabaseClient, store) {
    super(supabaseClient, 'counterparties', store);
  }

  // ── Chargement ────────────────────────────────────────────────────────

  /**
   * Charge toutes les contreparties de l'organisation.
   * @param {string} orgId
   * @returns {Promise<Object[]>}
   */
  async loadCounterparties(orgId) {
    try {
      const data = await this.getByOrg(orgId, `
        id,
        name,
        type,
        sector,
        country,
        risk_level,
        notes,
        created_at
      `, {
        order: { column: 'name', ascending: true },
      });

      this._store.setCounterparties(data);
      return data;

    } catch (err) {
      if (this._isTableMissing(err)) {
        console.warn('[CounterpartyService] table counterparties inexistante — mode démo');
        return [];
      }
      console.error('[CounterpartyService] loadCounterparties exception:', err);
      return [];
    }
  }

  // ── Création / Mise à jour ────────────────────────────────────────────

  /**
   * Crée ou met à jour une contrepartie.
   * @param {Object} payload
   * @param {string} orgId
   * @returns {Promise<Object|null>}
   */
  async saveCounterparty(payload, orgId) {
    const cpData = {
      ...payload,
      organization_id: orgId,
    };

    let result;
    if (payload.id && !payload.id.startsWith('cp-')) {
      // Mise à jour d'une vraie entrée Supabase
      result = await this.update(payload.id, cpData);
    } else {
      // Création
      delete cpData.id;
      result = await this.create(cpData);
    }

    if (!result) return null;

    this._store.upsertCounterparty(result);
    this._store.logActivity('counterparty_created', { name: result.name });
    return result;
  }

  // ── Risk Score ────────────────────────────────────────────────────────

  // Poids des facteurs de risque (doit rester synchronisé avec store.js)
  static RISK_FACTORS = [
    { key: 'EVENT_OF_DEFAULT',  weight: 25 },
    { key: 'TERMINATION',       weight: 15 },
    { key: 'FUNDING',           weight: 15 },
    { key: 'CHANGE_OF_CONTROL', weight: 15 },
    { key: 'DEADLOCK',          weight: 10 },
    { key: 'GOVERNANCE',        weight: 8  },
    { key: 'COMPLIANCE',        weight: 7  },
    { key: 'OTHER',             weight: 5  },
  ];

  static SEV_MULT = { critical: 1.0, high: 0.8, medium: 0.4, low: 0.1 };
  static ST_MULT  = { open: 1.0, review: 0.6, mitigated: 0.2, accepted: 0.1, closed: 0.0 };

  /**
   * Calcule le Legal Exposure Score d'une contrepartie (0–100).
   * Utilise les indexes — O(1) pour récupérer les risques.
   * @param {string} cpId
   * @returns {{ score: number, factors: Object[], riskCount: number }}
   */
  computeExposureScore(cpId) {
    const risks = this._store.computed.risksForCounterparty(cpId);
    if (!risks.length) return { score: 0, factors: [], riskCount: 0 };

    const factorTotals = {};
    CounterpartyService.RISK_FACTORS.forEach(f => { factorTotals[f.key] = 0; });

    risks.forEach(r => {
      const key  = CounterpartyService.RISK_FACTORS.find(f => f.key === (r.risk_type || 'OTHER'))?.key || 'OTHER';
      const wgt  = CounterpartyService.RISK_FACTORS.find(f => f.key === key)?.weight || 5;
      const sev  = CounterpartyService.SEV_MULT[r.severity] || 0.1;
      const st   = CounterpartyService.ST_MULT[r.status || 'open'] || 1.0;
      factorTotals[key] = Math.min(wgt, (factorTotals[key] || 0) + wgt * sev * st);
    });

    const rawScore = Object.values(factorTotals).reduce((s, v) => s + v, 0);
    const score    = Math.min(100, Math.round(rawScore));

    const factors = CounterpartyService.RISK_FACTORS
      .map(f => ({
        key:    f.key,
        label:  f.key.replace(/_/g, ' '),
        weight: f.weight,
        scored: Math.round(factorTotals[f.key] || 0),
        pct:    f.weight > 0 ? Math.round((factorTotals[f.key] || 0) / f.weight * 100) : 0,
      }))
      .filter(f => f.scored > 0);

    return { score, factors, riskCount: risks.length };
  }

  /**
   * Classe du badge selon le score.
   * @param {number} score
   * @returns {string}
   */
  static scoreBadgeClass(score) {
    if (score >= 60) return 'cp-score-high';
    if (score >= 30) return 'cp-score-med';
    return 'cp-score-low';
  }

  /**
   * Retourne toutes les contreparties enrichies avec leur score,
   * triées par score décroissant.
   * @returns {Object[]}
   */
  getAllWithScores() {
    return this._store.state.counterparties.map(cp => {
      const { score, factors, riskCount } = this.computeExposureScore(cp.id);
      const docs    = this._store.indexes.docsByCounterparty[cp.id]     || [];
      const tasks   = this._store.indexes.tasksByCounterparty[cp.id]    || [];
      const folders = this._store.indexes.foldersByCounterparty[cp.id]  || [];
      const risks   = this._store.indexes.risksByCounterparty[cp.id]    || [];
      const highR   = risks.filter(r => r.severity === 'high' || r.severity === 'critical').length;
      return { ...cp, score, factors, riskCount, docCount: docs.length, taskCount: tasks.length, folderCount: folders.length, highRiskCount: highR };
    }).sort((a, b) => b.score - a.score);
  }
}

if (typeof window !== 'undefined') window.CounterpartyService = CounterpartyService;
