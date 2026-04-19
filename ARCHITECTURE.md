# Dataset Creator - Architecture Plan

## 1. Project Structure

```
dataset-creator/
├── public/                          # Static assets
├── src/
│   ├── components/
│   │   ├── common/                  # Reusable components
│   │   │   ├── ImageGallery.tsx
│   │   │   ├── Heatmap.tsx
│   │   │   ├── MasonryGrid.tsx
│   │   │   └── StageNavigation.tsx
│   │   ├── stages/
│   │   │   ├── Import/
│   │   │   ├── SimilarityReview/
│   │   │   ├── Cleanup/
│   │   │   ├── Crop/
│   │   │   ├── Augmentation/
│   │   │   ├── FinalReview/
│   │   │   ├── Tagging/
│   │   │   └── Export/
│   │   └── AppShell.tsx
│   ├── stores/                      # State management (Zustand)
│   │   ├── useProjectStore.ts
│   │   ├── useDatasetStore.ts
│   │   └── useUIStore.ts
│   ├── services/
│   │   ├── persistence/
│   │   │   ├── storageService.ts
│   │   │   └── indexedDBService.ts
│   │   ├── image/
│   │   │   ├── imageProcessor.ts
│   │   │   └── embeddingService.ts
│   │   ├── similarity/
│   │   │   └── similarityService.ts
│   │   ├── cleanup/
│   │   │   └── canvasEditor.ts
│   │   ├── crop/
│   │   │   └── cropService.ts
│   │   ├── augmentation/
│   │   │   └── augmentationService.ts
│   │   ├── tagging/
│   │   │   └── taggingService.ts
│   │   └── export/
│   │       └── exportService.ts
│   ├── types/
│   │   ├── entities.ts
│   │   ├── stage.ts
│   │   └── index.ts
│   ├── workers/
│   │   ├── embedding.worker.ts
│   │   ├── similarity.worker.ts
│   │   ├── augmentation.worker.ts
│   │   └── tagging.worker.ts
│   ├── lib/
│   │   ├── constants.ts
│   │   └── utils.ts
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── components.json
└── package.json
```

## 2. State Model

### Core Entities

```typescript
// Original imported image
SourceImage {
  id: string;
  originalFile: File | Blob;
  thumbnail: ImageData;
  embedding?: Float32Array;
  hash?: string;
  createdAt: Date;
}

// Dataset item (result of cropping/augmentation)
DatasetItem {
  id: string;
  sourceImageId: string;
  imageData: ImageData;
  type: 'original' | 'crop' | 'augmented';
  cropFrame?: CropFrame;
  augmentationConfig?: AugmentationConfig;
  cleaned?: CleanupOverlay;
  tags?: string[];
  aspectRatio: '2:3' | '3:2' | '1:1';
  deleted: boolean;
  createdAt: Date;
}

// Cleanup non-destructive overlay
CleanupOverlay {
  id: string;
  layers: CanvasLayer[];
  history: HistoryState[];
}

// Crop configuration
CropFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: '2:3' | '3:2' | '1:1';
}

// Project state
Project {
  id: string;
  name: string;
  sourceImages: SourceImage[];
  datasetItems: DatasetItem[];
  currentStage: StageName;
  stageState: Record<StageName, StageData>;
  taggingConfig: TaggingConfig;
  lastModified: Date;
}
```

### Store Architecture (Zustand)

1. **useProjectStore**: Main project state, source images, dataset items
2. **useDatasetStore**: Derived state, computations, cache
3. **useUIStore**: UI state, current selections, view mode

## 3. Stage Model

Pipeline with state persistence between stages:

```
Import → Select → Clean → Crop → Augment → Final Review → Tagging → Export
  ↓        ↓        ↓       ↓        ↓            ↓           ↓        ↓
  S1       S2       S3      S4       S5           S6           S7       S8
```

Each stage:
- Can navigate back/forward
- Persists its state
- Modifies or reads specific entities

## 4. Persistence Strategy

### IndexedDB Schema

```
ObjectStores:
- projects (keyPath: id)
- sourceImages (keyPath: id)
- datasetItems (keyPath: id)
- embeddings (keyPath: id)
- similarity (keyPath: id) - cached distance matrices
- cleanupOverlays (keyPath: id)
- taggingData (keyPath: id)
```

### Auto-save

- Debounced save on every state change (500ms)
- Save on leaving stage
- Recovery on app load

## 5. Worker Strategy

Offload to Web Workers:

1. **embedding.worker.ts** - Generate visual embeddings using ONNX/TensorFlow.js
2. **similarity.worker.ts** - Compute distance matrices
3. **augmentation.worker.ts** - Generate augmented images
4. **tagging.worker.ts** - Local inference with ONNX model

## 6. Key Dependencies

### UI & Styling
- **shadcn/ui** - Component library
- **Tailwind CSS** - Styling
- **Lucide React** - Icons

### State Management
- **Zustand** - Simple state management

### Image Processing
- **sharp.js** (browser) - Image ops
- **canvas-based** - Cleanup editor

### ML/Embeddings (Priority order)
1. **ONNX Runtime Web** - Local model inference
2. **TensorFlow.js** - Fallback
3. **transformers.js** - Danbooru tagging

### Export
- **JSZip** - Zip creation

### Utilities
- **uuid** - Unique IDs
- **date-fns** - Date handling

## 7. Risk List

| Risk | Mitigation |
|------|-----------|
| Browser memory limits with large datasets | Chunk processing, worker offloading |
| Model file sizes | Lazy load, cache in IndexedDB |
| Embedding generation speed | GPU acceleration (WebGPU), progressive UI |
| OPFS availability | Graceful fallback to zip export |
| Model accuracy for tagging | Allow optional fallback endpoint |
| iOS/Safari support | Desktop-first, document limitations |

## 8. MVP Priorities

### Tier 1 (Core)
1. Import + masonry gallery
2. Persistence (IndexedDB)
3. Similarity heatmaps + clustering
4. Crop editor

### Tier 2 (Essential)
5. Cleanup editor
6. Augmentation (flip, color, rotate)
7. Final review
8. Auto-tagging (local)

### Tier 3 (Export & Polish)
9. Tagging manual editing
10. Export to PNG + TXT
11. Dark theme, responsive UI

## 9. Extension Points

- Smart eraser (v2) - inpainting in cleanup stage
- Cloud sync (v2) - optional backend
- Batch processing (v2) - multiple projects
- Advanced ML models (v2) - better embeddings/tagging
- Plugin system (v3) - custom augmentations
