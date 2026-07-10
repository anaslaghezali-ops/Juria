/**
 * JURIA — Bootstrap
 * Point d'entrée : initialise le Store, les Services, et charge les données.
 *
 * ORDRE DE CHARGEMENT dans documents.html :
 *   1. <script src="store/store.js"></script>
 *   2. <script src="services/base-service.js"></script>
 *   3. <script src="services/risk-service.js"></script>
 *   4. <script src="services/task-service.js"></script>
 *   5. <script src="services/counterparty-service.js"></script>
 *   6. <script src="services/folder-service.js"></script>
 *   7. <script src="services/document-service.js"></script>
 *   8. <script src="services/organization-service.js"></script>
 *   9. <script src="bootstrap.js"></script>
 *  10. <script src="app.js"></script>   ← logique UI existante (documents.html inline)
 */

// ── Constantes centralisées ──────────────────────────────────────────────
const PROFILE_TABLE = 'user_profiles_compat'; // table profils réelle

// ── Instances globales ────────────────────────────────────────────────────
let Services = null;

/**
 * Initialise les services avec le client Supabase.
 * Appelée une seule fois au démarrage, après window.supabase.createClient().
 * @param {Object} supabaseClient
 */
function initServices(supabaseClient) {
  Services = {
    risks:          new RiskService(supabaseClient, Store),
    tasks:          new TaskService(supabaseClient, Store),
    counterparties: new CounterpartyService(supabaseClient, Store),
    folders:        new FolderService(supabaseClient, Store),
    documents:      new DocumentService(supabaseClient, Store),
    organizations:  new OrganizationService(supabaseClient, Store),
  };

  // Exposer globalement pour la logique UI existante
  window.Services = Services;
  return Services;
}

// ── Chargement des données ────────────────────────────────────────────────

/**
 * Charge toutes les données dans l'ordre correct.
 * Les dossiers et contreparties doivent être chargés AVANT les documents
 * et les risques (pour que les indexes soient disponibles).
 *
 * @param {string} orgId
 * @param {Object} options — { useDemoData: boolean }
 * @returns {Promise<void>}
 */
async function loadAllData(orgId, options = {}) {
  if (options.useDemoData) {
    _loadDemoData();
    return;
  }

  // ✅ FIX #3: Vérifier que l'utilisateur a accès à cette org
  const currentOrgId = Store.state.currentOrgId;
  if (!orgId || !currentOrgId || orgId !== currentOrgId) {
    console.error('[Bootstrap] Unauthorized org access attempt:', orgId);
    throw new Error('Unauthorized organization access');
  }

  // Promise.allSettled : jamais bloquant — chaque table peut échouer indépendamment
  const [foldersResult, cpResult] = await Promise.allSettled([
    Services.folders.loadFolders(orgId),
    Services.counterparties.loadCounterparties(orgId),
  ]);

  const folders        = foldersResult.status === 'fulfilled' ? foldersResult.value : [];
  const counterparties = cpResult.status      === 'fulfilled' ? cpResult.value      : [];
  if (foldersResult.status === 'rejected')
    console.warn('[Bootstrap] folders échoué:', foldersResult.reason?.message || foldersResult.reason);
  if (cpResult.status === 'rejected')
    console.warn('[Bootstrap] counterparties échoué:', cpResult.reason?.message || cpResult.reason);
  console.log('[Bootstrap] Dossiers:', folders.length, '| Contreparties:', counterparties.length);

  // Documents
  let documents = [];
  try {
    documents = await Services.documents.loadDocuments(orgId);
  } catch (err) { console.warn('[Bootstrap] documents échoué:', err.message); }
  console.log('[Bootstrap] Documents:', documents.length);

  // Risques
  let risks = [];
  try {
    risks = await Services.risks.loadRisks(orgId);
  } catch (err) { console.warn('[Bootstrap] risks échoué:', err.message); }
  console.log('[Bootstrap] Risques:', risks.length);

  // Tâches
  let tasks = [];
  try {
    tasks = await Services.tasks.loadTasks(orgId);
  } catch (err) { console.warn('[Bootstrap] tasks échoué:', err.message); }
  console.log('[Bootstrap] Tâches:', tasks.length);

  // Deadlines (optionnel)
  try { await _loadDeadlines(orgId); } catch (err) { console.warn('[Bootstrap] deadlines échoué:', err.message); }

  _syncGlobalAliases();

  Store.logActivity('data_loaded', {
    docs: documents.length, risks: risks.length, tasks: tasks.length,
  });
}

/**
 * Charge les données de démonstration en mode offline / développement.
 * Sera supprimée progressivement au fur et à mesure du branchement Supabase.
 */
function _loadDemoData() {
  console.info('[Bootstrap] Mode démo — données locales');

  // Dossiers
  Store.setFolders([
    { id:'f1', name:'OCP - JV Fertinagro',       client:'OCP',        project:'JV Fertinagro',          owner:'Me Benali',  counterparty_id:'cp1', tags:['JV','M&A','Espagne','Critique'] },
    { id:'f2', name:'Client ABC - Acquisition',  client:'Client ABC', project:'Acquisition Ciment Atlas', owner:'Me Idrissi', counterparty_id:'cp5', tags:['M&A','Acquisition'] },
  ]);

  // Contreparties
  Store.setCounterparties([
    { id:'cp1', name:'Fertinagro',    type:'partenaire',  sector:'Agriculture', country:'ES', risk_level:'high' },
    { id:'cp2', name:'Oracle',        type:'fournisseur', sector:'Tech / SaaS', country:'US', risk_level:'medium' },
    { id:'cp3', name:'TotalEnergies', type:'partenaire',  sector:'Énergie',     country:'FR', risk_level:'low' },
    { id:'cp4', name:'Deloitte',      type:'fournisseur', sector:'Conseil',     country:'MA', risk_level:'low' },
    { id:'cp5', name:'Ciment Atlas',  type:'autre',       sector:'Industrie',   country:'MA', risk_level:'medium' },
  ]);

  // Documents
  Store.setDocuments([
    { id:'1', name:'SHA Fertinagro - OCP.pdf',             file_type:'pdf',  folder_id:'f1', counterparty_id:'cp1', created_at:_daysAgo(1),  status:'analysé',  score:6,    file_size:560000,  latest_analysis_id:'a1', folder:'OCP - JV Fertinagro' },
    { id:'2', name:'Amendement SHA n°1.pdf',               file_type:'pdf',  folder_id:'f1', counterparty_id:'cp1', created_at:_daysAgo(3),  status:'analysé',  score:7,    file_size:245000,  latest_analysis_id:'a2', folder:'OCP - JV Fertinagro' },
    { id:'3', name:'NDA bilatéral - TotalEnergies.pdf',    file_type:'pdf',  folder_id:'f2', counterparty_id:'cp3', created_at:_daysAgo(5),  status:'analysé',  score:8,    file_size:128000,  latest_analysis_id:'a3', folder:'Client ABC - Acquisition' },
    { id:'4', name:'SPA - Acquisition Ciment Atlas.pdf',   file_type:'pdf',  folder_id:'f2', counterparty_id:'cp5', created_at:_daysAgo(7),  status:'importé',  score:null, file_size:820000,  folder:'Client ABC - Acquisition' },
    { id:'5', name:'Contrat EPC - Projet solaire.docx',    file_type:'docx', folder_id:null,  counterparty_id:null,  created_at:_daysAgo(10), status:'importé',  score:null, file_size:310000,  folder:'—' },
    { id:'6', name:'Contrat SaaS - Oracle.pdf',            file_type:'pdf',  folder_id:null,  counterparty_id:'cp2', created_at:_daysAgo(14), status:'analysé',  score:5,    file_size:195000,  latest_analysis_id:'a4', folder:'—' },
  ]);

  // Risques — colonnes réelles document_risks
  Store.setRisks([
    { id:'r1', document_id:'1', organization_id:null, severity:'critical', category:'EVENT_OF_DEFAULT', clause_name:'Suspension des droits de vote', problem:'Suspension des droits de vote et de nomination en cas de défaut', clause_ref:'Clauses 15.2, 15.8', status:'open',      assignee:'Sarah Benali', extract:'"the voting rights of the Defaulting Party shall be suspended..."', created_at:_daysAgo(1),
      // Aliases UI
      title:'Suspension des droits de vote et de nomination', risk_type:'EVENT_OF_DEFAULT', clause_reference:'Clauses 15.2, 15.8', docName:'SHA Fertinagro - OCP.pdf', folderName:'OCP - JV Fertinagro' },
    { id:'r2', document_id:'1', organization_id:null, severity:'high',     category:'TERMINATION',      clause_name:'Résiliation Long Stop Date',    problem:'Résiliation si conditions non satisfaites à la date butoir',      clause_ref:'Clause 2.5',        status:'review',    assignee:'Me Benali',    extract:'"If the Conditions are not satisfied on or before the Long Stop Date..."',    created_at:_daysAgo(1),
      title:'Résiliation si conditions non satisfaites', risk_type:'TERMINATION', clause_reference:'Clause 2.5', docName:'SHA Fertinagro - OCP.pdf', folderName:'OCP - JV Fertinagro' },
    { id:'r3', document_id:'1', organization_id:null, severity:'medium',   category:'DEADLOCK',         clause_name:'Blocage décisionnel',           problem:'Blocage décisionnel entre actionnaires',                          clause_ref:'Clauses 14.3-14.6', status:'mitigated', assignee:'Me Benali',    extract:'"If the Deadlock Event is not resolved within forty-five (45) Business Days..."', created_at:_daysAgo(5),
      title:'Blocage décisionnel entre actionnaires', risk_type:'DEADLOCK', clause_reference:'Clauses 14.3-14.6', docName:'SHA Fertinagro - OCP.pdf', folderName:'OCP - JV Fertinagro' },
    { id:'r4', document_id:'2', organization_id:null, severity:'medium',   category:'GOVERNANCE',       clause_name:'Contrôle conseil',              problem:'Contrôle limité sur les décisions du conseil',                    clause_ref:'Clause 7.1',        status:'accepted',  assignee:'Me Idrissi',   extract:null, created_at:_daysAgo(7),
      title:'Contrôle limité sur les décisions du conseil', risk_type:'GOVERNANCE', clause_reference:'Clause 7.1', docName:'Amendement SHA n°1.pdf', folderName:'OCP - JV Fertinagro' },
    { id:'r5', document_id:'6', organization_id:null, severity:'medium',   category:'CHANGE_OF_CONTROL',clause_name:'Changement de contrôle',        problem:'Résiliation automatique en cas de changement de contrôle',        clause_ref:'Clause 12.3',       status:'open',      assignee:null,           extract:'"In the event of a Change of Control of either Party, the other Party may terminate..."', created_at:_daysAgo(14),
      title:'Résiliation automatique - changement de contrôle', risk_type:'CHANGE_OF_CONTROL', clause_reference:'Clause 12.3', docName:'Contrat SaaS - Oracle.pdf', folderName:'—' },
  ]);

  // Tâches
  Store.setTasks([
    { id:'t1', title:'Renégocier clause Event of Default (15.8)', status:'in_progress', priority:'high',   assignee:'Sarah Benali', due_date:_daysFromNow(5),  counterparty_id:'cp1', folder_id:'f1', risk_id:'r1', created_at:_daysAgo(2) },
    { id:'t2', title:'Vérifier conditions préalables Long Stop Date', status:'todo',        priority:'high',   assignee:'Me Benali',    due_date:_daysFromNow(10), counterparty_id:'cp1', folder_id:'f1', risk_id:'r2', created_at:_daysAgo(1) },
    { id:'t3', title:'Préparer mémorandum désaccord Deadlock',     status:'todo',        priority:'medium', assignee:'Me Idrissi',   due_date:_daysFromNow(15), counterparty_id:'cp1', folder_id:'f1', risk_id:'r3', created_at:_daysAgo(1) },
    { id:'t4', title:'Revoir clause Change of Control Oracle',     status:'in_progress', priority:'medium', assignee:'Sarah Benali', due_date:_daysFromNow(20), counterparty_id:'cp2', folder_id:null, risk_id:'r5', created_at:_daysAgo(5) },
    { id:'t5', title:'Valider SPA Acquisition Ciment Atlas',       status:'todo',        priority:'high',   assignee:'Me Idrissi',   due_date:_daysAgo(2),      counterparty_id:'cp5', folder_id:'f2', risk_id:null, created_at:_daysAgo(8) },
    { id:'t6', title:'Renouveler NDA TotalEnergies',               status:'done',        priority:'low',    assignee:'Sarah Benali', due_date:_daysAgo(3),      counterparty_id:'cp3', folder_id:'f2', risk_id:null, created_at:_daysAgo(15), completed_at:_daysAgo(1) },
  ]);

  // Deadlines
  const now = new Date();
  Store.setDeadlines([
    { date:_daysFromNow(7),  event:"Préavis de renouvellement — SHA Fertinagro",          doc:'SHA Fertinagro - OCP.pdf',  folder:'OCP - JV Fertinagro',    priority:'high' },
    { date:_daysFromNow(15), event:"Date butoir satisfaction conditions (Long Stop Date)", doc:'SHA Fertinagro - OCP.pdf',  folder:'OCP - JV Fertinagro',    priority:'high' },
    { date:_daysFromNow(30), event:"Approbation plan d'affaires annuel",                  doc:'SHA Fertinagro - OCP.pdf',  folder:'OCP - JV Fertinagro',    priority:'medium' },
    { date:_daysFromNow(45), event:"Rapport financier trimestriel",                       doc:'Contrat SaaS - Oracle.pdf', folder:'—',                      priority:'low' },
    { date:_daysFromNow(90), event:"Expiration NDA bilatéral",                            doc:'NDA bilatéral - TotalEnergies.pdf', folder:'Client ABC - Acquisition', priority:'medium' },
  ]);

  _syncGlobalAliases();
}

/**
 * Charge les deadlines depuis Supabase (table document_obligations).
 * Filtre d'abord les documents de l'org, puis récupère leurs obligations.
 */
async function _loadDeadlines(orgId) {
  try {
    const { data, error } = await window._sb
      .from('document_obligations')
      .select('id, description, due_date, is_critical, source, document_id, documents(name, folder_id)')
      .eq('organization_id', orgId)
      .order('due_date', { ascending: true, nullsFirst: false });

    if (error || !data) {
      console.warn('[Bootstrap] deadlines query error:', error?.message);
      return;
    }

    const deadlines = (data || []).map(o => ({
      id:          o.id,
      document_id: o.document_id || null,
      source:      o.source || 'analysis',
      date:        o.due_date,
      event:       o.description || '—',
      doc:         o.documents?.name || '',
      folder: o.documents?.folder_id
        ? (Store.indexes.foldersById[o.documents.folder_id]?.name || '')
        : '',
      priority: o.is_critical ? 'high' : 'medium',
    }));

    Store.setDeadlines(deadlines);
    console.log('[Bootstrap] Deadlines chargées:', deadlines.length);
  } catch (err) {
    console.warn('[Bootstrap] deadlines exception:', err?.message);
  }
}

/**
 * Synchronise les alias globaux pour compatibilité avec le code UI existant.
 * Sera supprimé progressivement lors du refactoring de documents.html.
 */
function _syncGlobalAliases() {
  window.allDocs            = Store.state.documents;
  window.allRisks           = Store.state.risks;
  window.allTasks           = Store.state.tasks;
  window.allFolders         = Store.state.folders;
  window.allCounterparties  = Store.state.counterparties;
  window.riskComments       = Store.state.comments;
  window.riskHistory        = Store.state.history;
}

// ── Helpers date ──────────────────────────────────────────────────────────
function _daysAgo(n)      { return new Date(Date.now() - n * 86400000).toISOString(); }
function _daysFromNow(n)  { return new Date(Date.now() + n * 86400000).toISOString(); }

// ── Exports ───────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.PROFILE_TABLE      = PROFILE_TABLE;
  window.initServices       = initServices;
  window.loadAllData        = loadAllData;
  window._syncGlobalAliases = _syncGlobalAliases;
}
