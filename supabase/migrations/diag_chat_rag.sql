-- DIAGNOSTIC (lecture seule) — bug chat RAG « Aucun passage pertinent trouvé »
-- + 400 sur la persistance des conversations. Exécuté à la demande via le
-- workflow apply-migrations (input files=diag_chat_rag.sql). Pas une migration.

select 'a_chunks' as bloc,
       coalesce(indexing_status, 'NULL') as info1,
       count(*)::text as info2,
       coalesce(max(indexed_at)::text, '-') as info3
from document_chunks
where document_id = '85ce31f5-3a34-4285-801c-093ad67f303b'
group by indexing_status

union all

select 'b_embeddings_null',
       'embedding is null',
       count(*)::text,
       '-'
from document_chunks
where document_id = '85ce31f5-3a34-4285-801c-093ad67f303b'
  and embedding is null

union all

select 'c_doc_cols',
       'documents',
       c.column_name,
       c.is_nullable
from information_schema.columns c
where c.table_schema = 'public' and c.table_name = 'documents'

union all

select 'c_document_exists',
       'documents',
       count(*)::text,
       '-'
from documents
where id = '85ce31f5-3a34-4285-801c-093ad67f303b'

union all

select 'd_rls',
       c.relname,
       'rls=' || c.relrowsecurity::text,
       coalesce((select string_agg(p.polname || '[' || p.polcmd::text || ']', ', ')
                 from pg_policy p where p.polrelid = c.oid), 'AUCUNE POLICY')
from pg_class c
join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public'
  and c.relname in ('document_chunks', 'conversations', 'chat_conversations', 'chat_messages', 'documents')

union all

select 'e_fn_matchchunks',
       p.proname,
       'secdef=' || p.prosecdef::text,
       left(regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g'), 1200)
from pg_proc p
join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public'
  and p.proname = 'match_document_chunks'

union all

select 'f_conv_cols',
       c.table_name,
       c.column_name,
       c.is_nullable || ' / default=' || coalesce(c.column_default, '-')
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('conversations', 'chat_conversations', 'chat_messages')

order by 1, 2, 3;
