// This worker's ONLY job is to fetch the BEU exam list and add CORS headers
const BEU_API_URL = 'https://beu-bih.ac.in/backend/v1/result/sem-get';

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight (OPTIONS)
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    // Use cache to avoid hitting BEU's server every time
    const cache = caches.default;
    const cacheKey = new Request(BEU_API_URL, { headers: request.headers });
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
        'Cache-Control': 'public, s-maxage=3600' // Cache for 1 hour
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
