# trains the autoencoder and exports it to onnx for use in the dashboard
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from sklearn.preprocessing import MinMaxScaler
import pickle
import json
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from autoencoder import NetworkAutoencoder

# Feature columns used for training
LIVE_FEATURES = [
    'dur', 'spkts', 'dpkts', 'sbytes', 'dbytes', 'rate', 'sttl', 'dttl',
    'sload', 'dload', 'swin', 'dwin', 'smean', 'dmean'
]

def _train_and_save_model(normal_data, model_dir):
    # shared training logic - both train_and_evaluate and retrain_from_csv use this
    # Neural networks need scaled data [0, 1]
    scaler = MinMaxScaler()
    scaled_data = scaler.fit_transform(normal_data)

    # Convert to PyTorch tensors
    tensor_data = torch.FloatTensor(scaled_data)
    
    # Create DataLoader for batching
    dataset = torch.utils.data.TensorDataset(tensor_data, tensor_data)
    dataloader = torch.utils.data.DataLoader(dataset, batch_size=256, shuffle=True)

    # Initialize model
    model = NetworkAutoencoder(input_dim=len(LIVE_FEATURES))
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    print("training the autoencoder...")
    epochs = 10
    model.train()
    for epoch in range(epochs):
        epoch_loss = 0
        for batch_x, _ in dataloader:
            optimizer.zero_grad()
            outputs = model(batch_x)
            loss = criterion(outputs, batch_x)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item()
        
        if (epoch+1) % 2 == 0:
            print(f"Epoch [{epoch+1}/{epochs}], Loss: {epoch_loss/len(dataloader):.6f}")

    print("calculating threshold...")
    model.eval()
    with torch.no_grad():
        reconstructed = model(tensor_data)
        mse = torch.mean((tensor_data - reconstructed) ** 2, dim=1).numpy()
        
    # Set threshold at the 99th percentile of normal training data errors
    threshold = float(np.percentile(mse, 99))
    print(f"calculated threshold: {threshold:.6f}")

    os.makedirs(model_dir, exist_ok=True)
    
    # Save the model, scaler, and threshold
    torch.save(model.state_dict(), os.path.join(model_dir, 'autoencoder.pth'))
    with open(os.path.join(model_dir, 'scaler.pkl'), 'wb') as f:
        pickle.dump(scaler, f)
    with open(os.path.join(model_dir, 'threshold.json'), 'w') as f:
        json.dump({'threshold': threshold}, f)

    # Export to ONNX
    try:
        import sys
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8')
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8')
        dummy_input = torch.randn(1, len(LIVE_FEATURES))
        onnx_path = os.path.join(model_dir, 'autoencoder.onnx')
        torch.onnx.export(
            model, dummy_input, onnx_path, export_params=True, opset_version=18,
            do_constant_folding=True, input_names=['input'], output_names=['output'],
            dynamic_axes={'input': {0: 'batch_size'}, 'output': {0: 'batch_size'}}
        )
        print(f"exported onnx model to {onnx_path}")
    except Exception as e:
        print(f"failed to export onnx: {e}")

    print(f"model assets saved to {model_dir}")
    return model, scaler, threshold

def train_and_evaluate(train_path, test_path, model_dir):
    # initial training from the UNSW dataset, also runs evaluation on the test set
    print(f"loading training data from {train_path}...")
    train_df = pd.read_csv(train_path)

    # We only train on NORMAL traffic so the Autoencoder learns the baseline
    if 'label' in train_df.columns:
        normal_data = train_df[train_df['label'] == 0][LIVE_FEATURES]
    else:
        print("no label column, assuming normal baseline")
        normal_data = train_df[LIVE_FEATURES]

    print(f"selected {len(normal_data)} normal samples for training.")

    model, scaler, threshold = _train_and_save_model(normal_data, model_dir)

    # Evaluation
    if os.path.exists(test_path):
        print(f"loading testing data from {test_path}...")
        test_df = pd.read_csv(test_path)
        numeric_test = test_df[LIVE_FEATURES]
        
        test_scaled = scaler.transform(numeric_test)
        test_tensor = torch.FloatTensor(test_scaled)
        
        print("evaluating model on test set")
        with torch.no_grad():
            test_reconstructed = model(test_tensor)
            test_mse = torch.mean((test_tensor - test_reconstructed) ** 2, dim=1).numpy()
            
        anomalies_detected = (test_mse > threshold).sum()
        normal_detected = (test_mse <= threshold).sum()

        print(f"anomalies flagged: {anomalies_detected}")
        print(f"normal traffic passed: {normal_detected}")
        print(f"total test samples: {len(test_df)}")

def retrain_from_csv(csv_path, model_dir):
    # lightweight retrain used at runtime - skips evaluation to keep it fast
    print(f"loading baseline data from {csv_path}...")
    train_df = pd.read_csv(csv_path)

    # Assuming all data in the baseline CSV is normal traffic
    normal_data = train_df[LIVE_FEATURES]

    print(f"selected {len(normal_data)} normal samples for retraining.")

    _train_and_save_model(normal_data, model_dir)

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description='Train autoencoder anomaly detection model')
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    train_csv = os.path.join(project_root, 'dataset', 'UNSW_NB15_training-set.csv')
    test_csv = os.path.join(project_root, 'dataset', 'UNSW_NB15_testing-set.csv')
    model_dir = os.path.join(project_root, 'model')

    if os.path.exists(train_csv):
        train_and_evaluate(train_csv, test_csv, model_dir)
    else:
        print("dataset missing, put it in the folder.")
