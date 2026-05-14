import torch
import torch.nn as nn

class NetworkAutoencoder(nn.Module):
    """
    Unsupervised Neural Network for behavioral anomaly detection.
    Learns to reconstruct normal traffic patterns; anomalies are flagged 
    when the reconstruction error (MSE) exceeds a learned threshold.
    """
    def __init__(self, input_dim=14):
        super(NetworkAutoencoder, self).__init__()
        
        # Encoder: Compresses 14 features to a 4-variable bottleneck
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, 8),
            nn.ReLU(),
            nn.Linear(8, 4),
            nn.ReLU()
        )
        
        # Decoder: Reconstructs original 14 features from the bottleneck
        self.decoder = nn.Sequential(
            nn.Linear(4, 8),
            nn.ReLU(),
            nn.Linear(8, input_dim),
            nn.Sigmoid() # Outputs are [0,1] to match MinMaxScaler
        )

    def forward(self, x):
        encoded = self.encoder(x)
        decoded = self.decoder(encoded)
        return decoded
