import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import {
  ProjectState,
  SourceImage,
  DatasetItem,
  StageName,
  TaggingConfig,
  createProject,
  CleanupOverlay,
} from '../types';

interface ProjectStore extends ProjectState {
  // Project management
  initializeProject: (name: string) => void;
  setCurrentStage: (stage: StageName) => void;
  
  // Source images
  addSourceImage: (image: SourceImage) => void;
  removeSourceImage: (id: string) => void;
  updateSourceImage: (id: string, updates: Partial<SourceImage>) => void;
  getSourceImages: () => SourceImage[];
  
  // Dataset items
  addDatasetItem: (item: DatasetItem) => void;
  removeDatasetItem: (id: string) => void;
  updateDatasetItem: (id: string, updates: Partial<DatasetItem>) => void;
  softDeleteDatasetItem: (id: string) => void;
  getDatasetItems: (includeDeleted?: boolean) => DatasetItem[];
  
  // Cleanup overlays
  addCleanupOverlay: (overlay: CleanupOverlay) => void;
  updateCleanupOverlay: (id: string, updates: Partial<CleanupOverlay>) => void;
  removeCleanupOverlay: (id: string) => void;
  
  // Stage state
  setStageState: (stage: StageName, state: unknown) => void;
  getStageState: (stage: StageName) => unknown;
  
  // Tagging
  updateTaggingConfig: (updates: Partial<TaggingConfig>) => void;
}

export const useProjectStore = create<ProjectStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...createProject('Untitled Project'),
        
        initializeProject: (name: string) =>
          set(() => createProject(name)),
        
        setCurrentStage: (stage: StageName) =>
          set((state) => ({
            ...state,
            currentStage: stage,
            lastModified: new Date(),
          })),
        
        addSourceImage: (image: SourceImage) =>
          set((state) => ({
            ...state,
            sourceImages: { ...state.sourceImages, [image.id]: image },
            lastModified: new Date(),
          })),
        
        removeSourceImage: (id: string) =>
          set((state) => {
            const { [id]: _, ...rest } = state.sourceImages;
            return { ...state, sourceImages: rest, lastModified: new Date() };
          }),
        
        updateSourceImage: (id: string, updates: Partial<SourceImage>) =>
          set((state) => ({
            ...state,
            sourceImages: {
              ...state.sourceImages,
              [id]: { ...state.sourceImages[id], ...updates },
            },
            lastModified: new Date(),
          })),
        
        getSourceImages: () => Object.values(get().sourceImages),
        
        addDatasetItem: (item: DatasetItem) =>
          set((state) => ({
            ...state,
            datasetItems: { ...state.datasetItems, [item.id]: item },
            lastModified: new Date(),
          })),
        
        removeDatasetItem: (id: string) =>
          set((state) => {
            const { [id]: _, ...rest } = state.datasetItems;
            return { ...state, datasetItems: rest, lastModified: new Date() };
          }),
        
        updateDatasetItem: (id: string, updates: Partial<DatasetItem>) =>
          set((state) => ({
            ...state,
            datasetItems: {
              ...state.datasetItems,
              [id]: { ...state.datasetItems[id], ...updates },
            },
            lastModified: new Date(),
          })),
        
        softDeleteDatasetItem: (id: string) =>
          set((state) => ({
            ...state,
            datasetItems: {
              ...state.datasetItems,
              [id]: {
                ...state.datasetItems[id],
                deleted: true,
                deletedAt: new Date(),
              },
            },
            lastModified: new Date(),
          })),
        
        getDatasetItems: (includeDeleted = false) => {
          const items = Object.values(get().datasetItems);
          return includeDeleted ? items : items.filter((item) => !item.deleted);
        },
        
        addCleanupOverlay: (overlay: CleanupOverlay) =>
          set((state) => ({
            ...state,
            cleanupOverlays: { ...state.cleanupOverlays, [overlay.id]: overlay },
          })),
        
        updateCleanupOverlay: (id: string, updates: Partial<CleanupOverlay>) =>
          set((state) => ({
            ...state,
            cleanupOverlays: {
              ...state.cleanupOverlays,
              [id]: { ...state.cleanupOverlays[id], ...updates },
            },
          })),
        
        removeCleanupOverlay: (id: string) =>
          set((state) => {
            const { [id]: _, ...rest } = state.cleanupOverlays;
            return { ...state, cleanupOverlays: rest };
          }),
        
        setStageState: (stage: StageName, stageState: unknown) =>
          set((state) => ({
            ...state,
            stageState: { ...state.stageState, [stage]: stageState },
            lastModified: new Date(),
          })),
        
        getStageState: (stage: StageName) => get().stageState[stage],
        
        updateTaggingConfig: (updates: Partial<any>) =>
          set((state) => ({
            ...state,
            taggingConfig: { ...state.taggingConfig, ...updates },
            lastModified: new Date(),
          })),
      }),
      {
        name: 'dataset-creator-project',
      }
    )
  )
);
