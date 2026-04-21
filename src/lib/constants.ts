// Stages in pipeline order
export const STAGES = [
  'import',
  'select',
  'clean',
  'crop',
  'augment',
  'review',
  'tagging',
  'export',
] as const;

export const STAGE_LABELS: Record<string, string> = {
  import: 'Import Images',
  select: 'Remove Duplicates',
  clean: 'Clean Images',
  crop: 'Crop Images',
  augment: 'Augment Dataset',
  review: 'Final Review',
  tagging: 'Tag Images',
  export: 'Export Dataset',
};

// Aspect ratios
export const ASPECT_RATIOS = ['2:3', '3:2', '1:1'] as const;

export const ASPECT_RATIO_LABELS: Record<string, string> = {
  '2:3': 'Portrait (2:3)',
  '3:2': 'Landscape (3:2)',
  '1:1': 'Square (1:1)',
};

// Storage keys
export const DB_NAME = 'DatasetCreator';
export const DB_VERSION = 1;

export const OBJECT_STORES = {
  PROJECTS: 'projects',
  SOURCE_IMAGES: 'sourceImages',
  DATASET_ITEMS: 'datasetItems',
  CLEANUP_OVERLAYS: 'cleanupOverlays',
  EMBEDDINGS: 'embeddings',
  SIMILARITY_CACHE: 'similarityCache',
};

// UI defaults
export const DEFAULT_BRUSH_SIZE = 20;
export const DEFAULT_BRUSH_OPACITY = 1;
export const DEFAULT_BRUSH_HARDNESS = 0.8;

export const DEFAULT_ROTATION_AMPLITUDE = 15;
export const DEFAULT_ROTATION_VARIANTS = 3;

// Performance
export const CHUNK_SIZE = 10; // Process images in chunks
export const DEBOUNCE_DELAY = 500; // Auto-save debounce
export const WORKER_TIMEOUT = 30000; // 30s worker timeout

// Similarity thresholds
export const SIMILARITY_HIGH_THRESHOLD = 0.85;
export const SIMILARITY_MEDIUM_THRESHOLD = 0.65;
export const SIMILARITY_LOW_THRESHOLD = 0.45;
