/* ─── Window Augmentations for inline onclick handlers ─── */

import type { AnomalyData } from './types';

declare global {
  interface Window {
    // Panel toggles
    togglePanel: (btn: HTMLElement) => void;
    toggleKeyboardShortcutsModal: () => void;
    toggleNotificationOverlay: () => void;
    toggleScannerModal: () => void;
    toggleSoundState: () => void;
    toggleLockOn: (ip: string) => void;

    // Stream / flow selection
    selectFlow: (id: string) => void;
    selectStreamEvent: (id: string) => void;
    selectNotification: (id: string) => void;
    selectWhitelistItem: (ip: string) => void;
    markStreamEventSafe: (id: string) => void;
    removeWhitelistEntry: (src: string, dst: string, dport: number) => Promise<void>;

    // Scanner
    runFullSecurityScan: () => Promise<void>;
    switchScannerTab: (tabName: string) => void;
    renderWhitelistManager: () => Promise<void>;
    fetchWhitelist: () => Promise<void>;
    exportSecurityDossier: () => Promise<void>;
    clearNotifications: () => void;

    // Engine exposure (debug)
    audioEngine: any;

    // Utils
    clearDashboardUi: () => void;
  }
}
