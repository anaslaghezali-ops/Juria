-- DIAGNOSTIC (lecture seule) — couverture des index sur les tables chaudes.
-- a) index présents ; b) clés étrangères SANS index (risque perf cascade/jointure).

-- a) Index existants sur les tables métier
select 'a_index' as bloc,
       tablename as info1,
       indexname as info2,
       regexp_replace(indexdef, '.*USING ', '') as info3
from pg_indexes
where schemaname = 'public'
  and tablename in ('documents','document_risks','document_obligations','document_analyses',
                    'document_content','document_chunks','document_summaries','folders',
                    'folder_members','counterparties','counterparty_members','tasks',
                    'organization_users','risk_comments','notifications','folder_access_log')

union all

-- b) Clés étrangères non couvertes par un index commençant par la colonne FK
select 'b_fk_sans_index',
       conrelid::regclass::text,
       a.attname,
       'FK → ' || confrelid::regclass::text || ' — AUCUN INDEX'
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
where c.contype = 'f'
  and connamespace = 'public'::regnamespace
  and conrelid::regclass::text in ('documents','document_risks','document_obligations','document_analyses',
                    'document_content','document_chunks','document_summaries','folders',
                    'folder_members','counterparties','counterparty_members','tasks',
                    'organization_users','risk_comments','notifications','folder_access_log')
  and not exists (
    select 1 from pg_index i
    where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
  )
order by 1, 2, 3;
