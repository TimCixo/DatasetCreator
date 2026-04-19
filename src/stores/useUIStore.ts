import { create } from 'zustand';

interface UIState {
  // Current selections
  selectedSourceImageIds: Set<string>;
  selectedDatasetItemIds: Set<string>;
  hoveredImageId?: string;
  
  // View modes
  darkMode: boolean;
  viewMode: 'grid' | 'list';
  
  // UI flags
  showSettings: boolean;
  showHelp: boolean;
  
  // Notifications
  notifications: Array<{
    id: string;
    type: 'info' | 'success' | 'error' | 'warning';
    message: string;
    timestamp: Date;
  }>;
}

interface UIActions {
  // Selection
  toggleSourceImageSelection: (id: string) => void;
  toggleDatasetItemSelection: (id: string) => void;
  clearSourceImageSelection: () => void;
  clearDatasetItemSelection: () => void;
  setHoveredImageId: (id?: string) => void;
  
  // View
  setDarkMode: (dark: boolean) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  toggleDarkMode: () => void;
  
  // UI
  setShowSettings: (show: boolean) => void;
  setShowHelp: (show: boolean) => void;
  
  // Notifications
  addNotification: (type: UIState['notifications'][0]['type'], message: string) => void;
  removeNotification: (id: string) => void;
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  selectedSourceImageIds: new Set(),
  selectedDatasetItemIds: new Set(),
  hoveredImageId: undefined,
  darkMode: true,
  viewMode: 'grid',
  showSettings: false,
  showHelp: false,
  notifications: [],
  
  toggleSourceImageSelection: (id: string) =>
    set((state) => {
      const newSet = new Set(state.selectedSourceImageIds);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return { selectedSourceImageIds: newSet };
    }),
  
  toggleDatasetItemSelection: (id: string) =>
    set((state) => {
      const newSet = new Set(state.selectedDatasetItemIds);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return { selectedDatasetItemIds: newSet };
    }),
  
  clearSourceImageSelection: () =>
    set({ selectedSourceImageIds: new Set() }),
  
  clearDatasetItemSelection: () =>
    set({ selectedDatasetItemIds: new Set() }),
  
  setHoveredImageId: (id?: string) =>
    set({ hoveredImageId: id }),
  
  setDarkMode: (dark: boolean) =>
    set({ darkMode: dark }),
  
  setViewMode: (mode: 'grid' | 'list') =>
    set({ viewMode: mode }),
  
  toggleDarkMode: () =>
    set((state) => ({ darkMode: !state.darkMode })),
  
  setShowSettings: (show: boolean) =>
    set({ showSettings: show }),
  
  setShowHelp: (show: boolean) =>
    set({ showHelp: show }),
  
  addNotification: (type, message) =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        {
          id: `${Date.now()}-${Math.random()}`,
          type,
          message,
          timestamp: new Date(),
        },
      ],
    })),
  
  removeNotification: (id: string) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
}));
