/**
 * Secure CORS headers configuration
 * Whitelist allowed origins only
 */
const ALLOWED_ORIGINS = [
  "https://juria.ma",
  "https://app.juria.ma",
  "https://www.juria.ma",
  "https://anaslaghezali-ops.github.io",  // production actuelle (GitHub Pages)
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
];

export interface CorsHeaders {
  "Access-Control-Allow-Origin": string;
  "Access-Control-Allow-Headers": string;
  "Access-Control-Allow-Methods": string;
  "Access-Control-Max-Age"?: string;
}

/**
 * Get secure CORS headers based on origin
 * Only allows whitelisted origins
 */
export function getCorsHeaders(originHeader?: string | null): CorsHeaders {
  const origin = originHeader || "";

  // Only allow whitelisted origins, fall back to first allowed if not recognized
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "3600",
  };
}

/**
 * Handle CORS preflight requests
 */
export function handleCorsPreFlight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("Origin");
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }
  return null;
}
