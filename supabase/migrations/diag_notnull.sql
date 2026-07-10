-- DIAGNOSTIC express (lecture seule) : colonnes NOT NULL sans default
-- des tables utilisées par les fixtures de diag_test_folder_sharing.sql.
select c.table_name, c.column_name, c.data_type
from information_schema.columns c
where c.table_schema = 'public'
  and c.is_nullable = 'NO'
  and c.column_default is null
  and c.table_name in ('documents','document_analyses','document_risks',
                       'document_obligations','folders','organizations',
                       'organization_users','risk_comments','tasks')
order by 1, 2;
