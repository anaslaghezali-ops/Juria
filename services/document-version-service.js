/**
 * JURIA — DocumentVersionService
 *
 * Gère l'historique des versions d'un document. Modèle (cf. migration 22) :
 *   - `documents`          = pointeur vers la version COURANTE ;
 *   - `document_versions`  = versions PRÉCÉDENTES archivées (texte figé).
 *
 * Créer une nouvelle version =
 *   1. figer la version courante (document + texte) dans document_versions ;
 *   2. faire pivoter le pointeur `documents` vers le nouveau fichier ;
 *   3. remplacer le texte extrait courant dans document_content.
 *
 * La sécurité est portée par la RLS (héritée du document parent) : ce service
 * ne fait aucune vérification d'accès côté client — la base est la seule
 * source de vérité.
 */

class DocumentVersionService extends BaseService {

  constructor(supabaseClient, store) {
    super(supabaseClient, 'document_versions', store);
    this._bucket       = 'juria-documents';
    this._contentTable = 'document_content';
    this._docsTable    = 'documents';
  }

  // ── Extraction de texte côté client (mêmes moteurs que la comparaison) ──

  async _extractText(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'pdf')  return await this._extractPDF(file);
      if (ext === 'docx') return await this._extractDOCX(file);
    } catch (e) {
      console.warn('[DocumentVersionService] extraction texte échouée:', e);
    }
    return ''; // .doc et échecs : version stockée sans texte comparable
  }

  _extractPDF(file) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        try {
          pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
          const buf = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
          let text = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(s => s.str).join(' ') + '\n';
          }
          resolve(text);
        } catch (e) { reject(e); }
      };
      if (window.pdfjsLib) return run();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
      s.onload = run; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  _extractDOCX(file) {
    return new Promise((resolve, reject) => {
      const run = () => {
        const reader = new FileReader();
        reader.onload = e => mammoth.extractRawText({ arrayBuffer: e.target.result })
          .then(r => resolve(r.value)).catch(reject);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      };
      if (window.mammoth) return run();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js';
      s.onload = run; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // ── Lecture de l'historique ─────────────────────────────────────────────

  /**
   * Historique complet (courant + archivé), du plus récent au plus ancien.
   * @returns {Promise<Object[]>} chaque entrée : { version_number, name,
   *   file_size, created_at, change_summary, is_current, storage_path,
   *   version_id | null }
   */
  async listVersions(docId) {
    const [{ data: doc }, { data: archived, error }] = await Promise.all([
      this._sb.from(this._docsTable)
        .select('id, name, file_type, file_size, storage_path, current_version, version_note, updated_at, created_at')
        .eq('id', docId).maybeSingle(),
      this._sb.from('document_versions')
        .select('id, version_number, name, file_type, file_size, storage_path, change_summary, created_at, created_by')
        .eq('document_id', docId)
        .order('version_number', { ascending: false }),
    ]);

    if (error) { this._handleError('listVersions', error); }
    if (!doc) return [];

    const current = {
      version_id:     null,
      version_number: doc.current_version || 1,
      name:           doc.name,
      file_type:      doc.file_type,
      file_size:      doc.file_size,
      storage_path:   doc.storage_path,
      change_summary: doc.version_note || null,
      created_at:     doc.updated_at || doc.created_at,
      is_current:     true,
    };

    const rows = (archived || []).map(v => ({
      version_id:     v.id,
      version_number: v.version_number,
      name:           v.name,
      file_type:      v.file_type,
      file_size:      v.file_size,
      storage_path:   v.storage_path,
      change_summary: v.change_summary || null,
      created_at:     v.created_at,
      is_current:     false,
    }));

    return [current, ...rows];
  }

  /**
   * Texte extrait d'une version donnée, pour la comparaison.
   * @param {string} docId
   * @param {Object} version  — entrée renvoyée par listVersions()
   */
  async getVersionText(docId, version) {
    if (version.is_current) {
      const { data } = await this._sb.from(this._contentTable)
        .select('extracted_text').eq('document_id', docId).maybeSingle();
      return (data && data.extracted_text) || '';
    }
    const { data } = await this._sb.from('document_versions')
      .select('extracted_text').eq('id', version.version_id).maybeSingle();
    return (data && data.extracted_text) || '';
  }

  // ── Création d'une nouvelle version ─────────────────────────────────────

  /**
   * Fige la version courante et fait pivoter le document vers `file`.
   * @param {string}   docId
   * @param {string}   orgId
   * @param {string}   userId
   * @param {File}     file
   * @param {string}   summary   — note « qu'est-ce qui a changé »
   * @param {Function} onProgress
   * @returns {Promise<Object>} le document mis à jour (nouvelle version courante)
   */
  async createVersion(docId, orgId, userId, file, summary, onProgress) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'doc'].includes(ext)) {
      throw new Error(`Format non supporté : ${file.name}`);
    }
    if (file.size > 100 * 1024 * 1024) {
      throw new Error(`Fichier trop volumineux (max 100 MB) : ${file.name}`);
    }

    onProgress?.(5);

    // 1. Charger l'état courant à figer.
    const { data: doc, error: docErr } = await this._sb.from(this._docsTable)
      .select('id, name, file_type, file_size, storage_path, storage_bucket, current_version, version_count, version_note, organization_id')
      .eq('id', docId).eq('organization_id', orgId).single();
    if (docErr || !doc) throw new Error('Document introuvable ou accès refusé.');

    const currentNum = doc.current_version || 1;
    const nextNum    = currentNum + 1;

    // 2. Extraire le texte de la NOUVELLE version (avant tout upload, pour
    //    échouer tôt si le fichier est illisible).
    onProgress?.(15);
    const newText = await this._extractText(file);

    // 3. Récupérer le texte COURANT (celui qu'on s'apprête à archiver).
    onProgress?.(25);
    const { data: curContent } = await this._sb.from(this._contentTable)
      .select('extracted_text').eq('document_id', docId).maybeSingle();
    const currentText = (curContent && curContent.extracted_text) || '';

    // 4. Uploader le nouveau fichier sous un chemin versionné.
    onProgress?.(35);
    const storagePath = `${orgId}/${docId}/v${nextNum}/${Date.now()}-${file.name}`;
    const { error: upErr } = await this._sb.storage
      .from(this._bucket).upload(storagePath, file, { upsert: false });
    if (upErr) throw new Error(`Erreur upload Storage : ${upErr.message}`);

    onProgress?.(55);

    // 5. Archiver la version courante. Le quota est vérifié à l'étape 6
    //    (UPDATE documents) : si dépassement, on nettoie le fichier uploadé.
    const { error: archErr } = await this._sb.from('document_versions').insert({
      document_id:     docId,
      organization_id: orgId,
      version_number:  currentNum,
      name:            doc.name,
      file_type:       doc.file_type,
      file_size:       doc.file_size,
      storage_path:    doc.storage_path,
      storage_bucket:  doc.storage_bucket || this._bucket,
      extracted_text:  currentText,
      change_summary:  doc.version_note || null,
      created_by:      userId,
    });
    if (archErr) {
      await this._safeRemove(storagePath);
      this._handleError('createVersion.archive', archErr);
      throw new Error('Échec de l\'archivage de la version courante.');
    }

    onProgress?.(70);

    // 6. Faire pivoter le pointeur documents vers la nouvelle version.
    //    Le trigger de quota se déclenche ICI (file_size en hausse).
    const updated = await this.updateDoc(docId, orgId, {
      name:            file.name,
      file_type:       ext,
      file_size:       file.size,
      storage_path:    storagePath,
      storage_bucket:  this._bucket,
      current_version: nextNum,
      version_count:   (doc.version_count || 1) + 1,
      version_note:    summary || null,
      status:          'imported',
    });

    if (!updated) {
      // Rollback : quota dépassé (ou autre) → on retire l'archive et le fichier.
      const dbMsg = this._lastError?.message || '';
      await this._sb.from('document_versions')
        .delete().eq('document_id', docId).eq('version_number', currentNum);
      await this._safeRemove(storagePath);
      if (dbMsg.includes('STORAGE_QUOTA_EXCEEDED')) {
        const err = new Error(dbMsg);
        err.code = 'STORAGE_QUOTA_EXCEEDED';
        const mb = dbMsg.match(/de\s+(\d+)\s+Mo/);
        if (mb) err.limitMb = Number(mb[1]);
        throw err;
      }
      throw new Error('Échec de la mise à jour du document.');
    }

    onProgress?.(85);

    // 7. Remplacer le texte extrait courant (upsert sur document_id).
    await this._sb.from(this._contentTable)
      .upsert({ document_id: docId, extracted_text: newText, updated_at: new Date().toISOString() },
              { onConflict: 'document_id' });

    onProgress?.(100);

    // 8. Refléter dans le Store si présent.
    if (this._store) {
      const merged = { ...updated };
      if (this._store.indexes?.docsById?.[docId]) {
        merged.folder = this._store.indexes.foldersById?.[updated.folder_id]?.name || undefined;
      }
      this._store.upsertDocument(merged);
      this._store.logActivity('document_versioned', {
        docId, name: file.name, version: nextNum,
      });
    }

    return updated;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** UPDATE ciblé sur documents (org-scopé), sans dépendre de DocumentService. */
  async updateDoc(id, orgId, payload) {
    const { data, error } = await this._sb.from(this._docsTable)
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id).eq('organization_id', orgId)
      .select().single();
    if (error) { this._handleError('updateDoc', error); return null; }
    return data;
  }

  async _safeRemove(path) {
    try { await this._sb.storage.from(this._bucket).remove([path]); } catch (e) {}
  }
}

if (typeof window !== 'undefined') window.DocumentVersionService = DocumentVersionService;
