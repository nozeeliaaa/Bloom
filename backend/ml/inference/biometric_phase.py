import json
import sys

import joblib
import numpy as np
import pandas as pd
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parents[1] / "artifacts"

MODEL_PATH = MODEL_DIR / "biometric_phase_model.pkl"
ENCODER_PATH = MODEL_DIR / "phase_label_encoder.pkl"
IMPUTER_PATH = MODEL_DIR / "phase_imputer.pkl"
FEATURES_PATH = MODEL_DIR / "phase_features.pkl"


class BiometricPhasePredictor:
    def __init__(self):
        self.model = joblib.load(MODEL_PATH)
        self.label_encoder = joblib.load(ENCODER_PATH)
        self.imputer = joblib.load(IMPUTER_PATH)
        self.feature_cols = joblib.load(FEATURES_PATH)

    def _prepare_input(self, user_input: dict) -> pd.DataFrame:
        row = pd.DataFrame(
            [{feature: user_input.get(feature, np.nan) for feature in self.feature_cols}]
        )
        row_imputed = pd.DataFrame(
            self.imputer.transform(row),
            columns=self.feature_cols
        )
        return row_imputed

    def predict(self, user_input: dict) -> dict:
        X = self._prepare_input(user_input)

        pred_encoded = self.model.predict(X)[0]
        pred_label = self.label_encoder.inverse_transform([pred_encoded])[0]

        probs = self.model.predict_proba(X)[0]
        class_names = self.label_encoder.classes_

        probability_map = {
            cls: float(prob) for cls, prob in zip(class_names, probs)
        }

        confidence = float(np.max(probs))

        return {
            "predicted_phase": pred_label,
            "probabilities": probability_map,
            "confidence": confidence,
            "model_type": "random_forest_symptom_steps",
            "features_used": self.feature_cols,
        }


_predictor = None


def get_predictor():
    global _predictor
    if _predictor is None:
        _predictor = BiometricPhasePredictor()
    return _predictor


def predict_biometric_phase(user_input: dict) -> dict:
    predictor = get_predictor()
    return predictor.predict(user_input)


if __name__ == "__main__":
    stdin_payload = sys.stdin.read().strip()

    if stdin_payload:
        try:
            user_input = json.loads(stdin_payload)
            result = predict_biometric_phase(user_input)
            print(json.dumps(result))
        except Exception as exc:
            print(json.dumps({"error": str(exc)}))
            sys.exit(1)
    else:
        sample_input = {
            "day_in_study": 14,
            "headaches": 2,
            "cramps": 1,
            "sorebreasts": 2,
            "fatigue": 3,
            "sleepissue": 2,
            "moodswing": 2,
            "stress": 2,
            "foodcravings": 2,
            "indigestion": 1,
            "bloating": 2,
            "daily_steps": 8000,
        }

        result = predict_biometric_phase(sample_input)
        print(json.dumps(result))
