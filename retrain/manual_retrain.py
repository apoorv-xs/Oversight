import os
import sys

# Ensure the backend directory is in the path
project_root = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(project_root, 'backend', 'ai_modules'))

try:
    from train_model import retrain_from_csv
except ImportError as e:
    print(f"Error importing modules. Make sure you are in the correct directory. Details: {e}")
    sys.exit(1)

def main():
    print("=" * 60)
    print("Manual AI Retraining Script")
    print("=" * 60)
    print("This script will train the Autoencoder on YOUR specific network data")
    print("collected in dataset/learned_baseline.csv.")
    print("-" * 60)
    
    baseline_path = os.path.join(project_root, 'dataset', 'learned_baseline.csv')
    model_dir = os.path.join(project_root, 'model')
    
    if not os.path.exists(baseline_path):
        print(f"[ERROR] Baseline dataset not found at {baseline_path}")
        print("Please run the dashboard and allow it to collect normal traffic baseline first.")

        input("Press Enter to exit...")
        return

    # To avoid the unicode export issue we encountered earlier
    os.environ["PYTHONIOENCODING"] = "utf-8"

    try:
        retrain_from_csv(baseline_path, model_dir)
        print("-" * 60)
        print("SUCCESS! The model has been retrained and saved.")
        print("Important: If your dashboard is currently running, please restart it")
        print("so the new model is loaded into memory.")
    except Exception as e:
        print(f"\nretraining failed: {e}")
        
    print("=" * 60)
    input("Press Enter to exit...")

if __name__ == "__main__":
    main()
