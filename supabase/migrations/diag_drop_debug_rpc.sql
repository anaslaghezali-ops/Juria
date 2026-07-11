-- Nettoyage : retire la fonction de debug déployée pendant l'investigation.
DROP FUNCTION IF EXISTS public.zz_debug_insert_check(uuid, uuid);
DROP FUNCTION IF EXISTS public.fn_debug_folders_insert(uuid, uuid, uuid);
DROP TABLE IF EXISTS public.zz_rls_debug;
SELECT 'debug artefacts nettoyés' AS info;
