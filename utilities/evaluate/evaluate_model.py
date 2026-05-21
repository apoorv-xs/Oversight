import os
import sys
import json
import pickle
import torch
import pandas as pd
import numpy as np

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(os.path.join(project_root, 'backend'))
sys.path.append(os.path.join(project_root, 'backend', 'ai_modules'))

try:
    # pyrefly: ignore [missing-import]
    from autoencoder import NetworkAutoencoder
    # pyrefly: ignore [missing-import]
    from feature_extractor import LIVE_FEATURES
except ImportError as e:
    print(f"Error importing modules: {e}")
    sys.exit(1)

def evaluate_accuracy():
    """
    Evaluates the localized Autoencoder model against the UNSW-NB15 testing dataset.
    This serves as a benchmarking utility to verify the anomaly detection performance
    against globally recognized attack patterns.
    """
    print("=" * 60)
    print("AI Model Accuracy Evaluator")
    print("=" * 60)

    model_dir = os.path.join(project_root, 'model')
    test_csv = os.path.join(project_root, 'dataset', 'UNSW_NB15_testing-set.csv')
    
    model_path = os.path.join(model_dir, 'autoencoder.pth')
    scaler_path = os.path.join(model_dir, 'scaler.pkl')
    threshold_path = os.path.join(model_dir, 'threshold.json')

    if not all(os.path.exists(p) for p in [model_path, scaler_path, threshold_path, test_csv]):
        print("[ERROR] Missing model artifacts or test dataset. Ensure training is complete.")
        input("Press Enter to exit...")
        return

    print("Loading saved model, scaler, and threshold...")
    # Load Scaler
    with open(scaler_path, 'rb') as f:
        scaler = pickle.load(f)

    # Load Threshold
    with open(threshold_path, 'r') as f:
        threshold_data = json.load(f)
        threshold = threshold_data['threshold']

    # Load Model
    model = NetworkAutoencoder(input_dim=len(LIVE_FEATURES))
    model.load_state_dict(torch.load(model_path, weights_only=True))
    model.eval()

    print(f"Loading test dataset from {os.path.basename(test_csv)}... (this may take a few seconds)")
    test_df = pd.read_csv(test_csv)
    
    if 'label' not in test_df.columns:
        print("no label column in test data, cant check accuracy")
        input("Press Enter to exit...")
        return

    # Extract features and labels
    numeric_test = test_df[LIVE_FEATURES]
    actual_labels = test_df['label'].values  # 1 = Anomaly, 0 = Normal

    # Scale and convert to tensor
    test_scaled = scaler.transform(numeric_test)
    test_tensor = torch.FloatTensor(test_scaled)

    print("Running predictions...")
    with torch.no_grad():
        reconstructed = model(test_tensor)
        # Calculate Mean Squared Error
        mse = torch.mean((test_tensor - reconstructed) ** 2, dim=1).numpy()

    # Predictions: True if MSE > threshold (Anomaly), False if MSE <= threshold (Normal)
    # Uses the dynamically calculated 99th percentile threshold
    predicted_anomalies = (mse > threshold).astype(int)

    # Calculate metrics
    true_positives = np.sum((predicted_anomalies == 1) & (actual_labels == 1))
    true_negatives = np.sum((predicted_anomalies == 0) & (actual_labels == 0))
    false_positives = np.sum((predicted_anomalies == 1) & (actual_labels == 0))
    false_negatives = np.sum((predicted_anomalies == 0) & (actual_labels == 1))

    total_samples = len(actual_labels)
    total_actual_anomalies = np.sum(actual_labels == 1)
    total_actual_normal = np.sum(actual_labels == 0)

    accuracy = (true_positives + true_negatives) / total_samples * 100
    detection_rate = (true_positives / total_actual_anomalies) * 100 if total_actual_anomalies > 0 else 0

    print("-" * 60)
    print("EVALUATION RESULTS")
    print("-" * 60)
    print(f"Total Samples Tested:    {total_samples:,}")
    print(f"  - Actual Anomalies:    {total_actual_anomalies:,}")
    print(f"  - Actual Normal:       {total_actual_normal:,}")
    print(f"\nCurrent Anomaly Threshold: {threshold:.6f}")
    print("-" * 60)
    print(f"Correctly Detected Anomalies (True Positives): {true_positives:,}")
    print(f"Correctly Ignored Normal (True Negatives):     {true_negatives:,}")
    print(f"False Alarms (False Positives):                {false_positives:,}")
    print(f"Missed Attacks (False Negatives):              {false_negatives:,}")
    
    if 'attack_cat' in test_df.columns:
        print("-" * 60)
        print("MISSED ATTACKS (FALSE NEGATIVES) BY CATEGORY")
        print("-" * 60)
        print(f"{'Attack Category':<18} | {'Total':<8} | {'Missed (FN)':<11} | {'Detection Rate':<14}")
        print("-" * 60)
        fn_mask = (predicted_anomalies == 0) & (actual_labels == 1)
        total_by_cat = test_df[test_df['label'] == 1].groupby('attack_cat').size()
        missed_by_cat = test_df[fn_mask].groupby('attack_cat').size()
        for cat in sorted(total_by_cat.index):
            tot = total_by_cat.get(cat, 0)
            msd = missed_by_cat.get(cat, 0)
            det_rate = ((tot - msd) / tot) * 100 if tot > 0 else 0.0
            print(f"{cat:<18} | {tot:<8,} | {msd:<11,} | {det_rate:>13.2f}%")
            
    print("-" * 60)
    print(f"OVERALL ACCURACY:          {accuracy:.2f}%")
    print(f"THREAT DETECTION RATE:     {detection_rate:.2f}%")
    print("=" * 60)
    
    input("Press Enter to exit...")

if __name__ == "__main__":
    evaluate_accuracy()
