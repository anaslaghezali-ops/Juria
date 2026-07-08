import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { authenticateRequest, errorResponse } from "../_shared/auth.ts";

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"));

  // Handle CORS preflight
  const preflightResponse = handleCorsPreFlight(req);
  if (preflightResponse) return preflightResponse;

  try {
    // ✅ AUTHENTICATION REQUIRED
    await authenticateRequest(req);

    const { text } = await req.json();

    // ✅ INPUT VALIDATION
    if (!text || typeof text !== 'string') {
      return errorResponse(400, 'text is required', corsHeaders);
    }
    if (text.length > 32000) {
      return errorResponse(400, 'text is too long (max 32KB)', corsHeaders);
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000)
      })
    })

    const data = await response.json()
    if (!response.ok) throw new Error(data.error?.message || 'Erreur OpenAI')

    return new Response(
      JSON.stringify({ embedding: data.data[0].embedding }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})