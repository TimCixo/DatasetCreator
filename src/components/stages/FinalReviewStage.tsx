import { useState, useMemo, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { computeDistanceMatrix, performClustering } from '../../services/similarity/similarityService';
import { ASPECT_RATIOS, ASPECT_RATIO_LABELS } from '../../lib/constants';
import { AlertCircle, ChevronDown, Trash2 } from 'lucide-react';

export const FinalReviewStage = () => {
  const { getDatasetItems, softDeleteDatasetItem, removeSourceImage } = useProjectStore();
  const { addNotification } = useUIStore();

  const [selectedAspectRatios, setSelectedAspectRatios] = useState<Set<string>>(new Set(ASPECT_RATIOS));
  const [similarityThreshold, setSimilarityThreshold] = useState(0.7);
  const [clusters, setClusters] = useState<any[]>([]);
  const [isComputing, setIsComputing] = useState(false);
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);

  const items = getDatasetItems(false);
  const filteredItems = useMemo(
    () => items.filter((item) => selectedAspectRatios.has(item.aspectRatio)),
    [items, selectedAspectRatios]
  );

  // Compute similarity on mount or when threshold changes
  useEffect(() => {
    if (filteredItems.length === 0) return;

    const computeSimilarity = async () => {
      setIsComputing(true);
      try {
        const embeddings = new Map<string, Float32Array>();

        // Try to use existing embeddings or create from items
        for (const item of filteredItems) {
          // For cropped/augmented items, use source image embedding if available
          if (!embeddings.has(item.id)) {
            // Simple placeholder - in production would recompute or cache
            const dummyEmbedding = new Float32Array(256).fill(Math.random());
            embeddings.set(item.id, dummyEmbedding);
          }
        }

        const matrix = computeDistanceMatrix(embeddings);
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
  }, [filteredItems, similarityThreshold, addNotification]);

  const toggleAspectRatio = (ratio: string) => {
    setSelectedAspectRatios((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(ratio)) {
        newSet.delete(ratio);
      } else {
        newSet.add(ratio);
      }
      return newSet;
    });
  };

  const handleDeleteItem = (id: string) => {
    softDeleteDatasetItem(id);
    addNotification('info', 'Item marked for deletion');
  };

  const handlePermanentDelete = (id: string) => {
    removeSourceImage(id);
    addNotification('info', 'Item deleted');
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No dataset items to review.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Aspect Ratio Filter */}
      <div className="rounded-lg border border-border bg-card p-4">
        <label className="text-sm font-medium block mb-3">Filter by Aspect Ratio</label>
        <div className="flex gap-2 flex-wrap">
          {ASPECT_RATIOS.map((ratio) => (
            <button
              key={ratio}
              onClick={() => toggleAspectRatio(ratio)}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                selectedAspectRatios.has(ratio)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-foreground hover:bg-muted'
              }`}
            >
              {ASPECT_RATIO_LABELS[ratio]}
              <span className="ml-1 font-mono">
                {items.filter((i) => i.aspectRatio === ratio && !i.deleted).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Similarity Controls */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium block mb-2">Similarity Threshold</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={similarityThreshold}
              onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
              className="w-full"
              disabled={isComputing}
            />
          </div>
          <span className="text-sm font-mono">{similarityThreshold.toFixed(2)}</span>
        </div>
      </div>

      {/* Dataset Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Total Items</p>
          <p className="text-2xl font-bold">{filteredItems.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Similarity Clusters</p>
          <p className="text-2xl font-bold">{clusters.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Average Items/Cluster</p>
          <p className="text-2xl font-bold">
            {clusters.length > 0 ? (filteredItems.length / clusters.length).toFixed(1) : '-'}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Aspect Ratio Filters</p>
          <p className="text-2xl font-bold">{selectedAspectRatios.size}</p>
        </div>
      </div>

      {/* Item Preview Grid */}
      {filteredItems.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Dataset Preview ({filteredItems.length} items)</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className={`group relative rounded-lg overflow-hidden border border-border ${
                  item.deleted ? 'opacity-50 line-through' : ''
                }`}
              >
                <div className="aspect-square bg-black flex items-center justify-center overflow-hidden">
                  <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                    {item.width} × {item.height}
                  </div>
                </div>

                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                  <button
                    onClick={() => handleDeleteItem(item.id)}
                    className="p-2 bg-destructive text-destructive-foreground rounded-md hover:opacity-90"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <p className="text-xs text-white">{item.aspectRatio}</p>
                  <p className="text-xs text-gray-300">{item.type}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {filteredItems.length === 0 && (
        <div className="text-center py-12 rounded-lg bg-secondary/50 border border-dashed border-border">
          <p className="text-muted-foreground">No items matching selected aspect ratios</p>
        </div>
      )}

      {/* Summary */}
      <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4">
        <p className="text-sm text-blue-600">
          <strong>Next step:</strong> Add tags to all {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''} for export
        </p>
      </div>
    </div>
  );
};
