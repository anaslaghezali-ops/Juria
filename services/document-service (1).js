/**
 * JURIA — DocumentService
 * Calibré sur les vraies colonnes Supabase de documents :
 *   id, organization_id, folder_id, uploaded_by, name,
 *   file_type, file_size, storage_path, storage_bucket,
 *   page_count, language, content_hash, chunk_version,
 *   document_type, title, reference, governing_law,
 *   amount, currency, status, compliance_score, risk_level,
 *   executive_summary, latest_analysis_id,
 *   is_starred, is_archived, tags, notes,
 *   created_at, updated_at, counterparty_id
 */

class DocumentService extends BaseService {

  constructor(supabaseClient, store) {
    super(supabaseClient, 'documents', store);
    this._bucket       = 'juria-documents';
    this._contentTable = 'document_content';
    this._chunksTable  = 'document_chunks';
  }

  // ── Select complet aligné sur les vraies colonnes ─────────────────────
  static SELECT = `
    id, organization_id, folder_id, uploaded_by,
    name, file_type, file_size, storage_path, storage_bucket,
    page_count, language, content_hash, chunk_version,
    document_type, title, reference, governing_law,
    amount, currency, status, compliance_score, risk_level,
    executive_summary, latest_analysis_id,
    is_starred, is_archived, tags, notes,
    created_at, updated_at, counterparty_id
  `;

  // ── Chargement ────────────────────────────────────────────────────────

  async loadDocuments(orgId) {
    try {
      const { data, error } = await this._sb
        .from('documents')
        .select(DocumentService.SELECT)
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false });

      if (error) {
        if (this._isTableMissing(error)) {
          console.warn('[DocumentService] table documents inaccessible — mode démo');
          return [];
        }
        this._handleError('loadDocuments', error);
        return [];
      }

      const docs = (data || []).map(d => this._normalize(d));
      this._store.setDocuments(docs);
      return docs;

    } catch (err) {
      console.error('[DocumentService] loadDocuments exception:', err);
      return [];
    }
  }

  _normalize(d) {
    const folder = this._store.indexes.foldersById[d.folder_id] || {};
    return {
      ...d,
      // Alias UI
      score:  d.compliance_score,
      status: this._normalizeStatus(d.status),
      folder: folder.name || '—',
    };
  }

  // ── Import ────────────────────────────────────────────────────────────

  async importFile(file, orgId, userId, options = {}, onProgress) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (!['pdf', 'docx', 'doc'].includes(ext)) {
      throw new Error(`Format non supporté : ${file.name}`);
    }
    if (file.size > 100 * 1024 * 1024) {
      throw new Error(`Fichier trop volumineux (max 100 MB) : ${file.name}`);
    }

    onProgress?.(10);

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
      folder_id:        options.folder_id       || null,
      counterparty_id:  options.counterparty_id || null,
    };

    const inserted = await this.create(docData);
    if (!inserted) throw new Error('Échec de la création du document en base');

    onProgress?.(30);

    const storagePath = `${orgId}/${inserted.id}/${Date.now()}-${file.name}`;
    const { error: uploadErr } = await this._sb.storage
      .from(this._bucket)
      .upload(storagePath, file, { upsert: false });

    if (uploadErr) {
      await this.delete(inserted.id, orgId);
      throw new Error(`Erreur upload Storage : ${uploadErr.message}`);
    }

    onProgress?.(70);

    const updated = await this.update(inserted.id, { storage_path: storagePath });
    onProgress?.(100);

    const finalDoc = this._normalize({ ...(updated || inserted), storage_path: storagePath });
    this._store.upsertDocument(finalDoc);
    this._store.logActivity('document_imported', { docId: finalDoc.id, name: finalDoc.name });

    return finalDoc;
  }

  // ── Suppression ───────────────────────────────────────────────────────

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
