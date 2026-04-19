import { useState, useEffect, useMemo } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { computeDistanceMatrix, performClustering, getSimilarImages } from '../../services/similarity/similarityService';
import { SimilarityResult, SimilarityCluster } from '../../types';
import { AlertCircle, ChevronDown, Trash2 } from 'lucide-react';

export const SimilarityReviewStage = () => {
  const { getSourceImages, removeSourceImage } = useProjectStore();
  const { addNotification } = useUIStore();

  const [distanceMatrix, setDistanceMatrix] = useState<Map<string, SimilarityResult[]> | null>(null);
  const [clusters, setClusters] = useState<SimilarityCluster[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [similarityThreshold, setSimilarityThreshold] = useState(0.7);

  const images = useMemo(() => getSourceImages(), [getSourceImages]);

  // Compute embeddings and similarity on mount
  useEffect(() => {
    if (images.length === 0) return;

    const computeSimilarity = async () => {
      setIsComputing(true);
      try {
        // Build embeddings map
        const embeddings = new Map<string, Float32Array>();
        for (const image of images) {
          if (image.embedding) {
            embeddings.set(image.id, image.embedding);
          }
        }

        if (embeddings.size === 0) {
          addNotification('error', 'No embeddings available');
          setIsComputing(false);
          return;
        }

        // Compute distance matrix
        const matrix = computeDistanceMatrix(embeddings);
        setDistanceMatrix(matrix);

        // Perform clustering
        const foundClusters = performClustering(
          Array.from(embeddings.keys()),
          matrix,
          similarityThreshold
        );
        setClusters(foundClusters);

        addNotification('success', `Found ${foundClusters.length} similarity clusters`);
      } catch (error) {
        console.error('Error computing similarity:', error);
        addNotification('error', 'Failed to compute similarity');
      } finally {
        setIsComputing(false);
      }
    };

    computeSimilarity();
  }, [images, similarityThreshold, addNotification]);

  const handleRemoveImage = (id: string) => {
    removeSourceImage(id);
    addNotification('info', 'Image removed');
  };

  const handleRemoveCluster = (clusterIds: string[]) => {
    let keepCount = 0;
    for (const id of clusterIds) {
      if (keepCount === 0) {
        keepCount++;
      } else {
        removeSourceImage(id);
      }
    }
    addNotification('info', `Removed ${clusterIds.length - 1} duplicate images from cluster`);
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
      {/* Threshold Control */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Similarity Threshold</label>
            <p className="text-xs text-muted-foreground">
              Lower = more clusters, Higher = fewer, larger clusters
            </p>
          </div>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={similarityThreshold}
              onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
              className="w-32"
              disabled={isComputing}
            />
            <span className="text-sm font-mono w-12 text-right">
              {similarityThreshold.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Status */}
      {isComputing && (
        <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4">
          <p className="text-sm text-blue-600">Computing similarity... This may take a moment.</p>
        </div>
      )}

      {/* Clusters */}
      {!isComputing && clusters.length > 0 && (
        <div>
          <div className="mb-4">
            <h3 className="text-lg font-semibold">
              Similarity Clusters ({clusters.length})
            </h3>
            <p className="text-sm text-muted-foreground">
              Review similar images and remove redundant ones
            </p>
          </div>

          <div className="space-y-3">
            {clusters.map((cluster) => (
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
                      Cluster with {cluster.imageIds.length} image
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
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-4">
                      {cluster.imageIds.map((imageId) => {
                        const image = images.find((img) => img.id === imageId);
                        if (!image) return null;

                        return (
                          <div
                            key={imageId}
                            className="group relative rounded-lg overflow-hidden bg-black border border-border"
                          >
                            <div className="aspect-square flex items-center justify-center overflow-hidden">
                              <img
                                src={URL.createObjectURL(image.originalFile)}
                                alt={image.fileName}
                                className="w-full h-full object-cover"
                                onLoad={(e) => {
                                  URL.revokeObjectURL(e.currentTarget.src);
                                }}
                              />
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

      {!isComputing && clusters.length === 0 && images.length > 0 && (
        <div className="text-center py-12 rounded-lg bg-secondary/50 border border-dashed border-border">
          <p className="text-muted-foreground">No similar clusters found at this threshold</p>
          <p className="text-xs text-muted-foreground mt-2">
            Try lowering the similarity threshold to find more clusters
          </p>
        </div>
      )}
    </div>
  );
};
