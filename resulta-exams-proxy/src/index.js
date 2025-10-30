// This worker's only job is to fetch the BEU exam list and add CORS headers

const BEU_API_URL = 'https://beu-bih.ac.in/backend/v1/result/sem-get';

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests (OPTIONS)
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    try {
      // Check cache first
      const cache = caches.default;
      const cacheKey = new Request(BEU_API_URL);
      let response = await cache.match(cacheKey);

      if (response) {
        console.log("Exam list: Cache HIT");
        // Re-create response to ensure our CORS header is present
        const data = await response.json();
        return new Response(JSON.stringify(data), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'X-Cache': 'HIT' // Custom header to see it's working
            }
        });
      }
      console.log("Exam list: Cache MISS");


      // Fetch data from the real BEU API
      response = await fetch(BEU_API_URL, {
          headers: {
              'Accept': 'application/json',
              'User-Agent': 'resulta-proxy-worker'
          }
      });

      if (!response.ok) {
        throw new Error(`BEU API Error: ${response.status}`);
      }

      // Get the data
      const data = await response.json();

      // Create a new response with the data AND our headers
      const jsonResponse = new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          // --- THIS IS THE MAGIC ---
          'Access-Control-Allow-Origin': '*', // Allow any website to call this
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          // Cache this response on Cloudflare's edge for 1 hour
          'Cache-Control': 'public, s-maxage=3600' 
        },
      });
      
      // Save to cache in the background
      ctx.waitUntil(cache.put(cacheKey, jsonResponse.clone()));

      return jsonResponse;

    } catch (error) {
      console.error('Error fetching from BEU API:', error);
      const errorResponse = new Response(JSON.stringify({ error: 'Failed to fetch exam list', details: error.message }), {
        status: 502, // Bad Gateway
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        },
      });
      return errorResponse;
    }
  },
};

// Standard CORS OPTIONS handler
function handleOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
