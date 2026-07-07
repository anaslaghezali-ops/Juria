import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

interface ProcessChunksRequest {
  document_id: string
  chunk_version: number
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
  // Gérer la requête preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const body = await req.json() as ProcessChunksRequest

    if (!body.document_id || body.chunk_version === undefined) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: document_id, chunk_version' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const result = await processChunks(body)

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Edge Function error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
