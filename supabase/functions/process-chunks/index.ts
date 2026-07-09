import { getCorsHeaders, handleCorsPreFlight } from '../_shared/cors.ts';
import { authenticateRequest, errorResponse } from '../_shared/auth.ts';

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

interface ProcessChunksRequest {
  document_id: string
  // Optionnel : sans version, traite TOUS les chunks pending/failed du
  // document (permet de réindexer un document dont l'indexation initiale
  // a échoué — ex. le bug documents.user_id qui rendait tout appel 403).
  chunk_version?: number
}

// ✅ ACCESS CHECK : uploadeur du document, ou membre ACTIF de son org.
// NB : documents n'a PAS de colonne user_id (c'est uploaded_by) — l'ancienne
// version sélectionnait documents.user_id, la requête échouait donc sur
// CHAQUE appel → 403 systématique → embeddings jamais calculés → chunks
// bloqués en 'pending' → le RAG ne trouvait aucun passage.
async function verifyDocumentAccess(
  documentId: string,
  userId: string,
  sb: any
): Promise<boolean> {
  const { data: doc } = await sb
    .from('documents')
    .select('organization_id, uploaded_by')
    .eq('id', documentId)
    .maybeSingle();

  if (!doc) return false;
  if (doc.uploaded_by === userId) return true;
  if (!doc.organization_id) return false;

  const { data: member } = await sb
    .from('organization_users')
    .select('id')
    .eq('organization_id', doc.organization_id)
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  return !!member;
}

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')


// L'API embeddings accepte un TABLEAU d'entrées : un document de 50 chunks
// s'indexe en 1 appel au lieu de 50 (l'ancienne version séquentielle avec
// pause de 100 ms mettait ~1 s par chunk).
async function getEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      // Tronquer chaque entrée à ≈ 8000 tokens (32000 chars)
      input: texts.map(t => (t || ' ').slice(0, 32000))
    })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`OpenAI API error: ${response.status} - ${JSON.stringify(error)}`)
  }

  const data = await response.json()
  // L'API garantit l'ordre : data[i].embedding correspond à input[i]
  return data.data.map((d: { embedding: number[] }) => d.embedding)
}

async function processChunks(request: ProcessChunksRequest) {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let query = sb
    .from('document_chunks')
    .select('*')
    .eq('document_id', request.document_id)
    .in('indexing_status', ['pending', 'failed'])

  if (request.chunk_version !== undefined) {
    query = query.eq('chunk_version', request.chunk_version)
  }

  const { data: pendingChunks, error: fetchError } = await query

  if (fetchError) throw fetchError
  if (!pendingChunks || pendingChunks.length === 0) {
    return { success: true, processed: 0, message: 'No pending chunks' }
  }

  let processedCount = 0
  const BATCH_SIZE = 64 // 64 × ~400 tokens ≈ 26k tokens, très en deçà des limites API

  for (let start = 0; start < pendingChunks.length; start += BATCH_SIZE) {
    const batch = pendingChunks.slice(start, start + BATCH_SIZE)
    try {
      console.log(`Embedding batch ${start / BATCH_SIZE + 1} (${batch.length} chunks)`)
      const embeddings = await getEmbeddingsBatch(batch.map((c: any) => c.content))

      // Écritures en parallèle par petits groupes
      const now = new Date().toISOString()
      for (let i = 0; i < batch.length; i += 10) {
        const results = await Promise.all(
          batch.slice(i, i + 10).map((chunk: any, j: number) =>
            sb.from('document_chunks')
              .update({ embedding: embeddings[i + j], indexing_status: 'done', indexed_at: now })
              .eq('id', chunk.id)
          )
        )
        processedCount += results.filter(r => !r.error).length
        for (const r of results) {
          if (r.error) console.error('Chunk update failed:', r.error.message)
        }
      }
    } catch (error) {
      console.error(`Error embedding batch at ${start}:`, error)
      await sb
        .from('document_chunks')
        .update({ indexing_status: 'failed', indexed_at: new Date().toISOString() })
        .in('id', batch.map((c: any) => c.id))
    }
  }

  return {
    success: true,
    processed: processedCount,
    total: pendingChunks.length,
    message: `Processed ${processedCount}/${pendingChunks.length} chunks`
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"));

  // Handle CORS preflight
  const preflightResponse = handleCorsPreFlight(req);
  if (preflightResponse) return preflightResponse;

  if (req.method !== 'POST') {
    return errorResponse(405, 'Method not allowed', corsHeaders);
  }

  try {
    // ✅ AUTHENTICATION REQUIRED
    const { userId } = await authenticateRequest(req);

    const body = await req.json() as ProcessChunksRequest

    // ✅ INPUT VALIDATION
    if (!body.document_id || typeof body.document_id !== 'string') {
      return errorResponse(400, 'document_id is required', corsHeaders);
    }
    if (body.chunk_version !== undefined && typeof body.chunk_version !== 'number') {
      return errorResponse(400, 'chunk_version must be a number', corsHeaders);
    }

    // ✅ ACCESS CHECK - Prevent User A from processing User B's documents
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const isOwner = await verifyDocumentAccess(body.document_id, userId, sb);

    if (!isOwner) {
      return errorResponse(403, 'Forbidden: You do not have access to this document', corsHeaders);
    }

    const result = await processChunks(body)

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Edge Function error:', error)
    return errorResponse(500, 'Internal server error', corsHeaders);
  }
})
