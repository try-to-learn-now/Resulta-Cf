// src/utils.js (Shared Helper Code - NO KV, Cache Success Only)

// --- Configuration ---
export const REGULAR_BACKEND_URL = 'https://multi-result-beu-regular.vercel.app/api/regular/result';
export const LE_BACKEND_URL = 'https://multi-result-beu-le.vercel.app/api/le/result';
export const CACHE_TTL = 4 * 24 * 60 * 60; // 4 days in seconds
export const BATCH_STEP = 5;
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * --- Core Caching Function ---
 * Checks cache. Fetches if needed.
 * Caches ONLY if the entire fetched batch contains NO temporary errors ('Error', 'Timed Out').
 * Returns the fetched/cached batch data (Array).
 */
export async function getCachedOrFetchBatch(baseUrl, regNo, queryParams, ctx) {
  const { year, semester, exam_held } = queryParams;
  const targetUrl = `${baseUrl}?reg_no=${regNo}&year=${year}&semester=${semester}&exam_held=${encodeURIComponent(exam_held)}`;
  const cacheKey = new Request(targetUrl);

  try {
    // 1. Check Cache
    const cachedResponse = await caches.default.match(cacheKey);
    if (cachedResponse) {
      // console.log(`[${regNo}] Cache HIT`);
      return cachedResponse.json(); // Return cached data
    }

    // 2. Cache MISS: Fetch from Vercel
    // console.log(`[${regNo}] Cache MISS. Fetching...`);
    const freshBatch = await fetchVercelBatch(baseUrl, regNo, queryParams);

    // 3. Analyze the result - Check if ANY item in the batch indicates a temporary error
    const isBadBatch = Array.isArray(freshBatch) && freshBatch.some(r => r?.status?.includes('Error')); // Check specifically for "Error" status

    if (isBadBatch) {
      console.log(`[${regNo}] Fetch FAILED (Contains Errors). Returning error data, NOT caching.`);
      // --- DO NOTHING ELSE - JUST RETURN THE ERROR BATCH ---
      return freshBatch;

    } else if (Array.isArray(freshBatch)) {
      // --- GOOD BATCH (Cache it!) ---
      // console.log(`[${regNo}] Fetch SUCCEEDED. Caching.`);
      const responseToCache = new Response(JSON.stringify(freshBatch), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${CACHE_TTL}` // Cache for 4 days
        }
      });
      // Cache in background
      ctx.waitUntil(caches.default.put(cacheKey, responseToCache.clone()));
      return freshBatch; // Return good data
    } else {
      // Handle unexpected non-array format from fetchVercelBatch helper
       console.error(`[${regNo}] Fetch returned non-array:`, freshBatch);
       // Treat this as a failure, return error but don't cache
       return [{ regNo: regNo, status: 'Error', reason: 'Worker Error: Invalid batch format received' }];
    }
  } catch (error) {
      // Catch errors during cache check or fetchVercelBatch call itself
      console.error(`Error in getCachedOrFetchBatch for ${regNo}: ${error.stack}`);
      // Return error structure but don't cache
      return [{ regNo: regNo, status: 'Error', reason: `Worker Internal Error: ${error.message}` }];
  }
}

/**
 * --- Helper Function: Pooled Concurrency ---
 * Runs an array of async functions sequentially (since batchSize=1 is default).
 */
export async function fetchInBatches(promiseFunctions, batchSize = 1) {
    let allResults = [];
    for (let i = 0; i < promiseFunctions.length; i += batchSize) {
        const batch = promiseFunctions.slice(i, i + batchSize);
        const batchPromises = batch.map(fn => fn());
        // Use Promise.allSettled to ensure all fetches complete even if some fail
        const results = await Promise.allSettled(batchPromises);
        allResults = allResults.concat(results);
    }
    return allResults;
}


/**
 * --- Helper Function: Fetch Vercel Batch ---
 * Fetches one batch (5 students) from Vercel. Returns Array. Never rejects.
 * Handles Vercel errors, BEU errors, timeouts, and JSON parsing errors.
 */
export async function fetchVercelBatch(baseUrl, regNo, queryParams) {
   const { year, semester, exam_held } = queryParams;
   const targetUrl = `${baseUrl}?reg_no=${regNo}&year=${year}&semester=${semester}&exam_held=${encodeURIComponent(exam_held)}`;
   const controller = new AbortController();
   // Increased timeout slightly for Vercel function execution + BEU fetch
   const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s timeout

   try {
       const response = await fetch(targetUrl, {
           signal: controller.signal,
           headers: { 'Accept': 'application/json', 'User-Agent': 'Cloudflare-MultiWorker-Simple' } // Updated Agent
       });
       clearTimeout(timeoutId); // Clear timeout if fetch completes

       // Check for server-side errors from Vercel itself (e.g., 500, 502, 504)
       if (!response.ok) {
             const errorText = await response.text();
            console.warn(`Vercel backend HTTP error for ${regNo}: ${response.status} ${response.statusText} - ${errorText}`);
            // Return a consistent error format for the batch
             // Calculate potential regNos in the failed batch for better error reporting
            const baseNum = parseInt(regNo.slice(-3));
            const batchRegNos = Array.from({ length: BATCH_STEP }, (_, i) => `${regNo.slice(0,-3)}${String(baseNum + i).padStart(3,'0')}`);
            return batchRegNos.map(rn => ({
                regNo: rn,
                status: 'Error',
                reason: `Backend Error: HTTP ${response.status}`
            }));
       }

       // Try to parse the JSON response
       try {
            const data = await response.json();
            // Ensure Vercel returns an array (as expected from its logic)
            if (!Array.isArray(data)) {
                 console.error(`Vercel response for ${regNo} is not an array:`, data);
                 const baseNum = parseInt(regNo.slice(-3));
                 const batchRegNos = Array.from({ length: BATCH_STEP }, (_, i) => `${regNo.slice(0,-3)}${String(baseNum + i).padStart(3,'0')}`);
                 return batchRegNos.map(rn => ({
                    regNo: rn,
                    status: 'Error',
                    reason: 'Backend Response Invalid Format'
                 }));
            }
            // Add regNo to error objects if Vercel didn't (safety check)
            // Ensure Vercel's response structure is respected
            const baseNum = parseInt(regNo.slice(-3));
            return data.map((item, i) => {
                 // Vercel should already include regNo, but add defensively if missing on error/not_found
                if (!item.regNo && (item.status?.includes('Error') || item.status === 'Record not found')) {
                    item.regNo = `${regNo.slice(0,-3)}${String(baseNum + i).padStart(3,'0')}`;
                }
                return item;
            });
       } catch (jsonError) {
             console.error(`Failed to parse JSON response from ${targetUrl}: ${jsonError}`);
             // Return error format for the batch
            const baseNum = parseInt(regNo.slice(-3));
            const batchRegNos = Array.from({ length: BATCH_STEP }, (_, i) => `${regNo.slice(0,-3)}${String(baseNum + i).padStart(3,'0')}`);
            return batchRegNos.map(rn => ({
                regNo: rn,
                status: 'Error',
                reason: `Backend Response JSON Parse Error`
            }));
       }
   } catch (error) {
        clearTimeout(timeoutId); // Clear timeout if fetch fails
        let reason = error.name === 'AbortError' ? 'Request Timed Out (35s)' : error.message;
        console.warn(`FetchVercelBatch failed for ${regNo}: ${reason}`);
        // Return error format for the batch
        const baseNum = parseInt(regNo.slice(-3));
        const batchRegNos = Array.from({ length: BATCH_STEP }, (_, i) => `${regNo.slice(0,-3)}${String(baseNum + i).padStart(3,'0')}`);
        return batchRegNos.map(rn => ({
            regNo: rn,
            status: 'Error',
            reason: `Fetch Failed: ${reason}`
        }));
   }
}

// Helper to calculate prefixes - needed by multiple workers
export function calculatePrefixes(regNo) {
    const firstTwo = regNo.slice(0, 2);
    const restReg = regNo.slice(2, -3);
    const suffixNum = parseInt(regNo.slice(-3));
    let regularPrefix, lePrefix;

    if (suffixNum >= 900) { // Input is LE
        lePrefix = regNo.slice(0, -3);
        regularPrefix = (parseInt(firstTwo) - 1).toString() + restReg;
    } else { // Input is Regular
        regularPrefix = regNo.slice(0, -3);
        lePrefix = (parseInt(firstTwo) + 1).toString() + restReg;
    }
    return { regularPrefix, lePrefix };
}
