import express from "express";
import { spawn } from "child_process";

const router = express.Router();

const PYTHON_SCRIPT =
  "/home/jemoresstewart/noice/public/ml/inference/biometric_phase_predict.py";

console.log("PYTHON_SCRIPT =", PYTHON_SCRIPT);

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function daysSince(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 0;

  return Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))
  );
}

router.post("/predict", (req, res) => {
  try {
    const body = req.body ?? {};
    const symptoms = body.symptoms ?? {};
    const biometrics = body.biometrics ?? {};

    const dayInStudy =
      body.day_in_study != null
        ? safeNumber(body.day_in_study, 0)
        : daysSince(body.lastPeriodDate);

    const flowVolume = safeNumber(
      body.flow_volume ?? symptoms.flow_volume ?? 0,
      0
    );

    const userInput = {
      day_in_study: dayInStudy,
      bleeding_present:
        body.bleeding_present != null
          ? safeNumber(body.bleeding_present, 0)
          : flowVolume > 0
          ? 1
          : 0,

      headaches: safeNumber(body.headaches ?? symptoms.headaches, 0),
      cramps: safeNumber(body.cramps ?? symptoms.cramps, 0),
      sorebreasts: safeNumber(body.sorebreasts ?? symptoms.sorebreasts, 0),
      fatigue: safeNumber(body.fatigue ?? symptoms.fatigue, 0),
      sleepissue: safeNumber(body.sleepissue ?? symptoms.sleepissue, 0),
      moodswing: safeNumber(body.moodswing ?? symptoms.moodswing, 0),
      stress: safeNumber(body.stress ?? symptoms.stress, 0),
      foodcravings: safeNumber(body.foodcravings ?? symptoms.foodcravings, 0),
      indigestion: safeNumber(body.indigestion ?? symptoms.indigestion, 0),
      bloating: safeNumber(body.bloating ?? symptoms.bloating, 0),
      daily_steps: safeNumber(
        body.daily_steps ?? biometrics.daily_steps ?? biometrics.steps,
        0
      ),
    };

    const pythonArgs = [
      PYTHON_SCRIPT,
      String(userInput.day_in_study),
      String(userInput.bleeding_present),
      String(userInput.headaches),
      String(userInput.cramps),
      String(userInput.sorebreasts),
      String(userInput.fatigue),
      String(userInput.sleepissue),
      String(userInput.moodswing),
      String(userInput.stress),
      String(userInput.foodcravings),
      String(userInput.indigestion),
      String(userInput.bloating),
      String(userInput.daily_steps),
    ];

    console.log("Python args:", pythonArgs);

    const py = spawn("python3", pythonArgs);

    let dataString = "";
    let errorString = "";

    py.stdout.on("data", (data) => {
      dataString += data.toString();
    });

    py.stderr.on("data", (data) => {
      errorString += data.toString();
    });

    py.on("error", (err) => {
      console.error("Spawn error:", err);
      return res.status(500).json({
        error: "Could not start Python process",
        details: err.message,
      });
    });

    py.on("close", (code) => {
      if (code !== 0) {
        console.error("Python error:", errorString || dataString);
        return res.status(500).json({
          error: "Phase prediction failed",
          details: errorString || dataString || `Python exited with code ${code}`,
        });
      }

      try {
        const result = JSON.parse(dataString);

        if (result?.error) {
          return res.status(500).json({
            error: "Phase prediction failed",
            details: result.error,
          });
        }

        return res.json({
          ...result,
          source: "model",
          input_used: userInput,
        });
      } catch (e) {
        console.error("Parse error:", dataString);
        return res.status(500).json({
          error: "Invalid response from model",
          details: dataString || e.message,
        });
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
});

export default router;