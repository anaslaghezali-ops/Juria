-- DIAGNOSTIC (lecture seule) — qu'est-ce qui référence documents, et avec
-- quelle règle ON DELETE ? (une seule NO ACTION suffit à bloquer la suppression)
select 'doc_children' as bloc,
       conrelid::regclass::text as enfant,
       a.attname as colonne,
       case c.confdeltype
         when 'c' then 'CASCADE (ok)'
         when 'n' then 'SET NULL (ok)'
         when 'a' then 'NO ACTION → BLOQUE la suppression'
         when 'r' then 'RESTRICT → BLOQUE'
         when 'd' then 'SET DEFAULT'
         else c.confdeltype::text
       end as on_delete
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
where c.contype = 'f' and confrelid = 'public.documents'::regclass
order by on_delete, enfant;
