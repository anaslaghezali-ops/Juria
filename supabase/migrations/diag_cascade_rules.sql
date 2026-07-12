-- DIAGNOSTIC (lecture seule) — que devient le contenu quand on supprime un
-- dossier ou une contrepartie ? (règle ON DELETE des clés étrangères)
select 'cascade' as bloc,
       conrelid::regclass::text as enfant,
       a.attname as colonne,
       confrelid::regclass::text as parent,
       case c.confdeltype
         when 'c' then 'CASCADE (supprime l enfant !)'
         when 'n' then 'SET NULL (détache, conserve)'
         when 'a' then 'NO ACTION (bloque si enfant existe)'
         when 'r' then 'RESTRICT (bloque)'
         when 'd' then 'SET DEFAULT'
         else c.confdeltype::text
       end as on_delete
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
where c.contype = 'f'
  and confrelid::regclass::text in ('folders','counterparties')
order by parent, enfant, colonne;
