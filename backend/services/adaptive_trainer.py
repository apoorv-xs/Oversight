# handles the adaptive learning side - buffers normal traffic and retrains the model periodically
import os
import sys
import time
import pandas as pd
from threading import Thread, Lock, Event
from datetime import datetime

# Ensure imports work
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_modules.feature_extractor import LIVE_FEATURES

# Config
MAX_BASELINE_ROWS = 50_000       # Cap CSV at this many rows
RETRAIN_THRESHOLD = 5000         # Retrain after this many new flows
FLUSH_INTERVAL = 5               # Flush buffer to disk every N flows
MIN_ROWS_TO_RETRAIN = 500        # Don't retrain with fewer rows than this


class BaselineManager:
    # manages the baseline csv buffer and kicks off retraining when enough data is collected

    def __init__(self, project_root):
        self.project_root = project_root
        self.baseline_path = os.path.join(project_root, 'dataset', 'learned_baseline.csv')
        self.model_dir = os.path.join(project_root, 'model')

        # In-memory buffer for normal flows (flushed to CSV periodically)
        self._buffer = []
        self._buffer_lock = Lock()

        # Counters
        self._new_flow_count = 0          # Flows since last retrain
        self._total_saved_this_session = 0

        # Retraining state
        self._is_retraining = Event()     # Set while a retrain is in progress
        self._retrain_lock = Lock()       # Prevent concurrent retrains

        print(f"baseline path set to {self.baseline_path}")
        print(f"retraining after every {RETRAIN_THRESHOLD:,} new normal flows")

    def save_flow(self, flow_features):
    # saves a flow to the in-memory buffer, flushes to csv every FLUSH_INTERVAL rows
        # Only keep the 14 training features
        row = {feat: flow_features.get(feat, 0) for feat in LIVE_FEATURES}

        with self._buffer_lock:
            self._buffer.append(row)
            self._new_flow_count += 1
            self._total_saved_this_session += 1

            # Flush to disk periodically
            if len(self._buffer) >= FLUSH_INTERVAL:
                self._flush_buffer()

        # Check if we should retrain
        if self._new_flow_count >= RETRAIN_THRESHOLD and not self._is_retraining.is_set():
            print(f"hit {self._new_flow_count:,} new flows — triggering retrain")
            self._trigger_retrain()

    def _flush_buffer(self):
    # writes whatever is in the buffer to the csv file - must hold _buffer_lock before calling this
        if not self._buffer:
            return

        new_df = pd.DataFrame(self._buffer, columns=LIVE_FEATURES)
        self._buffer.clear()

        try:
            os.makedirs(os.path.dirname(self.baseline_path), exist_ok=True)
            if os.path.exists(self.baseline_path):
                existing_df = pd.read_csv(self.baseline_path)
                combined = pd.concat([existing_df, new_df], ignore_index=True)
            else:
                combined = new_df

            # Cap at MAX_BASELINE_ROWS
            if len(combined) > MAX_BASELINE_ROWS:
                combined = combined.tail(MAX_BASELINE_ROWS)

            combined.to_csv(self.baseline_path, index=False)

        except Exception as e:
            print(f"error writing to csv: {e}")

    def _trigger_retrain(self):
    # spins up a background thread to do the retraining
        thread = Thread(target=self._retrain_worker, daemon=True)
        thread.start()

    def _retrain_worker(self):
    # the actual worker - acquires the lock so two retrains cant run at the same time
        if not self._retrain_lock.acquire(blocking=False):
            return

        try:
            self._is_retraining.set()
            with self._buffer_lock:
                self._flush_buffer()
            self._do_retrain()
            self._new_flow_count = 0
        except Exception as e:
            print(f"retrain crashed: {e}")
        finally:
            self._is_retraining.clear()
            self._retrain_lock.release()

    def _do_retrain(self):
        # runs the full retrain pipeline with backup/restore so we can roll back if it fails
        if not os.path.exists(self.baseline_path):
            return

        baseline_df = pd.read_csv(self.baseline_path)
        if len(baseline_df) < MIN_ROWS_TO_RETRAIN:
            print(f"only got {len(baseline_df)} rows — need at least {MIN_ROWS_TO_RETRAIN} to retrain")
            return

        print(f"retraining on {len(baseline_df):,} baseline flows...")
        self._backup_model()

        try:
            from ai_modules.train_model import retrain_from_csv
            retrain_from_csv(self.baseline_path, self.model_dir)
        except Exception as e:
            print(f"training step failed: {e}")
            self._restore_backup()
            return

        try:
            import globals as g
            g.reload_model()
            print("model hot-swapped successfully")
        except Exception as e:
            print(f"hot-swap failed, rolling back: {e}")
            self._restore_backup()

    def _copy_model_files(self, is_backup=True):
    # is_backup=True means copy orig -> backup, False means restore backup -> orig
        import shutil
        files = ['autoencoder.onnx', 'scaler.pkl', 'threshold.json']
        for f in files:
            orig = os.path.join(self.model_dir, f)
            # Create a backup name (e.g., autoencoder_backup.onnx)
            name, ext = os.path.splitext(f)
            backup = os.path.join(self.model_dir, f"{name}_backup{ext}")
            
            src, dst = (orig, backup) if is_backup else (backup, orig)
            if os.path.exists(src):
                shutil.copy2(src, dst)

    def _backup_model(self):
    # backs up existing model files before we start training
        self._copy_model_files(is_backup=True)

    def _restore_backup(self):
    # restores from backup if something went wrong during training
        self._copy_model_files(is_backup=False)

    def startup_retrain(self):
    # called when the app starts up - trains from scratch if no model exists
        model_path = os.path.join(self.model_dir, 'autoencoder.onnx')
        train_csv = os.path.join(self.project_root, 'dataset', 'UNSW_NB15_training-set.csv')
        test_csv = os.path.join(self.project_root, 'dataset', 'UNSW_NB15_testing-set.csv')

        if not os.path.exists(model_path):
            if os.path.exists(train_csv) and os.path.exists(test_csv):
                print("no model found... training from dataset")
                try:
                    from ai_modules.train_model import train_and_evaluate
                    train_and_evaluate(train_csv, test_csv, self.model_dir)
                    import globals as g
                    g.reload_model()
                except Exception as e:
                    print(f"initial training failed: {e}")
            return

        if os.path.exists(self.baseline_path):
            try:
                baseline_df = pd.read_csv(self.baseline_path)
                if len(baseline_df) >= MIN_ROWS_TO_RETRAIN:
                    print(f"found {len(baseline_df):,} baseline flows — retraining on startup...")
                    self._trigger_retrain()
            except Exception as e:
                print(f"startup retrain failed: {e}")

    def get_stats(self):
    # returns some stats for the dashboard adaptive learning panel
        import globals as g
        import os
        import pandas as pd
        
        total_baseline = 0
        if os.path.exists(self.baseline_path):
            try:
                # fast way to get line count without loading the whole CSV into memory
                with open(self.baseline_path, 'r') as f:
                    total_baseline = sum(1 for line in f) - 1 # subtract header
            except:
                pass

        return {
            'new_since_retrain': self._new_flow_count,
            'is_retraining': self._is_retraining.is_set(),
            'retrain_threshold': RETRAIN_THRESHOLD,
            'model_threshold': g.autoencoder_threshold if hasattr(g, 'autoencoder_threshold') else 0,
            'total_baseline': max(0, total_baseline)
        }
