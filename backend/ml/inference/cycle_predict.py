"""
cycle_predict.py
─────────────────
Called by Node.js with cycle features as arguments.
Prints a JSON result to stdout which Node.js reads back.

Usage:
  python3 cycle_predict.py <cycle_length> <mean_cycle_length> <luteal_phase> 
                           <cycle_variability> <cycle_number> <age> <bmi>
                           <unusual_bleeding> <reproductive_category>

Example:
  python3 cycle_predict.py 28 28.5 14 1.5 3 25 22 0 1
"""

import sys
import json
import os
import numpy as np
import pandas as pd
import joblib

MODEL_PATH = os.path.join(os.path.dirname(__file__), "../artifacts/cycle_model.pkl")

FEATURES = [
    'LengthofCycle', 'MeanCycleLength', 'LengthofLutealPhase',
    'CycleVariability', 'CycleNumber', 'Age', 'BMI',
    'UnusualBleeding', 'ReproductiveCategory'
]

def predict_cycle(values):
    model = joblib.load(MODEL_PATH)
    features = pd.DataFrame([dict(zip(FEATURES, values))])
    predicted = model.predict(features)[0]
    predicted = round(float(predicted), 1)

    return {
        'predictedCycleLength': predicted,
        'message': f'Your next cycle is predicted to be approximately {predicted} days.'
    }

if __name__ == "__main__":
    if len(sys.argv) != 10:
        print(json.dumps({'error': 'Expected 9 arguments: cycle_length mean_cycle_length luteal_phase cycle_variability cycle_number age bmi unusual_bleeding reproductive_category'}))
        sys.exit(1)

    try:
        values = [float(x) for x in sys.argv[1:]]
        result = predict_cycle(values)
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)