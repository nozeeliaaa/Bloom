"""
bloom_cycle_train.py
────────────────────
Loads cycle_train.csv, trains a Weighted OLS Linear Regression
and saves cycle_model.pkl.

Run AFTER bloom_cycle_make_dataset.py.
"""

import pandas as pd
import numpy as np
import joblib
from sklearn.linear_model import LinearRegression

TRAIN_PATH  = "/kaggle/working/cycle_train.csv"
OUTPUT_PATH = "/kaggle/working/cycle_model.pkl"

FEATURES = [
    'LengthofCycle', 'MeanCycleLength', 'LengthofLutealPhase',
    'CycleVariability', 'CycleNumber', 'Age', 'BMI',
    'UnusualBleeding', 'ReproductiveCategory'
]
TARGET = 'NextCycleLength'

train_df = pd.read_csv(TRAIN_PATH)
print(f"Training data loaded: {train_df.shape}")

X_train = train_df[FEATURES]
y_train = train_df[TARGET]
w_train = train_df['SampleWeight']

model = LinearRegression()
model.fit(X_train, y_train, sample_weight=w_train)

print("Linear Regression (Weighted OLS) trained successfully.")

joblib.dump(model, OUTPUT_PATH)
print(f"Model saved to: {OUTPUT_PATH}")