-- DIAGNOSTIC (lecture seule) — colonnes de public.comments (table héritée,
-- absente du dépôt) pour écrire un test de suppression fidèle.
select 'comments_cols' as bloc,
       column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='comments'
order by ordinal_position;
