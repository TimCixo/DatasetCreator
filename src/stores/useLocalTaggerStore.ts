import { create } from 'zustand';
import type { LocalTaggerBundle } from '../services/tagging/localTaggerService';

export type LocalTaggerStatus = 'not-connected' | 'loading' | 'not-ready' | 'ready' | 'running';

type AutoTaggingProgress = {
  completed: number;
  total: number;
};

interface LocalTaggerState {
  bundle: LocalTaggerBundle | null;
  status: LocalTaggerStatus;
  message: string;
  progress: string;
  autoTaggingProgress: AutoTaggingProgress;
  setBundle: (bundle: LocalTaggerBundle | null) => void;
  setStatus: (status: LocalTaggerStatus) => void;
  setMessage: (message: string) => void;
  setProgress: (progress: string) => void;
  setAutoTaggingProgress: (progress: AutoTaggingProgress) => void;
  disconnect: () => void;
}

const defaultMessage = 'Connect a folder containing model.onnx and selected_tags.csv.';

export const useLocalTaggerStore = create<LocalTaggerState>((set, get) => ({
  bundle: null,
  status: 'not-connected',
  message: defaultMessage,
  progress: '',
  autoTaggingProgress: { completed: 0, total: 0 },
  setBundle: (bundle) => {
    const previousBundle = get().bundle;
    if (previousBundle && previousBundle !== bundle) {
      void previousBundle.session.release();
    }
    set({ bundle });
  },
  setStatus: (status) => set({ status }),
  setMessage: (message) => set({ message }),
  setProgress: (progress) => set({ progress }),
  setAutoTaggingProgress: (autoTaggingProgress) => set({ autoTaggingProgress }),
  disconnect: () => {
    const previousBundle = get().bundle;
    if (import.meta.env.DEV) {
      console.log('[tagging:model] explicit disconnect requested');
    }
    if (previousBundle) {
      void previousBundle.session.release();
    }
    set({
      bundle: null,
      status: 'not-connected',
      message: defaultMessage,
      progress: '',
      autoTaggingProgress: { completed: 0, total: 0 },
    });
  },
}));
