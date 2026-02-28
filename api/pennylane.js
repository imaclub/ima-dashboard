// Vercel Serverless Function - Pennylane API Proxy
// Forwards requests to Pennylane API v2 to avoid CORS issues
// Token stored securely in Vercel Environment Variables (PENNYLANE_TOKEN)

export default async function handler(req, res) {
  // CORS headers for the dashboard
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { endpoint, ...queryParams } = req.query;

  // Token priority: 1) Vercel env var, 2) Authorization header
  const envToken = process.env.PENNYLANE_TOKEN;
  const headerToken = req.headers.authorization?.replace('Bearer ', '');
  const token = envToken || headerToken;

  if (!endpoint) {
    return res.status(400).json({ error: 'Missing "endpoint" parameter. Example: /api/pennylane?endpoint=/me' });
  }

  if (!token) {
    return res.status(401).json({
      error: 'No API token configured.',
      hint: 'Set PENNYLANE_TOKEN in Vercel Environment Variables, or pass Authorization: Bearer <token> header.'
    });
  }

  try {
    const baseUrl = 'https://app.pennylane.com/api/external/v2';

    // Clean the endpoint path
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

    // Build query string (exclude 'endpoint' param)
    const qs = new URLSearchParams(queryParams).toString();
    const url = `${baseUrl}${cleanEndpoint}${qs ? '?' + qs : ''}`;

    console.log(`[Pennylane Proxy] ${req.method} ${cleanEndpoint}`);

    // Forward request
    const fetchOptions = {
      method: req.method === 'POST' ? 'POST' : 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    };

    // Forward body for POST requests
    if (req.method === 'POST' && req.body) {
      fetchOptions.headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(url, fetchOptions);

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') || '60';
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: parseInt(retryAfter),
        message: `Pennylane API rate limit. Retry after ${retryAfter}s.`
      });
    }

    // Handle auth errors
    if (response.status === 401 || response.status === 403) {
      return res.status(response.status).json({
        error: 'Authentication failed',
        message: 'Token invalid, expired, or missing required scopes.',
        hint: 'Check your token in Pennylane > Paramètres > Connectivité > Développeurs'
      });
    }

    // Handle other errors
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: `Pennylane API error (${response.status})`,
        message: errorText,
      });
    }

    // Success - return data
    const data = await response.json();

    // Cache GET responses for 5 minutes
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('[Pennylane Proxy] Error:', error.message);
    return res.status(500).json({
      error: 'Proxy error',
      message: error.message,
    });
  }
}
