function configuredOrigins() {
  const configured = (Deno.env.get('APP_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (configured.length) return new Set(configured)

  // Secure development fallback. Production deployments should always define
  // APP_ALLOWED_ORIGINS explicitly (for example the Netlify site URL).
  return new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ])
}

export function isAllowedOrigin(origin: string | null) {
  if (!origin) return true // Non-browser/server clients are governed by application auth/rate limits.
  return configuredOrigins().has(origin)
}

export function corsHeadersFor(origin: string | null) {
  const allowed = isAllowedOrigin(origin)
  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  }
}
