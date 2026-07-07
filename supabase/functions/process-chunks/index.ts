import { getCorsHeaders, handleCorsPreFlight } from '../_shared/cors.ts';
import { authenticateRequest, errorResponse } from '../_shared/auth.ts';

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

interface ProcessChunksRequest {
  document_id: string
  chunk_version: number
}

// ✅ OWNERSHIP CHECK: Verify user owns the document
async function verifyDocumentOwnership(
  documentId: string,
  userId: string,
  sb: any
): Promise<boolean> {
  const { data } = await sb
    .from('documents')
    .select('user_id')
    .eq('id', documentId)
    .eq('user_id', userId)
    .single();

  return !!data;
}

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')


async function getEmbedding(text: string): Promise<number[]> {
  // Tronquer à 8000 tokens max (≈ 32000 chars)
  const truncated = text.slice(0, 32000)
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: truncated
    })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`OpenAI API error: ${response.status} - ${JSON.stringify(error)}`)
  }

  const data = await response.json()
  return data.data[0].embedding
}

async function processChunks(request: ProcessChunksRequest) {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: pendingChunks, error: fetchError } = await sb
    .from('document_chunks')
    .select('*')
    .eq('document_id', request.document_id)
    .eq('chunk_version', request.chunk_version)
    .eq('indexing_status', 'pending')

  if (fetchError) throw fetchError
  if (!pendingChunks || pendingChunks.length === 0) {
    return { success: true, processed: 0, message: 'No pending chunks' }
  }

  let processedCount = 0

  for (const chunk of pendingChunks) {
    try {
      console.log(`Processing chunk ${chunk.chunk_index}/${pendingChunks.length}`)
      
      const embedding = await getEmbedding(chunk.content)
      
      const { error: updateError } = await sb
        .from('document_chunks')
        .update({
          embedding,
          indexing_status: 'done',
          indexed_at: new Date().toISOString()
        })
        .eq('id', chunk.id)

      if (updateError) throw updateError
      processedCount++

      await new Promise(resolve => setTimeout(resolve, 100))
    } catch (error) {
      console.error(`Error processing chunk ${chunk.chunk_index}:`, error)
      
      await sb
        .from('document_chunks')
        .update({
          indexing_status: 'failed',
          indexed_at: new Date().toISOString()
        })
        .eq('id', chunk.id)
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
    if (body.chunk_version === undefined || typeof body.chunk_version !== 'number') {
      return errorResponse(400, 'chunk_version is required', corsHeaders);
    }

    // ✅ OWNERSHIP CHECK - Prevent User A from processing User B's documents
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const isOwner = await verifyDocumentOwnership(body.document_id, userId, sb);

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
