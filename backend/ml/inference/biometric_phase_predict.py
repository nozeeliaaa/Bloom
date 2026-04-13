import sys
import json
import os
import joblib
import pandas as pd

MODEL_PATH = os.path.join(os.path.dirname(__file__), "../artifacts/biometric_phase_model.pkl")
ENCODER_PATH = os.path.join(os.path.dirname(__file__), "../artifacts/phase_label_encoder.pkl")
IMPUTER_PATH = os.path.join(os.path.dirname(__file__), "../artifacts/phase_imputer.pkl")
FEATURES_PATH = os.path.join(os.path.dirname(__file__), "../artifacts/phase_features.pkl")


def predict_phase(feature_values):
    model = joblib.load(MODEL_PATH)
    le = joblib.load(ENCODER_PATH)
    imputer = joblib.load(IMPUTER_PATH)
    feature_cols = joblib.load(FEATURES_PATH)

    input_df = pd.DataFrame([feature_values], columns=feature_cols)
    input_imputed = pd.DataFrame(imputer.transform(input_df), columns=feature_cols)

    prediction = model.predict(input_imputed)[0]
    phase_name = le.inverse_transform([int(prediction)])[0]

    proba = model.predict_proba(input_imputed)[0]
    confidence = round(float(max(proba)) * 100, 1)

    return {
        "phase": phase_name,
        "confidence": confidence,
        "message": f"You appear to be in the {phase_name} phase ({confidence}% confidence)."
    }


if __name__ == "__main__":
    expected_args = 13

    if len(sys.argv) != expected_args + 1:
        print(json.dumps({
            "error": f"Expected {expected_args} arguments, got {len(sys.argv) - 1}"
        }))
        sys.exit(1)

    try:
        feature_cols = joblib.load(FEATURES_PATH)

        values = [float(x) for x in sys.argv[1:]]

        feature_values = dict(zip(feature_cols, values))

        result = predict_phase(feature_values)
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)