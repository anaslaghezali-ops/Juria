/**
 * JURIA — DocumentService
 * Gestion des documents : import, Storage, analyse, suppression.
 * Tables Supabase : documents, document_content, document_chunks
 * Bucket Supabase : juria-documents
 */

class DocumentService extends BaseService {

  constructor(supabaseClient, store) {
    super(supabaseClient, 'documents', store);
    this._bucket         = 'juria-documents';
    this._contentTable   = 'document_content';
    this._chunksTable    = 'document_chunks';
  }

  // ── Chargement ────────────────────────────────────────────────────────

  /**
   * Charge tous les documents de l'organisation.
   * @param {string} orgId
   * @returns {Promise<Object[]>}
   */
  async loadDocuments(orgId) {
    try {
      const data = await this.getByOrg(orgId, `
        id,
        name,
        file_type,
        file_size,
        document_type,
        status,
        compliance_score,
        risk_level,
        storage_path,
        folder_id,
        counterparty_id,
        tags,
        is_starred,
        is_archived,
        latest_analysis_id,
        chunk_version,
        created_at,
        updated_at
      `, {
        filters: [{ column: 'is_archived', value: false }],
        order: { column: 'created_at', ascending: false },
      });

      // Normaliser le statut pour l'affichage
      const docs = (data || []).map(d => ({
        ...d,
        score:  d.compliance_score,
        status: this._normalizeStatus(d.status),
        folder: d.folder_id
          ? (this._store.indexes.foldersById[d.folder_id]?.name || '—')
          : '—',
      }));

      this._store.setDocuments(docs);
      return docs;

    } catch (err) {
      if (this._isTableMissing(err)) {
        console.warn('[DocumentService] table documents inexistante — mode démo');
        return [];
      }
      console.error('[DocumentService] loadDocuments exception:', err);
      return [];
    }
  }

  // ── Import (Upload) ───────────────────────────────────────────────────

  /**
   * Importe un fichier : INSERT documents → upload Storage → UPDATE storage_path.
   * @param {File}   file
   * @param {string} orgId
   * @param {string} userId
   * @param {Object} options — { folder_id?, counterparty_id? }
   * @param {Function} onProgress — callback(pct: number)
   * @returns {Promise<Object|null>}
   */
  async importFile(file, orgId, userId, options = {}, onProgress) {
    const ext = file.name.split('.').pop().toLowerCase();

    // Validation
    if (!['pdf', 'docx', 'doc'].includes(ext)) {
      throw new Error(`Format non supporté : ${file.name}`);
    }
    if (file.size > 100 * 1024 * 1024) {
      throw new Error(`Fichier trop volumineux (max 100 MB) : ${file.name}`);
    }

    onProgress?.(10);

    // 1. INSERT en base
    const docData = {
      organization_id:  orgId,
      uploaded_by:      userId,
      name:             file.name,
      file_type:        ext,
      file_size:        file.size,
      document_type:    'autre',
      language:         'fr',
      governing_law:    'Droit marocain',
      storage_bucket:   this._bucket,
      currency:         'MAD',
      chunk_version:    0,
      status:           'imported',
      is_starred:       false,
      is_archived:      false,
      folder_id:        options.folder_id        || null,
      counterparty_id:  options.counterparty_id  || null,
    };

    const inserted = await this.create(docData);
    if (!inserted) throw new Error('Échec de la création du document en base');

    onProgress?.(30);

    // 2. Upload Storage
    const storagePath = `${orgId}/${inserted.id}/${Date.now()}-${file.name}`;
    const { error: uploadErr } = await this._sb.storage
      .from(this._bucket)
      .upload(storagePath, file, { upsert: false });

    if (uploadErr) {
      // Rollback
      await this.delete(inserted.id, orgId);
      throw new Error(`Erreur upload Storage : ${uploadErr.message}`);
    }

    onProgress?.(70);

    // 3. UPDATE storage_path
    const updated = await this.update(inserted.id, { storage_path: storagePath });
    onProgress?.(100);

    const finalDoc = {
      ...(updated || inserted),
      storage_path: storagePath,
      score:        null,
      status:       'importé',
      folder:       options.folder_id
        ? (this._store.indexes.foldersById[options.folder_id]?.name || '—')
        : '—',
    };

    this._store.upsertDocument(finalDoc);
    this._store.logActivity('document_imported', {
      docId: finalDoc.id,
      name:  finalDoc.name,
    });

    return finalDoc;
  }

  // ── Archivage / Suppression ───────────────────────────────────────────

  /**
   * Archive (soft delete) ou supprime définitivement un document.
   * @param {string} docId
   * @param {string} orgId
   * @param {boolean} hardDelete — si true, supprime le fichier du Storage
   * @returns {Promise<boolean>}
   */
  async archiveDocument(docId, orgId, hardDelete = false) {
    const doc = this._store.indexes.docsById[docId];
    if (!doc) return false;

    if (hardDelete && doc.storage_path) {
      await this._sb.storage.from(this._bucket).remove([doc.storage_path]);
    }

    const ok = hardDelete
      ? await this.delete(docId, orgId)
      : !!(await this.update(docId, { is_archived: true }));

    if (ok) {
      this._store.removeDocument(docId);
      this._store.logActivity('document_deleted', { docId, name: doc.name });
    }

    return ok;
  }

  // ── Contenu extrait ───────────────────────────────────────────────────

  /**
   * Charge le texte extrait d'un document depuis document_content.
   * @param {string} docId
   * @returns {Promise<string|null>}
   */
  async getExtractedText(docId) {
    try {
      const { data, error } = await this._sb
        .from(this._contentTable)
        .select('extracted_text')
        .eq('document_id', docId)
        .single();

      if (error) return null;
      return data?.extracted_text || null;

    } catch { return null; }
  }

  /**
   * Génère une URL signée pour télécharger le fichier depuis Storage.
   * @param {string} storagePath
   * @param {number} expiresIn   — secondes (défaut 3600)
   * @returns {Promise<string|null>}
   */
  async getSignedUrl(storagePath, expiresIn = 3600) {
    const { data, error } = await this._sb.storage
      .from(this._bucket)
      .createSignedUrl(storagePath, expiresIn);

    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  _normalizeStatus(status) {
    const map = {
      analyzed:   'analysé',
      analyzing:  'en-cours',
      imported:   'importé',
      extracting: 'en-cours',
      extracted:  'en-cours',
      error:      'importé',
    };
    return map[status] || 'importé';
  }

  /**
   * Filtre les documents avec les indexes du Store.
   * @param {Object} filters — { search?, folder_id?, status?, file_type? }
   * @returns {Object[]}
   */
  filterDocuments({ search, folder_id, status, file_type } = {}) {
    let docs = folder_id
      ? (this._store.indexes.docsByFolder[folder_id] || [])
      : this._store.state.documents;

    if (status)    docs = docs.filter(d => d.status === status);
    if (file_type) docs = docs.filter(d => d.file_type === file_type);
    if (search) {
      const q = search.toLowerCase();
      docs = docs.filter(d => d.name.toLowerCase().includes(q));
    }

    return docs;
  }
}

if (typeof window !== 'undefined') window.DocumentService = DocumentService;
