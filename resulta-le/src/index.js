// src/index.js for resulta-le worker
// Fetches batches for LE students in the range 901-960

import { getCachedOrFetchBatch, fetchInBatches, BATCH_STEP, CORS_HEADERS, LE_BACKEND_URL, calculatePrefixes } from './utils';

// --- Define Range for THIS Worker ---
const START_NUM = 901;
const END_NUM = 960; // Fetch potential LE range up to 60 students

export default {
    async fetch(request, env, ctx) { // env unused
        if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
        if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: CORS_HEADERS });

        const url = new URL(request.url);
        const params = url.searchParams;
        const regNo = params.get('reg_no');
        if (!regNo || !/^\d{11}$/.test(regNo)) { /* error */ }
        const year = params.get('year');
        const semester = params.get('semester');
        const examHeld = params.get('exam_held');
        if (!year || !semester || !examHeld) { /* error */ }
         if (!regNo || !/^\d{11}$/.test(regNo)) { return new Response(JSON.stringify({ error: 'Invalid "reg_no"' }), { status: 400, headers: CORS_HEADERS }); }
        if (!year || !semester || !examHeld) { return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400, headers: CORS_HEADERS }); }


        const queryParams = { year, semester, exam_held: examHeld };
        // Calculate the correct LE prefix using the helper
        const { lePrefix } = calculatePrefixes(regNo);

        const fetchTasks = [];
        for (let i = START_NUM; i <= END_NUM; i += BATCH_STEP) {
            const batchRegNo = lePrefix + String(i).padStart(3, '0');
            fetchTasks.push(() => getCachedOrFetchBatch(LE_BACKEND_URL, batchRegNo, queryParams, ctx));
        }

        console.log(`LE Worker (${START_NUM}-${END_NUM}): Executing ${fetchTasks.length} tasks serially...`);
        try {
           // Execute, combine, sort (same logic as reg workers)
            const resultsSettled = await fetchInBatches(fetchTasks, 1);
            let combinedData = [];
             resultsSettled.forEach(result => {
                if (result.status === 'fulfilled' && Array.isArray(result.value)) { combinedData.push(...result.value); }
                else if (result.status === 'rejected'){ combinedData.push({ regNo: 'Unknown', status: 'Error', reason: `Worker Error: ${result.reason?.message || result.reason}` }); }
                else if (result.status === 'fulfilled' && !Array.isArray(result.value)) { combinedData.push({ regNo: 'Unknown', status: 'Error', reason: `Worker Error: Invalid batch format` }); }
            });
            const uniqueData = Array.from(new Map(combinedData.map(item => [item.regNo || `error-${Math.random()}`, item])).values());
            const finalSortedData = uniqueData.sort((a, b) => (a.regNo || "").localeCompare(b.regNo || ""));

           return new Response(JSON.stringify(finalSortedData), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
        } catch(error) {
             console.error(`LE Worker (${START_NUM}-${END_NUM}) Error: ${error.stack}`);
             return new Response(JSON.stringify([{ regNo: 'Unknown', status: 'Error', reason: `Worker Critical Error: ${error.message}` }]), {
                 status: 500,
                 headers: CORS_HEADERS
             });
        }
    }
};
