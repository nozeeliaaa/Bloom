"""
bloom_cycle_evaluate.py
────────────────────────
Loads cycle_test.csv and the saved model,
evaluates performance and prints a full report.

Run AFTER bloom_cycle_train.py.
"""

import numpy as np
import pandas as pd
import joblib
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import cross_val_score

MODEL_PATH = "/kaggle/working/cycle_model.pkl"
TEST_PATH  = "/kaggle/working/cycle_test.csv"
TRAIN_PATH = "/kaggle/working/cycle_train.csv"

FEATURES = [
    'LengthofCycle', 'MeanCycleLength', 'LengthofLutealPhase',
    'CycleVariability', 'CycleNumber', 'Age', 'BMI',
    'UnusualBleeding', 'ReproductiveCategory'
]
TARGET = 'NextCycleLength'

model    = joblib.load(MODEL_PATH)
test_df  = pd.read_csv(TEST_PATH)
train_df = pd.read_csv(TRAIN_PATH)

print(f"Model loaded:     {MODEL_PATH}")
print(f"Test data loaded: {test_df.shape}")

X_test = test_df[FEATURES]
y_test = test_df[TARGET]

pred = model.predict(X_test)
mae  = mean_absolute_error(y_test, pred)
r2   = r2_score(y_test, pred)
acc  = (np.abs(pred - y_test) <= 3).mean() * 100

print("\n" + "="*50)
print("EVALUATION REPORT")
print("="*50)
print(f"MAE      : {mae:.2f} days")
print(f"R²       : {r2:.3f}")
print(f"Accuracy : {acc:.1f}%  (predictions within ±3 days)")

full_df = pd.concat([train_df, test_df])
X_full  = full_df[FEATURES]
y_full  = full_df[TARGET]

cv = cross_val_score(model, X_full, y_full, cv=5, scoring='neg_mean_absolute_error')
print(f"Cross-validated MAE: {-cv.mean():.2f} ± {cv.std():.2f} days")

print("\nSample Predictions (first 10):")
results = X_test.copy()
results['Actual']    = y_test.values
results['Predicted'] = pred.round(1)
results['Error']     = (results['Predicted'] - results['Actual']).abs().round(1)
print(results[['Actual', 'Predicted', 'Error']].head(10).to_string(index=False))