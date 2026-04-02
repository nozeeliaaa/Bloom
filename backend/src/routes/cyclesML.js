// cyclesML.js
// Route: POST /api/cycles/predict
//
// Strategy:
//   < 3 cycles  → rule-based weighted average (fallback)
//   3+ cycles   → ML model (cycle_predict.py)
//   ML fails    → rule-based weighted average (fallback)
//
// Always returns the same response shape:
// {
//   prediction: { predicted_cycle_length, method, confidence },
// }

import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireConsent } from "../middleware/requireConsent.js";
import { requireAuth } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const CYCLE_SCRIPT = path.join(__dirname, '../../ml/inference/cycle_predict.py');
const router = express.Router();

// ── Python runner ────────────────────────────────────────────

function runPython(scriptPath, args) {
    return new Promise((resolve, reject) => {
        const python = spawn('python3', [scriptPath, ...args.map(String)]);
        let output = '';
        let errorOutput = '';
        python.stdout.on('data', (data) => { output += data.toString(); });
        python.stderr.on('data', (data) => { errorOutput += data.toString(); });
        python.on('close', (code) => {
            if (code !== 0) return reject(new Error(`Python failed: ${errorOutput}`));
            try {
                const result = JSON.parse(output.trim());
                if (result.error) return reject(new Error(result.error));
                resolve(result);
            } catch (e) {
                reject(new Error(`Failed to parse Python output: ${output}`));
            }
        });
    });
}

// ── Fallback: rule-based weighted average ────────────────────
//
// runs on the backend. Recent cycles get higher weight.
// Falls back to userTypicalCycleLength if no history exists.

function weightedAverageFallback(cycleHistory, userTypicalCycleLength = 28) {
    if (!cycleHistory || cycleHistory.length === 0) {
        return {
            predicted_cycle_length: userTypicalCycleLength,
            method:     'default',
            confidence: 'low',
            message:    'No cycle history yet. Using typical cycle length as estimate.'
        };
    }

    const n       = cycleHistory.length;
    const weights = Array.from({ length: n }, (_, i) => i + 1); // linear weights
    const sumW    = weights.reduce((a, w) => a + w, 0);
    const weighted = weights.reduce((a, w, i) => a + w * cycleHistory[i], 0) / sumW;
    const clamped  = Math.max(21, Math.min(45, Math.round(weighted)));

    // Confidence based on variability
    const mean    = cycleHistory.reduce((a, b) => a + b, 0) / n;
    const stdDev  = Math.sqrt(cycleHistory.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / n);
    const confidence = stdDev < 2 ? 'high' : stdDev < 4 ? 'medium' : 'low';

    return {
        predicted_cycle_length: clamped,
        method:     'rule-based-weighted-average',
        confidence,
        message:    `Estimated from your last ${n} cycle${n !== 1 ? 's' : ''} using weighted average.`
    };
}

// ── Helper: std dev ──────────────────────────────────────────

function calculateStdDev(arr) {
    if (!arr || arr.length < 2) return 1.5;
    const mean     = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
}

// ── Route: POST /api/cycles/predict ─────────────────────────

router.post('/predict', requireAuth, requireConsent, async (req, res) => {
    try {
        const {
            cycleLength,
            meanCycleLength,
            lutealPhaseLength   = 14,
            cycleNumber         = 1,
            age                 = 28,
            bmi                 = 22,
            unusualBleeding     = 0,
            reproductiveCategory = 0,
            cycleHistory        = []
        } = req.body;

        // ── Fallback for new users (< 3 cycles) ─────────────
        if (cycleHistory.length < 3) {
            const fallback = weightedAverageFallback(cycleHistory);
            return res.json({ prediction: fallback });
        }

        // ── ML model for established users (3+ cycles) ───────
        const cycleVariability = calculateStdDev(cycleHistory);

        try {
            const cycleResult = await runPython(CYCLE_SCRIPT, [
                cycleLength,
                meanCycleLength,
                lutealPhaseLength,
                cycleVariability,
                cycleNumber,
                age,
                bmi,
                unusualBleeding,
                reproductiveCategory
            ]);

            console.log('[cyclesML] prediction:', {
                predicted_cycle_length: cycleResult.predictedCycleLength,
                method:                 'ml-weighted-ols',
                cycleHistory,
                cycleVariability
            });

            return res.json({
                prediction: {
                    predicted_cycle_length: cycleResult.predictedCycleLength,
                    method:     'ml-weighted-ols',
                    confidence: 'high',
                    message:    cycleResult.message
                }
            });

        } catch (mlErr) {
            // ── ML failed — fall back to weighted average ─────
            console.warn('[cyclesML] ML failed, using fallback:', mlErr.message);
            const fallback = weightedAverageFallback(cycleHistory);
            return res.json({ prediction: fallback });
        }

    } catch (err) {
        console.error('[cyclesML] predict failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

export default router;