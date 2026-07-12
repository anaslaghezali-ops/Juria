-- Seuil de pertinence dans match_document_chunks.
--
-- La fonction declarait un parametre match_threshold... qu'elle n'utilisait
-- pas : elle renvoyait TOUJOURS le top-N par similarite, meme totalement hors
-- sujet. L'IA recevait alors 10 passages non pertinents et repondait quand
-- meme « base sur 10 passages ». Le seuil est desormais applique (defaut 0.2,
-- calibre pour text-embedding-3-small : les vrais matchs sont ≥ 0.3, le bruit
-- < 0.15).
--
-- Idempotente : CREATE OR REPLACE (signature inchangee, seul le defaut et le
-- corps changent).

create or replace function public.match_document_chunks(
  document_id uuid,
  query_embedding vector,
  match_count integer default 5,
  match_threshold double precision default 0.2
)
returns table(
  id uuid,
  chunk_index integer,
  content text,
  page_number integer,
  start_char integer,
  end_char integer,
  similarity double precision
)
language sql
stable
as $$
  select
    dc.id,
    dc.chunk_index,
    dc.content,
    dc.page_number,
    dc.start_char,
    dc.end_char,
    (1 - (dc.embedding <=> query_embedding)) as similarity
  from document_chunks dc
  where dc.document_id = match_document_chunks.document_id
    and dc.embedding is not null
    and dc.indexing_status = 'done'
    and (1 - (dc.embedding <=> query_embedding)) >= match_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;
