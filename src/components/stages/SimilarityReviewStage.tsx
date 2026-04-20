import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { computeDistanceMatrix, performClustering } from '../../services/similarity/similarityService';
import { SimilarityCluster } from '../../types';
import { AlertCircle, ChevronDown, Trash2 } from 'lucide-react';

export const SimilarityReviewStage = () => {
  const sourceImages = useProjectStore((state) => state.sourceImages);
  const cleanupStageState = useProjectStore(
    (state) => (state.stageState.clean as { sourceImageIds?: string[]; workingEdits?: Record<string, unknown> } | undefined) ?? {}
  );
  const removeSourceImage = useProjectStore((state) => state.removeSourceImage);
  const setStageState = useProjectStore((state) => state.setStageState);
  const setCurrentStage = useProjectStore((state) => state.setCurrentStage);
  const { addNotification } = useUIStore();

  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [uiThreshold, setUiThreshold] = useState(0.7);
  const similarityThreshold = useMemo(() => {
    const remapped = 0.2 + 0.8 * Math.sqrt(uiThreshold);
    if (import.meta.env.DEV) {
      console.log(`[duplicates] threshold remap: ${uiThreshold.toFixed(2)} -> ${remapped.toFixed(3)}`);
    }
    return remapped;
  }, [uiThreshold]);

  const images = useMemo(() => Object.values(sourceImages), [sourceImages]);
  const canProceed = images.length > 0;
  const canProceedReason = canProceed ? 'remaining images available' : 'no images remaining';

  const duplicateGroups = useMemo<SimilarityCluster[]>(() => {
    if (import.meta.env.DEV) {
      console.log(`[duplicates] images: ${images.length}`);
      console.log(`[duplicates] threshold: ${similarityThreshold}`);
    }

    const embeddings = new Map<string, Float32Array>();
    for (const image of images) {
      if (image.embedding) {
        embeddings.set(image.id, image.embedding);
      }
    }

    if (embeddings.size < 2) {
      if (import.meta.env.DEV) {
        console.log('[duplicates] groups: 0');
      }
      return [];
    }

    const matrix = computeDistanceMatrix(embeddings);
    const clusters = performClustering(
      Array.from(embeddings.keys()),
      matrix,
      similarityThreshold
    ).filter((cluster) => cluster.imageIds.length > 1);

    if (import.meta.env.DEV) {
      console.log(`[duplicates] groups: ${clusters.length}`);
      console.log(`[duplicates] group sizes: [${clusters.map((cluster) => cluster.imageIds.length).join(', ')}]`);
    }

    return clusters;
  }, [images, similarityThreshold]);

  useEffect(() => {
    if (selectedClusterId && !duplicateGroups.some((cluster) => cluster.id === selectedClusterId)) {
      setSelectedClusterId(null);
    }
  }, [duplicateGroups, selectedClusterId]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(`[duplicates] canProceed: ${canProceed} (${canProceedReason})`);
    }
  }, [canProceed, canProceedReason]);

  const handleRemoveImage = (id: string) => {
    removeSourceImage(id);
    const remainingImages = Math.max(images.length - 1, 0);

    if (import.meta.env.DEV) {
      console.log(`[duplicates] remaining images after delete: ${remainingImages}`);
    }

    addNotification('info', 'Image removed');
  };

  const handleRemoveCluster = (clusterIds: string[]) => {
    const idsToRemove = clusterIds.slice(1);

    for (const id of idsToRemove) {
      removeSourceImage(id);
    }

    if (import.meta.env.DEV) {
      console.log(
        `[duplicates] remaining images after delete: ${Math.max(images.length - idsToRemove.length, 0)}`
      );
    }

    addNotification('info', `Removed ${idsToRemove.length} duplicate image${idsToRemove.length !== 1 ? 's' : ''} from cluster`);
  };

  const handleProceedToCleanup = () => {
    const remainingImageIds = images.map((image) => image.id);

    if (import.meta.env.DEV) {
      console.log(`[cleanup-transition] remaining images: ${remainingImageIds.length}`);
      console.log(`[cleanup-transition] writing cleanup input set: ${remainingImageIds.length}`);
      console.log(
        `[cleanup-transition] preserving existing cleanup working edits: ${
          Object.keys(cleanupStageState.workingEdits ?? {}).length
        }`
      );
    }

    setStageState('clean', {
      ...cleanupStageState,
      sourceImageIds: remainingImageIds,
    });
    setCurrentStage('clean');
  };

  if (images.length === 0) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No images to analyze. Import images first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Similarity Threshold</label>
            <p className="text-xs text-muted-foreground">
              Lower = more duplicate groups, Higher = fewer duplicate groups
            </p>
          </div>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={uiThreshold}
              onChange={(event) => setUiThreshold(parseFloat(event.target.value))}
              className="w-32"
            />
            <span className="text-sm font-mono w-12 text-right">
              {uiThreshold.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Current Images</p>
          <p className="text-2xl font-bold">{images.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Duplicate Groups</p>
          <p className="text-2xl font-bold">{duplicateGroups.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Can Proceed</p>
          <p className="text-sm font-medium">{canProceedReason}</p>
        </div>
      </div>

      {duplicateGroups.length > 0 && (
        <div>
          <div className="mb-4">
            <h3 className="text-lg font-semibold">
              Duplicate Groups ({duplicateGroups.length})
            </h3>
            <p className="text-sm text-muted-foreground">
              Review similar images and remove redundant ones
            </p>
          </div>

          <div className="space-y-3">
            {duplicateGroups.map((cluster) => (
              <div
                key={cluster.id}
                className="rounded-lg border border-border bg-card overflow-hidden"
              >
                <button
                  onClick={() =>
                    setSelectedClusterId(
                      selectedClusterId === cluster.id ? null : cluster.id
                    )
                  }
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-secondary transition-colors"
                >
                  <div className="text-left">
                    <p className="font-medium">
                      Group with {cluster.imageIds.length} image
                      {cluster.imageIds.length !== 1 ? 's' : ''}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Average similarity: {(cluster.avgSimilarity * 100).toFixed(1)}%
                    </p>
                  </div>
                  <ChevronDown
                    size={20}
                    className={`transition-transform ${
                      selectedClusterId === cluster.id ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {selectedClusterId === cluster.id && (
                  <div className="border-t border-border p-4 bg-secondary/30">
                    <div className="gallery-masonry mb-4">
                      {cluster.imageIds.map((imageId) => {
                        const image = sourceImages[imageId];
                        if (!image) {
                          return null;
                        }

                        return (
                          <div
                            key={imageId}
                            className="gallery-masonry-item group relative rounded-lg overflow-hidden bg-black border border-border"
                          >
                            <div className="relative min-h-[12rem] flex items-center justify-center overflow-hidden">
                              {image.previewUrl ? (
                                <img
                                  src={image.previewUrl}
                                  alt={image.fileName}
                                  className="w-full h-auto object-contain"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground p-2 text-center">
                                  <span className="text-xs font-medium">
                                    Preview unavailable
                                  </span>
                                </div>
                              )}
                            </div>

                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <button
                                onClick={() => handleRemoveImage(imageId)}
                                className="p-2 bg-destructive text-destructive-foreground rounded-md hover:opacity-90"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>

                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                              <p className="text-xs text-white truncate">
                                {image.fileName}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => handleRemoveCluster(cluster.imageIds)}
                      className="w-full px-4 py-2 bg-destructive/20 text-destructive hover:bg-destructive/30 rounded-md transition-colors text-sm font-medium"
                    >
                      Keep 1, Remove {cluster.imageIds.length - 1} Duplicates
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {duplicateGroups.length === 0 && (
        <div className="text-center py-12 rounded-lg bg-secondary/50 border border-dashed border-border">
          <p className="text-muted-foreground">No duplicate groups found at this threshold</p>
          <p className="text-xs text-muted-foreground mt-2">
            Try lowering the similarity threshold to find more duplicate groups
          </p>
        </div>
      )}

      <div className="flex justify-center">
        <button
          onClick={handleProceedToCleanup}
          disabled={!canProceed}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity font-semibold text-lg"
        >
          Proceed to Cleanup →
        </button>
      </div>
    </div>
  );
};
