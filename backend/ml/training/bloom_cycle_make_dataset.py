"""
bloom_cycle_make_dataset.py
───────────────────────────
Loads raw cycle data, engineers features, and saves
clean train/test splits to disk.

Run this FIRST before training or evaluation.
"""

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

DATA_PATH  = "/kaggle/input/datasets/nikitabisht/menstrual-cycle-data/FedCycleData071012 (2).csv"
OUTPUT_DIR = "/kaggle/working/"
RANDOM_SEED = 42

data = pd.read_csv(DATA_PATH)

numeric_cols = [
    'LengthofCycle', 'MeanCycleLength', 'LengthofLutealPhase',
    'CycleNumber', 'Age', 'BMI', 'UnusualBleeding', 'ReproductiveCategory'
]
for col in numeric_cols:
    data[col] = pd.to_numeric(data[col], errors='coerce')

data = data[(data['LengthofCycle'] >= 15) & (data['LengthofCycle'] <= 60)]
data = data.sort_values(['ClientID', 'CycleNumber']).reset_index(drop=True)

data['NextCycleLength']  = data.groupby('ClientID')['LengthofCycle'].shift(-1)
data['CycleVariability'] = data.groupby('ClientID')['LengthofCycle'].transform('std')

features = [
    'LengthofCycle', 'MeanCycleLength', 'LengthofLutealPhase',
    'CycleVariability', 'CycleNumber', 'Age', 'BMI',
    'UnusualBleeding', 'ReproductiveCategory'
]
target = 'NextCycleLength'

df = data[features + [target]].dropna().copy()
df['SampleWeight'] = np.exp(0.1 * df['CycleNumber'])

print(f"Clean dataset shape: {df.shape}")

train_df, test_df = train_test_split(
    df, test_size=0.2, random_state=RANDOM_SEED
)

print(f"Train set: {train_df.shape}")
print(f"Test  set: {test_df.shape}")

train_df.to_csv(OUTPUT_DIR + "cycle_train.csv", index=False)
test_df.to_csv( OUTPUT_DIR + "cycle_test.csv",  index=False)

print(f"\nSaved: cycle_train.csv → {OUTPUT_DIR}")
print(f"Saved: cycle_test.csv  → {OUTPUT_DIR}")