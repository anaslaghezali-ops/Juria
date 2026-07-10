-- DIAGNOSTIC (lecture seule) — état des RLS/colonnes avant la fonctionnalité
-- « partage de dossiers » (migration 13). Exécuté à la demande via le workflow
-- apply-migrations (input files=diag_folder_sharing.sql). Pas une migration.

-- a) RLS activée + liste des policies par table concernée
select 'a_rls' as bloc,
       c.relname as info1,
       'rls=' || c.relrowsecurity::text as info2,
       coalesce((select string_agg(p.polname || '[' || p.polcmd::text || ']', ', ' order by p.polname)
                 from pg_policy p where p.polrelid = c.oid), 'AUCUNE POLICY') as info3
from pg_class c
join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('folders', 'documents', 'document_risks', 'document_obligations',
                    'tasks', 'counterparties', 'document_chunks', 'document_content',
                    'document_analyses', 'document_summaries', 'risk_comments',
                    'chat_conversations', 'chat_messages', 'synthesis_memos')

union all

-- b) Définition complète de chaque policy (USING / WITH CHECK)
select 'b_policy_def',
       p.tablename || '.' || p.policyname,
       'cmd=' || p.cmd || ' roles=' || array_to_string(p.roles, ','),
       'USING(' || coalesce(left(regexp_replace(p.qual, '\s+', ' ', 'g'), 500), '-') || ') CHECK(' ||
       coalesce(left(regexp_replace(p.with_check, '\s+', ' ', 'g'), 500), '-') || ')'
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('folders', 'documents', 'document_risks', 'document_obligations',
                      'tasks', 'counterparties', 'document_chunks', 'document_content',
                      'document_analyses', 'document_summaries', 'risk_comments',
                      'chat_conversations', 'chat_messages', 'synthesis_memos')

union all

-- c) Colonnes des tables à étendre (owner/created_by existent-ils déjà ?)
select 'c_cols',
       c.table_name,
       c.column_name,
       c.data_type || ' / null=' || c.is_nullable || ' / default=' || coalesce(left(c.column_default, 60), '-')
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('folders', 'tasks', 'counterparties', 'document_chunks')

union all

-- d) Helpers fn_* existants
select 'd_helpers',
       p.proname,
       'secdef=' || p.prosecdef::text,
       pg_get_function_identity_arguments(p.oid)
from pg_proc p
join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public'
  and p.proname like 'fn\_%' escape '\'

union all

-- e) Volumes (échelle du backfill)
select 'e_counts', 'folders',              count(*)::text, '-' from folders
union all
select 'e_counts', 'documents',            count(*)::text, '-' from documents
union all
select 'e_counts', 'documents_sans_dossier', count(*)::text, '-' from documents where folder_id is null
union all
select 'e_counts', 'document_risks',       count(*)::text, '-' from document_risks
union all
select 'e_counts', 'tasks',                count(*)::text, '-' from tasks
union all
select 'e_counts', 'document_obligations', count(*)::text, '-' from document_obligations

order by 1, 2, 3;
