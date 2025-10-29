// src/index.js for resulta-user worker
// Fetches ONLY the batch containing the user's registration number

import { getCachedOrFetchBatch, BATCH_STEP, CORS_HEADERS, REGULAR_BACKEND_URL, LE_BACKEND_URL } from './utils';

export default {
    async fetch(request, env, ctx) { // env is unused
        if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
        if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: CORS_HEADERS });

        const url = new URL(request.url);
        const params = url.searchParams;
        const regNo = params.get('reg_no');
        // Basic validation
        if (!regNo || !/^\d{11}$/.test(regNo)) { return new Response(JSON.stringify({ error: 'Invalid or missing "reg_no" parameter (must be 11 digits)' }), { status: 400, headers: CORS_HEADERS }); }
        const year = params.get('year');
        const semester = params.get('semester');
        const examHeld = params.get('exam_held');
        if (!year || !semester || !examHeld) { return new Response(JSON.stringify({ error: 'Missing required parameters: "year", "semester", and "exam_held"' }), { status: 400, headers: CORS_HEADERS }); }

        const queryParams = { year, semester, exam_held: examHeld };
        const suffixNum = parseInt(regNo.slice(-3));
        let probeBaseUrl, userBatchStartRegNo;

        // Determine which Vercel backend and calculate the starting reg_no of the user's batch
        if (suffixNum >= 900) { // LE Student
            probeBaseUrl = LE_BACKEND_URL;
            const userBatchStartNum = Math.floor((suffixNum - 901) / BATCH_STEP) * BATCH_STEP + 901;
            userBatchStartRegNo = regNo.slice(0,-3) + String(userBatchStartNum).padStart(3, '0');
        } else { // Regular Student
            probeBaseUrl = REGULAR_BACKEND_URL;
            const userBatchStartNum = Math.floor((suffixNum - 1) / BATCH_STEP) * BATCH_STEP + 1;
            userBatchStartRegNo = regNo.slice(0,-3) + String(userBatchStartNum).padStart(3, '0');
        }

        console.log(`User Worker: Fetching batch starting with ${userBatchStartRegNo} for user ${regNo}`);
        try {
           // Fetch only the single batch the user belongs to
           const results = await getCachedOrFetchBatch(probeBaseUrl, userBatchStartRegNo, queryParams, ctx);

           // Ensure results is an array before sending
           const responseData = Array.isArray(results) ? results : [{regNo: userBatchStartRegNo, status: "Error", reason: "Worker Error: Invalid data format"}];

           return new Response(JSON.stringify(responseData), {
               headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
           });
        } catch (error){
            console.error(`User Worker Error fetching batch ${userBatchStartRegNo}: ${error.stack}`);
            // Return a valid JSON array even on critical errors
            const baseNum = parseInt(userBatchStartRegNo.slice(-3));
            const batchRegNos = Array.from({ length: BATCH_STEP }, (_, i) => `${userBatchStartRegNo.slice(0,-3)}${String(baseNum + i).padStart(3,'0')}`);
            const errorResponse = batchRegNos.map(rn => ({ regNo: rn, status: 'Error', reason: `Worker Critical Error: ${error.message}` }));
            return new Response(JSON.stringify(errorResponse), {
                status: 500,
                headers: CORS_HEADERS
            });
        }
    }
};
