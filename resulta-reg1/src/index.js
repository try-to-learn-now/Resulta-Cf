// src/index.js for resulta-reg1 worker
// Fetches batches for regular students in the range 1-60

import { getCachedOrFetchBatch, fetchInBatches, BATCH_STEP, CORS_HEADERS, REGULAR_BACKEND_URL, calculatePrefixes } from './utils';

// --- Define Range for THIS Worker ---
const START_NUM = 1;
const END_NUM = 60;

export default {
    async fetch(request, env, ctx) { // env unused
        if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
        if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: CORS_HEADERS });

        const url = new URL(request.url);
        const params = url.searchParams;
        const regNo = params.get('reg_no'); // Need base regNo to determine prefix
        // Basic validation
        if (!regNo || !/^\d{11}$/.test(regNo)) { return new Response(JSON.stringify({ error: 'Invalid "reg_no"' }), { status: 400, headers: CORS_HEADERS }); }
        const year = params.get('year');
        const semester = params.get('semester');
        const examHeld = params.get('exam_held');
        if (!year || !semester || !examHeld) { return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400, headers: CORS_HEADERS }); }

        const queryParams = { year, semester, exam_held: examHeld };
        // Calculate the correct regular prefix using the helper
        const { regularPrefix } = calculatePrefixes(regNo);

        const fetchTasks = []; // Array of functions to call
        for (let i = START_NUM; i <= END_NUM; i += BATCH_STEP) {
            const batchRegNo = regularPrefix + String(i).padStart(3, '0');
            // Create a function closure for each fetch task
            fetchTasks.push(() => getCachedOrFetchBatch(REGULAR_BACKEND_URL, batchRegNo, queryParams, ctx));
        }

        console.log(`Reg Worker (${START_NUM}-${END_NUM}): Executing ${fetchTasks.length} tasks serially...`);
        try {
           // Execute fetches sequentially (batchSize = 1)
           const resultsSettled = await fetchInBatches(fetchTasks, 1);
           let combinedData = [];
           resultsSettled.forEach(result => { // Combine results from all batches
               if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                   combinedData.push(...result.value);
               } else if (result.status === 'rejected'){
                   console.error(`Reg Worker (${START_NUM}-${END_NUM}) Fetch Rejected: ${result.reason}`);
                   // If a fetch promise itself fails, add placeholder errors for that batch
                   // Attempt to determine the batch regNo from the failed promise if possible (difficult)
                   // For simplicity, just add a generic error marker
                   combinedData.push({ regNo: `ErrorRange_${START_NUM}-${END_NUM}`, status: 'Error', reason: `Worker Fetch Error: ${result.reason?.message || result.reason}` });
               } else if (result.status === 'fulfilled' && !Array.isArray(result.value)) {
                   // Handle cases where getCachedOrFetchBatch returns a non-array error object
                   console.error(`Reg Worker (${START_NUM}-${END_NUM}) Non-Array Result:`, result.value);
                   combinedData.push(result.value); // Add the single error object
               }
           });
           // Remove duplicates and sort
           const uniqueData = Array.from(new Map(combinedData.map(item => [item.regNo || `error-${Math.random()}`, item])).values());
           const finalSortedData = uniqueData.sort((a, b) => (a.regNo || "").localeCompare(b.regNo || ""));

           return new Response(JSON.stringify(finalSortedData), {
               headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
           });
        } catch (error){
             console.error(`Reg Worker (${START_NUM}-${END_NUM}) Critical Error: ${error.stack}`);
             // Return valid JSON even on critical error
             return new Response(JSON.stringify([{ regNo: 'Unknown', status: 'Error', reason: `Worker Critical Error: ${error.message}` }]), {
                 status: 500,
                 headers: CORS_HEADERS
             });
        }
    }
};
