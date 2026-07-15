/**
 * JURIA — SynthesisService
 * Orchestrateur de la note de synthèse (cf. docs/NOTE_DE_SYNTHESE_DESIGN.md).
 *
 * Pipeline : PRÉPARATION → MAP (extraction par section, cachée) →
 * CONSOLIDATION → RÉDACTION (streamée) → PERSISTANCE.
 *
 * Le navigateur orchestre : chaque appel edge reste court, la progression
 * réelle alimente la timeline UI, le cache MAP (document_summaries) rend
 * toute reprise ou régénération quasi gratuite.
 *
 * Les citations circulent en IDs opaques [[q:ID]]. L'ancrage (offsets dans
 * le texte source, page) est résolu ici, de façon déterministe — jamais par
 * le modèle.
 */

class SynthesisService extends BaseService {

  // Version du PROMPT d'extraction. Incrémenter à chaque changement de format
  // d'extrait (clés, terminologie…) : les extraits en cache portant une autre
  // version sont ignorés et ré-extraits.
  // v2 : table des parties injectée + format strictement descriptif (retrait
  //      de clauses_sensibles / clauses_inhabituelles).
  // v3 : champs dédiés taux_interet + remboursement (contrats de financement) —
  //      le taux et l'échéancier ne fuient plus dans "montants"/"duree".
  static EXTRACT_PV = 3;

  constructor(supabaseClient, store) {
    super(supabaseClient, 'document_analyses', store);
    this._summariesTable = 'document_summaries';
    this._sectionSize = 12000;      // ~3k tokens par section MAP
    this._mapConcurrency = 3;
    this._consolidateBatch = 8;     // extraits par lot de consolidation LLM
    this._promptVersion = 'synthesis-v2';
    // Modèle de rédaction par groupe. Le groupe A (factuel) est candidat à
    // gpt-4o-mini (test A/B via opts.models) ; B et C (analyse, opinion)
    // restent sur gpt-4o — c'est là que la plume se voit.
    this._composeModels = { A: 'gpt-4o', B: 'gpt-4o', C: 'gpt-4o' };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  LECTURE / VERSIONS
  // ══════════════════════════════════════════════════════════════════════

  /** Dernière synthèse d'un document (ou null). */
  async getLatestSynthesis(docId) {
    const { data, error } = await this._sb
      .from(this._table)
      .select('*')
      .eq('document_id', docId)
      .eq('kind', 'synthesis')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) { this._handleError('getLatestSynthesis', error); return null; }
    return data;
  }

  /** Toutes les versions de synthèse d'un document (récentes d'abord). */
  async listVersions(docId) {
    const { data, error } = await this._sb
      .from(this._table)
      .select('id, created_at, model_used, prompt_version, tokens_used, analysis_duration_ms, chunk_version_at_analysis, status')
      .eq('document_id', docId)
      .eq('kind', 'synthesis')
      .order('created_at', { ascending: false });

    if (error) { this._handleError('listVersions', error); return []; }
    return data || [];
  }

  /** Charge une version précise (avec son raw_result complet). */
  async getVersion(synthesisId) {
    return this.getById(synthesisId);
  }

  /** La synthèse correspond-elle à la version actuelle du document ? */
  isUpToDate(synthesis, doc) {
    return !!synthesis && !!doc &&
      synthesis.chunk_version_at_analysis === doc.chunk_version;
  }

  /**
   * Quota de l'organisation (système v2: crédits globaux)
   * @returns {Promise<{total_quota, used_credits, remaining_credits, is_unlimited}|null>}
   */
  async getQuota() {
    try {
      const token = await this._getToken();
      const res = await fetch(JURIA_CONFIG.SYNTHESIS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ mode: 'quota' }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.quotaCheck || null;
    } catch { return null; }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  GÉNÉRATION — pipeline complet
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Génère la note de synthèse d'un document.
   * @param {Object} doc      — ligne documents (id, name, chunk_version, page_count…)
   * @param {Object} opts
   *   - orgId       {string}
   *   - userId      {string}
   *   (l'« audit » de risques n'est plus accepté : la note est descriptive)
   *   - onProgress  {Function}     — (phaseId, {done, total, label})
   *   - onSection   {Function}     — (sectionId, title) au début de chaque section rédigée
   *   - onDelta     {Function}     — (texte) à chaque fragment streamé
   * @returns {Promise<Object>} la ligne document_analyses créée
   */
  async generate(doc, opts = {}) {
    const t0 = Date.now();
    const progress = opts.onProgress || (() => {});
    const token = await this._getToken();

    // ── PHASE 0 : PRÉPARATION ──────────────────────────────────────────
    progress('read', { label: 'Chargement du document…' });

    // Quota : refus propre AVANT tout travail (l'edge function re-vérifie
    // de toute façon côté serveur à chaque appel facturable)
    const quota = await this.getQuota();
    if (quota && !quota.is_unlimited && quota.remaining_credits <= 0) {
      const err = new Error(`Quota organisation atteint (${quota.used_credits}/${quota.total_quota} crédits). Renouvelez votre abonnement pour continuer.`);
      err.code = 'QUOTA_EXCEEDED';
      err.quota = quota;
      throw err;
    }

    const fullText = await this._loadFullText(doc.id);
    if (!fullText || fullText.length < 200) {
      // Document jamais ingéré (uploadé sans analyse, ou analysé avant que
      // l'ingestion du texte n'existe). L'UI propose de lancer l'analyse.
      const err = new Error("Le texte de ce document n'a pas encore été extrait.");
      err.code = 'NO_CONTENT';
      throw err;
    }

    const pageMap = await this._loadPageMap(doc.id, doc.chunk_version);
    progress('read', {
      done: 1, total: 1,
      label: `${doc.page_count ? doc.page_count + ' pages · ' : ''}${Math.round(fullText.length / 1000)}k caractères`,
    });

    // ── PHASE 0bis : STRUCTURE ─────────────────────────────────────────
    progress('structure', { label: 'Découpage du document…' });
    const sections = this._splitIntoSections(fullText);

    // Étape 0 : table des parties (« qui est qui ») — lue une fois sur
    // l'ouverture du contrat (comparution + définitions), puis injectée dans
    // TOUS les appels pour une terminologie cohérente (« le Prêteur (Banque X) »
    // partout, jamais « émetteur de crédit » inventé). Best-effort : sans
    // table, la synthèse fonctionne comme avant.
    progress('structure', { label: 'Identification des parties…' });
    const partiesTable = await this._fetchPartiesTable(fullText, doc.name, token);
    progress('structure', {
      done: 1, total: 1,
      label: `${sections.length} sections · ${partiesTable.length} partie${partiesTable.length > 1 ? 's' : ''} identifiée${partiesTable.length > 1 ? 's' : ''}`,
    });

    // ── PHASE 1 : MAP (extraction par section, avec cache) ─────────────
    const extracts = await this._mapPhase(doc, sections, token, opts.orgId, progress, partiesTable);

    // ── PHASE 2 : DOSSIER D'INSTRUCTION (qid + ancrage + consolidation) ─
    progress('consolidate', { label: 'Constitution du dossier…' });
    const { dossier, quotes } = this._buildDossier(extracts, sections, fullText, pageMap);

    // Garde-fou : si l'extraction n'a produit aucune matière (ex : appels IA
    // bloqués), on s'arrête ici — jamais de mémo vide persisté.
    const material = Object.keys(quotes).length + (dossier.parties || []).length +
      (dossier.obligations || []).length + (dossier.contexte || []).length;
    console.log(`[SynthesisService] Dossier : ${Object.keys(quotes).length} citations, ` +
      `${(dossier.obligations || []).length} obligations, ${(dossier.parties || []).length} parties`);
    if (material === 0) {
      const err = new Error("L'extraction n'a produit aucune matière exploitable. " +
        'Vérifiez la console (appels IA bloqués ?) puis régénérez.');
      err.code = 'EMPTY_EXTRACTION';
      throw err;
    }

    let finalDossier = dossier;
    const dossierSize = JSON.stringify(dossier).length;
    if (dossierSize > 120000) {
      finalDossier = await this._llmConsolidate(dossier, token, progress, partiesTable);
    }
    progress('consolidate', {
      done: 1, total: 1,
      label: `${Object.keys(quotes).length} éléments sourcés`,
    });

    // ── PHASE 3 : RÉDACTION (streamée, groupes A → B → C) ──────────────
    // Optimisation coût : chaque groupe ne reçoit que les clés du dossier
    // qu'il utilise (+ un aperçu transversal compact), et l'Executive
    // Summary reçoit un digest du mémo plutôt que son texte intégral.
    const docMeta = { name: doc.name, pages: doc.page_count };
    const models = { ...this._composeModels, ...(opts.models || {}) };
    const sectionsOut = [];
    let totalStreamed = '';

    for (const group of ['A', 'B', 'C']) {
      const phaseId = 'compose' + group;
      progress(phaseId, { label: 'Rédaction en cours…' });

      totalStreamed += await this._composeGroup({
        group,
        dossier: this._filterDossierForGroup(finalDossier, group),
        model: models[group],
        docMeta,
        partiesTable,
        memoSoFar: group === 'C' ? this._memoDigest(sectionsOut) : null,
        token,
        onSection: opts.onSection,
        onDelta: opts.onDelta,
        collected: sectionsOut,
      });

      progress(phaseId, { done: 1, total: 1, label: `${sectionsOut.length} sections rédigées` });
    }

    // ── PHASE 4 : COHÉRENCE + PERSISTANCE ──────────────────────────────
    progress('save', { label: 'Contrôle de cohérence…' });

    // Filet de sécurité : du texte a été rédigé mais aucun marqueur de
    // section reconnu. Repli n°1 : reconstruire les sections à partir des
    // titres markdown (#/##) que le modèle a inventés — on garde ainsi le
    // sommaire navigable. Repli n°2 : section unique.
    if (!sectionsOut.length && totalStreamed.trim().length > 200) {
      console.warn('[SynthesisService] Marqueurs non reconnus — reconstruction depuis les titres.');
      const clean = totalStreamed.replace(/<<<[^>]*>>>/g, '').trim();
      const parts = clean.split(/^#{1,3}\s+(.+)$/m);   // [avant, titre1, corps1, titre2, …]
      if (parts.length >= 3) {
        if (parts[0].trim().length > 100) {
          sectionsOut.push({ id: 'intro', title: 'Executive Summary', markdown: parts[0].trim() });
        }
        for (let i = 1; i + 1 < parts.length; i += 2) {
          const title = parts[i].trim();
          const body = (parts[i + 1] || '').trim();
          if (!body) continue;
          const id = 's' + sectionsOut.length + '_' +
            title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
              .replace(/[^a-z0-9]+/g, '_').slice(0, 30);
          sectionsOut.push({ id, title, markdown: body });
        }
      }
      if (!sectionsOut.length) {
        sectionsOut.push({ id: 'memo', title: 'Note de synthèse', markdown: clean });
      }
    }
    if (!sectionsOut.length) {
      const err = new Error("La rédaction n'a produit aucun contenu. Rien n'a été enregistré — régénérez.");
      err.code = 'EMPTY_COMPOSE';
      throw err;
    }

    // Toute référence [[q:x]] inconnue est neutralisée : jamais de faux ancrage.
    const knownQids = new Set(Object.keys(quotes));
    for (const s of sectionsOut) {
      s.markdown = s.markdown.replace(/\[\[q:([a-zA-Z0-9_-]+)\]\]/g,
        (m, qid) => knownQids.has(qid) ? m : '');
    }

    const execSection = sectionsOut.find(s => s.id === 'executive_summary');
    const execPlain = execSection
      ? execSection.markdown.replace(/\[\[q:[^\]]+\]\]/g, '').replace(/[*#|>-]/g, '').trim().slice(0, 1500)
      : '';

    const memo = {
      format: 'juria.synthesis.v1',
      doc: {
        id: doc.id, name: doc.name, pages: doc.page_count || null,
        chunk_version: doc.chunk_version, content_hash: doc.content_hash || null,
      },
      sections: sectionsOut.map((s, i) => ({ ...s, order: i })),
      quotes,
      stats: {
        map_sections: sections.length,
        quotes_count: Object.keys(quotes).length,
        duration_ms: Date.now() - t0,
        model_map: 'gpt-4o-mini',
        model_compose: 'gpt-4o',
      },
    };

    const { data: row, error } = await this._sb
      .from(this._table)
      .insert({
        document_id: doc.id,
        organization_id: opts.orgId,
        analyzed_by: opts.userId,
        chunk_version_at_analysis: doc.chunk_version,
        kind: 'synthesis',
        score: 0,
        summary: execPlain || 'Note de synthèse',
        status: 'completed',
        model_used: 'gpt-4o + gpt-4o-mini',
        prompt_version: this._promptVersion,
        raw_result: memo,
        analysis_duration_ms: Date.now() - t0,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) { this._handleError('generate/persist', error); throw new Error(error.message); }

    // Log quota usage asynchronously (non-blocking)
    try {
      const token = await this._getToken();
      fetch(JURIA_CONFIG.SYNTHESIS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ mode: 'log-usage', operation_type: 'synthesis', quantity: 1 }),
      }).catch(e => console.warn('[SynthesisService] Quota log failed:', e));
    } catch (e) {
      console.warn('[SynthesisService] Quota log fetch error:', e);
    }

    progress('save', { done: 1, total: 1, label: 'Note enregistrée' });
    return row;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 1 — MAP avec cache document_summaries
  // ══════════════════════════════════════════════════════════════════════

  /** Un extrait est utilisable s'il contient au moins une donnée réelle.
   *  Protège contre l'empoisonnement du cache par des extractions échouées
   *  (ex : appels bloqués par CORS qui renvoyaient {}). */
  _isUsableExtract(ex) {
    if (!ex || typeof ex !== 'object') return false;
    return Object.keys(ex).some(k => {
      const v = ex[k];
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'string') return v.trim().length > 0;
      return v && typeof v === 'object' && Object.keys(v).length > 0;
    });
  }

  async _mapPhase(doc, sections, token, orgId, progress, partiesTable) {
    // Cache : extraits déjà calculés pour CETTE version du document.
    // Les extraits vides (échecs passés) sont ignorés → ré-extraits.
    // Le marqueur _pv versionne le PROMPT d'extraction : les extraits produits
    // avant la table des parties / le format descriptif (_pv ≠ EXTRACT_PV)
    // sont ignorés et ré-extraits — sinon l'ancienne terminologie incohérente
    // resterait figée dans le cache.
    const { data: cached } = await this._sb
      .from(this._summariesTable)
      .select('section_index, extract')
      .eq('document_id', doc.id)
      .eq('chunk_version', doc.chunk_version)
      .not('extract', 'is', null)
      .order('section_index');

    const cacheMap = new Map((cached || [])
      .filter(r => this._isUsableExtract(r.extract) && r.extract._pv === SynthesisService.EXTRACT_PV)
      .map(r => [r.section_index, r.extract]));
    const extracts = new Array(sections.length).fill(null);
    const toDo = [];

    sections.forEach((section, i) => {
      if (cacheMap.has(i)) extracts[i] = cacheMap.get(i);
      else toDo.push(i);
    });

    let done = sections.length - toDo.length;
    progress('map', { done, total: sections.length, label: done > 0 ? `${done} sections en cache` : 'Lecture des sections…' });

    const self = this;
    const tasks = toDo.map(i => async function () {
      const extract = await self._extractSection(sections[i], doc.name, token, partiesTable);
      if (extract && typeof extract === 'object') extract._pv = SynthesisService.EXTRACT_PV;
      extracts[i] = extract;

      // Ne JAMAIS mettre en cache un extrait vide (échec d'appel) :
      // il empoisonnerait toutes les générations suivantes.
      if (self._isUsableExtract(extract)) {
        await self._sb.from(self._summariesTable).upsert({
          document_id: doc.id,
          organization_id: orgId || null,
          section_index: i,
          section_total: sections.length,
          summary: (extract && extract.resume) || '—',
          extract,
          chunk_version: doc.chunk_version,
        }, { onConflict: 'document_id,section_index' });
      }

      done++;
      progress('map', { done, total: sections.length, label: `${done} / ${sections.length} sections analysées` });
    });

    await this._parallelWithLimit(tasks, this._mapConcurrency);
    return extracts;
  }

  /**
   * Étape 0 — table des parties. Un appel léger sur l'ouverture du contrat
   * (comparution + définitions vivent dans les premières pages). Best-effort :
   * toute erreur → tableau vide, la synthèse continue sans table.
   */
  async _fetchPartiesTable(fullText, docName, token) {
    try {
      const res = await fetch(JURIA_CONFIG.SYNTHESIS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          mode: 'parties_table',
          context: String(fullText).slice(0, 30000),
          doc_name: docName,
        }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      const parties = Array.isArray(data.parties) ? data.parties : [];
      console.log('[SynthesisService] Table des parties :',
        parties.map(p => `${p.terme_defini} = ${p.entite}`).join(' · ') || '(vide)');
      return parties;
    } catch (e) {
      console.warn('[SynthesisService] Table des parties indisponible :', e.message);
      return [];
    }
  }

  async _extractSection(section, docName, token, partiesTable, attempt = 0) {
    try {
      const res = await fetch(JURIA_CONFIG.SYNTHESIS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          mode: 'extract', context: section.text, doc_name: docName,
          parties_table: (partiesTable && partiesTable.length) ? partiesTable : undefined,
        }),
      });
      const data = await res.json();
      if (res.status === 429) {
        // Quota atteint : erreur FATALE, jamais avalée (sinon extraction
        // vide silencieuse → mémo dégénéré)
        const err = new Error(data.error || 'Quota de synthèses atteint.');
        err.code = 'QUOTA_EXCEEDED';
        err.fatal = true;
        throw err;
      }
      if (!res.ok) throw new Error(data.error || 'Erreur extraction');
      return data.extract || {};
    } catch (e) {
      if (e.fatal) throw e;
      if (attempt < 1) return this._extractSection(section, docName, token, partiesTable, attempt + 1);
      console.warn('[SynthesisService] Section non extraite (ignorée) :', e.message);
      return {};  // une section en échec n'annule pas la note entière
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 2 — Dossier d'instruction : qids + ancrage déterministe
  // ══════════════════════════════════════════════════════════════════════

  _buildDossier(extracts, sections, fullText, pageMap) {
    const LIST_KEYS = ['parties', 'obligations', 'montants', 'remboursement', 'dates',
      'garanties', 'responsabilites', 'resiliation', 'pi_confidentialite', 'donnees_personnelles'];
    const SINGLE_KEYS = ['taux_interet', 'duree', 'droit_applicable'];

    const dossier = { objet: null, contexte: [], questions_ouvertes: [] };
    LIST_KEYS.forEach(k => { dossier[k] = []; });
    SINGLE_KEYS.forEach(k => { dossier[k] = []; });  // agrégés en liste, le compose choisit

    const quotes = {};
    let qCounter = 0;

    // Retire les champs null / vides d'un item : le rédacteur ne doit jamais
    // voir "null" (il le recopiait dans les tableaux du mémo).
    const compact = (obj) => {
      const out = {};
      Object.keys(obj).forEach(k => {
        const v = obj[k];
        if (v === null || v === undefined) return;
        if (typeof v === 'string' && (!v.trim() || v.trim().toLowerCase() === 'null')) return;
        out[k] = v;
      });
      return out;
    };

    const anchor = (item, sectionIndex) => {
      if (!item || typeof item !== 'object') return item;
      if (!item.quote) return compact(item);
      const qid = 'q' + (++qCounter);
      const section = sections[sectionIndex];
      const pos = this._findQuote(section ? section.text : '', item.quote);
      quotes[qid] = {
        quote: String(item.quote).slice(0, 600),
        article: item.article || null,
        section_index: sectionIndex,
        start: pos ? section.start + pos.start : null,
        end: pos ? section.start + pos.end : null,
        page: pos ? this._pageForOffset(section.start + pos.start, pageMap) : null,
      };
      const { quote, ...rest } = item;
      return { ...compact(rest), qid };
    };

    extracts.forEach((ex, i) => {
      if (!ex || typeof ex !== 'object') return;
      if (ex.objet && !dossier.objet) dossier.objet = ex.objet;
      if (ex.resume) dossier.contexte.push(ex.resume);

      LIST_KEYS.forEach(k => {
        if (Array.isArray(ex[k])) ex[k].forEach(item => dossier[k].push(anchor(item, i)));
      });
      SINGLE_KEYS.forEach(k => {
        if (ex[k] && typeof ex[k] === 'object' &&
            (ex[k].quote || ex[k].texte || ex[k].loi || ex[k].taux)) {
          dossier[k].push(anchor(ex[k], i));
        }
      });
      if (Array.isArray(ex.questions_ouvertes)) {
        dossier.questions_ouvertes.push(...ex.questions_ouvertes.filter(Boolean));
      }
    });

    // Dédoublonnage simple des parties (par nom normalisé)
    const seen = new Set();
    dossier.parties = dossier.parties.filter(p => {
      const key = (p.nom || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Dédoublonnage des listes par citation : une clause à cheval sur une
    // frontière de section est extraite deux fois avec le MÊME verbatim. On
    // garde le premier item (donc son ancrage) et on écarte les répliques. Les
    // items sans citation ne sont pas comparés (aucune signature fiable).
    const quoteSig = (qid) => {
      const q = qid && quotes[qid] && quotes[qid].quote;
      return q ? String(q).toLowerCase().replace(/\s+/g, ' ').trim() : null;
    };
    LIST_KEYS.forEach(k => {
      if (k === 'parties') return;   // déjà dédoublonné par nom ci-dessus
      const seenQuotes = new Set();
      dossier[k] = dossier[k].filter(item => {
        const sig = item && item.qid ? quoteSig(item.qid) : null;
        if (!sig) return true;
        if (seenQuotes.has(sig)) return false;
        seenQuotes.add(sig);
        return true;
      });
    });

    return { dossier, quotes };
  }

  /**
   * Recherche déterministe d'un verbatim dans le texte d'une section,
   * tolérante aux différences d'espaces/retours à la ligne.
   * @returns {{start, end}|null} offsets DANS la section
   */
  _findQuote(sectionText, quote) {
    if (!sectionText || !quote) return null;
    const direct = sectionText.indexOf(quote);
    if (direct >= 0) return { start: direct, end: direct + quote.length };

    // Normalisation : espaces multiples → un espace, avec table de correspondance
    const map = [];
    let norm = '';
    let lastWasSpace = false;
    for (let i = 0; i < sectionText.length; i++) {
      const c = sectionText[i];
      if (/\s/.test(c)) {
        if (!lastWasSpace) { norm += ' '; map.push(i); lastWasSpace = true; }
      } else {
        norm += c; map.push(i); lastWasSpace = false;
      }
    }
    const normQuote = quote.replace(/\s+/g, ' ').trim();
    const idx = norm.indexOf(normQuote);
    if (idx < 0) {
      // Dernier recours : les 40 premiers caractères significatifs
      const head = normQuote.slice(0, 40);
      const idx2 = head.length >= 20 ? norm.indexOf(head) : -1;
      if (idx2 < 0) return null;
      return { start: map[idx2], end: map[Math.min(idx2 + normQuote.length, map.length - 1)] };
    }
    return { start: map[idx], end: map[Math.min(idx + normQuote.length - 1, map.length - 1)] + 1 };
  }

  _pageForOffset(offset, pageMap) {
    if (!pageMap || !pageMap.length || offset == null) return null;
    for (const p of pageMap) {
      if (offset >= p.start && offset < p.end) return p.page;
    }
    return null;
  }

  /**
   * Restreint le dossier aux clés réellement utilisées par un groupe de
   * rédaction (~60 % d'input en moins sur les appels gpt-4o), en conservant
   * dans chaque groupe un aperçu transversal compact pour que le rédacteur
   * garde la vision d'ensemble du deal (croisements entre sections).
   */
  _filterDossierForGroup(dossier, group) {
    const KEYS = {
      // A — factuel : objet, parties, obligations, finances, taux, remboursement,
      //     calendrier, durée
      A: ['parties', 'obligations', 'montants', 'taux_interet', 'remboursement', 'dates', 'duree'],
      // B — régimes du contrat (descriptif)
      B: ['garanties', 'responsabilites', 'resiliation', 'droit_applicable',
          'pi_confidentialite', 'donnees_personnelles'],
      // C — questions ouvertes + executive summary (le digest du mémo fournit
      // la vue d'ensemble ; pas de clés de risque : note purement descriptive)
      C: ['questions_ouvertes'],
    };

    const out = {
      objet: dossier.objet || null,
      parties_apercu: (dossier.parties || []).map(p => ({ nom: p.nom, role: p.role, qid: p.qid })),
      apercu_transversal: (dossier.contexte || []).slice(0, 8),
    };
    (KEYS[group] || []).forEach(k => { if (dossier[k] !== undefined) out[k] = dossier[k]; });
    // Le groupe A rédige "Contexte" et "Structure du document"
    if (group === 'A') out.contexte = (dossier.contexte || []).slice(0, 12);
    return out;
  }

  /**
   * Digest du mémo déjà rédigé pour l'Executive Summary : titres + amorce
   * de chaque section — la vue d'ensemble sans payer le texte intégral.
   */
  _memoDigest(sections) {
    return sections.map(s =>
      '## ' + s.title + '\n' +
      s.markdown.replace(/\[\[q:[^\]]+\]\]/g, '').trim().slice(0, 400)
    ).join('\n\n').slice(0, 12000);
  }

  async _llmConsolidate(dossier, token, progress, partiesTable) {
    // Consolidation LLM par lots des listes volumineuses uniquement
    progress('consolidate', { label: 'Consolidation du dossier…' });
    const res = await fetch(JURIA_CONFIG.SYNTHESIS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        mode: 'consolidate', extracts: [dossier],
        parties_table: (partiesTable && partiesTable.length) ? partiesTable : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn('[SynthesisService] Consolidation échouée, dossier brut conservé :', data.error);
      return dossier;
    }
    return data.consolidated || dossier;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 3 — Rédaction streamée (SSE)
  // ══════════════════════════════════════════════════════════════════════

  async _composeGroup({ group, dossier, model, docMeta, partiesTable, memoSoFar, token, onSection, onDelta, collected }) {
    const res = await fetch(JURIA_CONFIG.SYNTHESIS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        mode: 'compose', group, dossier, doc_meta: docMeta,
        model: model || undefined,
        parties_table: (partiesTable && partiesTable.length) ? partiesTable : undefined,
        memo_so_far: memoSoFar || undefined,
      }),
    });

    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Rédaction (groupe ${group}) : erreur ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let current = null;   // section en cours { id, title, markdown }
    let pending = '';     // texte en attente (marqueur potentiellement coupé)

    const flushPending = (force) => {
      // Un marqueur <<<SECTION:…>>> peut arriver coupé entre deux deltas :
      // on ne libère le texte que jusqu'au dernier '<' suspect.
      let releasable = pending;
      if (!force) {
        const lastOpen = pending.lastIndexOf('<');
        if (lastOpen >= 0 && pending.length - lastOpen < 30) {
          releasable = pending.slice(0, lastOpen);
          pending = pending.slice(lastOpen);
        } else {
          pending = '';
        }
      } else {
        pending = '';
      }
      if (releasable && current) {
        current.markdown += releasable;
        if (onDelta) onDelta(releasable);
      }
    };

    const processText = (text) => {
      pending += text;
      let match;
      // Tolérant : espaces autour de SECTION/: /| et éventuel gras/titre
      const markerRe = /(?:\*\*|#+\s*)?<<<\s*SECTION\s*:\s*([a-zA-Z_]+)\s*\|([^>]+)>>>(?:\*\*)?/;
      while ((match = pending.match(markerRe))) {
        const before = pending.slice(0, match.index);
        if (before && current) {
          current.markdown += before;
          if (onDelta) onDelta(before);
        }
        current = { id: match[1], title: match[2].trim(), markdown: '' };
        collected.push(current);
        if (onSection) onSection(current.id, current.title);
        pending = pending.slice(match.index + match[0].length);
      }
      flushPending(false);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          if (json.error) throw new Error(json.error);
          if (json.delta) { fullText += json.delta; processText(json.delta); }
        } catch (e) {
          if (e.message && !e.message.includes('JSON')) throw e;
        }
      }
    }
    flushPending(true);

    // Nettoyage : sections vides (le modèle a le droit d'omettre)
    for (let i = collected.length - 1; i >= 0; i--) {
      if (!collected[i].markdown.trim()) collected.splice(i, 1);
    }
    return fullText;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  UTILITAIRES
  // ══════════════════════════════════════════════════════════════════════

  async _getToken() {
    const { data } = await this._sb.auth.getSession();
    if (!data.session) throw new Error('Session expirée — reconnectez-vous.');
    return data.session.access_token;
  }

  async _loadFullText(docId) {
    const { data, error } = await this._sb
      .from('document_content')
      .select('extracted_text')
      .eq('document_id', docId)
      .maybeSingle();
    if (error) { this._handleError('_loadFullText', error); return null; }
    return data ? data.extracted_text : null;
  }

  /** Bornes de pages depuis document_chunks (si disponibles). */
  async _loadPageMap(docId, chunkVersion) {
    const { data } = await this._sb
      .from('document_chunks')
      .select('start_char, end_char, page_number')
      .eq('document_id', docId)
      .eq('chunk_version', chunkVersion)
      .not('page_number', 'is', null)
      .order('chunk_index');
    if (!data || !data.length) return [];
    return data
      .filter(c => c.start_char != null && c.end_char != null)
      .map(c => ({ start: c.start_char, end: c.end_char, page: c.page_number }));
  }

  /**
   * Découpe le texte en sections de ~_sectionSize caractères, aux frontières
   * de paragraphes, en conservant les offsets globaux.
   */
  _splitIntoSections(text) {
    const sections = [];
    const size = this._sectionSize;
    let pos = 0;
    let index = 0;

    while (pos < text.length) {
      let end = Math.min(pos + size, text.length);
      if (end < text.length) {
        // Chercher une frontière de paragraphe dans les derniers 20 %
        const windowStart = Math.max(pos + Math.floor(size * 0.8), pos + 200);
        const slice = text.slice(windowStart, end);
        const lastBreak = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'));
        if (lastBreak > 0) end = windowStart + lastBreak;
      }
      sections.push({ index, start: pos, end, text: text.slice(pos, end) });
      pos = end;
      index++;
    }
    return sections;
  }

  /** Exécution parallèle à concurrence bornée (pattern chat.html). */
  async _parallelWithLimit(tasks, limit) {
    const results = new Array(tasks.length);
    let index = 0;
    const runNext = async () => {
      const i = index++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
      await runNext();
    };
    const workers = [];
    for (let w = 0; w < Math.min(limit, tasks.length); w++) workers.push(runNext());
    await Promise.all(workers);
    return results;
  }
}

if (typeof window !== 'undefined') window.SynthesisService = SynthesisService;
