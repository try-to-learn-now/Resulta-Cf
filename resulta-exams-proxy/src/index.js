// This worker's ONLY job is to fetch the BEU exam list, add CORS, and cache it.
const BEU_API_URL = 'https://beu-bih.ac.in/backend/v1/result/sem-get';

export default {
  async fetch(request, env, ctx) {
    const cache = caches.default;
    const cacheKey = new Request(BEU_API_URL); // Use a single cache key

    // === Handle Secret PURGE Command ===
    if (request.method === 'PURGE') {
      // Check for the secret header.
      // This MUST match the secret you set in your env.
      if (request.headers.get('X-PURGE-SECRET') !== env.MY_SECRET_TOKEN) {
        return new Response(JSON.stringify({ error: 'Invalid secret token' }), { status: 401 });
      }
      
      await cache.delete(cacheKey);
      console.log('CACHE PURGED');
      return new Response(JSON.stringify({ purged: true }), { status: 200 });
    }
    // === END NEW ===

    // Handle CORS preflight (OPTIONS)
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    // Check cache for normal GET requests
    let response = await cache.match(cacheKey);

    if (response) {
      console.log("Exam list: Cache HIT");
      // Re-create response to add our own CORS headers
      const data = await response.json();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'X-Cache-Status': 'HIT'
        }
      });
    }
    console.log("Exam list: Cache MISS");

    // Fetch from the real BEU API
    response = await fetch(BEU_API_URL, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'resulta-proxy-worker' }
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch from BEU API' }), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Create a new response to add our headers
    const data = await response.json();
    const newResponse = new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // The magic header
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        //
        // --- YOUR FINAL FIX IS HERE ---
        // Cache for 30 DAYS (2592000s).
        // It will never expire between your manual updates.
        // This is the "fast as fuck" setting.
        'Cache-Control': 'public, s-maxage=2592000' 
        //
      }
    });

    ctx.waitUntil(cache.put(cacheKey, newResponse.clone())); // Cache it
    return newResponse;
  },
};

function handleOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS, PURGE', // Allow PURGE
      'Access-Control-Allow-Headers': 'Content-Type, X-PURGE-SECRET', // Allow secret header
    },
  });
}
