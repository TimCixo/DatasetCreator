import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertCircle, ArrowRight, ChevronRight, Trash2 } from 'lucide-react';
import { ASPECT_RATIOS, ASPECT_RATIO_LABELS } from '../../lib/constants';
import { generateEmbedding } from '../../services/image/embeddingService';
import {
  computeDistanceMatrix,
  findSimilarPairs,
  performClustering,
} from '../../services/similarity/similarityService';
import type { DatasetItem, SimilarityCluster, SimilarityResult } from '../../types';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';

type PreviewMap = Record<string, string>;
type PreviewCacheEntry = { blob: Blob; url: string };
type EmbeddingCacheEntry = { blob: Blob; embedding: Float32Array };
type SimilarityView = 'all' | 'pairs' | 'clusters';

const HEATMAP_LIMIT = 18;

const getHeatmapColor = (similarity: number): string => {
  const clamped = Math.max(0, Math.min(1, similarity));

  if (clamped >= 0.85) {
    return `rgba(220, 38, 38, ${0.32 + clamped * 0.62})`;
  }

  if (clamped >= 0.55) {
    return `rgba(245, 158, 11, ${0.18 + clamped * 0.55})`;
  }

  return `rgba(37, 99, 235, ${0.1 + clamped * 0.45})`;
};

type ReviewCardProps = {
  item: DatasetItem;
  previewUrl?: string;
  onDelete: (id: string) => void;
  highlighted?: boolean;
};

const ReviewCard = memo(({ item, previewUrl, onDelete, highlighted = false }: ReviewCardProps) => {
  return (
    <div
      className={`gallery-masonry-item group relative rounded-lg overflow-hidden border bg-card ${
        highlighted ? 'border-primary shadow-[0_0_0_2px_rgba(59,130,246,0.35)]' : 'border-border'
      } ${item.deleted ? 'opacity-50 line-through' : ''}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '280px' }}
    >
      <div className="relative min-h-[12rem] bg-black overflow-hidden flex items-center justify-center">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={`${item.type} ${item.width} x ${item.height}`}
            className="w-full h-auto object-contain"
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
            Preview unavailable
          </div>
        )}

        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
          <button
            onClick={() => onDelete(item.id)}
            className="p-2 bg-destructive text-destructive-foreground rounded-md hover:opacity-90"
          >
            <Trash2 size={16} />
          </button>
        </div>

        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent p-3">
          <p className="text-sm text-white font-medium">
            {item.width} x {item.height}
          </p>
          <p className="text-xs text-gray-300">
            {item.aspectRatio} | {item.type}
          </p>
        </div>
      </div>
    </div>
  );
});

ReviewCard.displayName = 'ReviewCard';

export const FinalReviewStage = () => {
  const items = useProjectStore((state) =>
    Object.values(state.datasetItems).filter((item) => !item.deleted)
  );
  const sourceImages = useProjectStore((state) => state.sourceImages);
  const softDeleteDatasetItem = useProjectStore((state) => state.softDeleteDatasetItem);
  const setCurrentStage = useProjectStore((state) => state.setCurrentStage);
  const { addNotification } = useUIStore();

  const [selectedAspectRatios, setSelectedAspectRatios] = useState<Set<string>>(
    new Set(ASPECT_RATIOS)
  );
  const [previewUrls, setPreviewUrls] = useState<PreviewMap>({});
  const [itemEmbeddings, setItemEmbeddings] = useState<Record<string, Float32Array>>({});
  const [uiThreshold, setUiThreshold] = useState(0.12);
  const [activeSimilarityView, setActiveSimilarityView] = useState<SimilarityView>('all');
  const [selectedPairKey, setSelectedPairKey] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [previewItemIds, setPreviewItemIds] = useState<string[] | null>(null);
  const previewCacheRef = useRef<Record<string, PreviewCacheEntry>>({});
  const embeddingCacheRef = useRef<Record<string, EmbeddingCacheEntry>>({});

  const similarityThreshold = useMemo(() => {
    const remapped = 0.7 + 0.29 * Math.sqrt(uiThreshold);
    if (import.meta.env.DEV) {
      console.log(`[review] threshold slider value: ${uiThreshold.toFixed(2)}`);
      console.log(`[review] threshold remap value: ${remapped.toFixed(3)}`);
    }
    return remapped;
  }, [uiThreshold]);

  useEffect(() => {
    setPreviewUrls((previous) => {
      const next: PreviewMap = {};
      const activeIds = new Set(items.map((item) => item.id));
      let reusedCount = 0;
      let recreatedCount = 0;
      let removedCount = 0;

      for (const item of items) {
        const cached = previewCacheRef.current[item.id];

        if (cached && cached.blob === item.imageData) {
          next[item.id] = cached.url;
          reusedCount++;
          continue;
        }

        if (cached) {
          URL.revokeObjectURL(cached.url);
        }

        try {
          const url = URL.createObjectURL(item.imageData);
          previewCacheRef.current[item.id] = { blob: item.imageData, url };
          next[item.id] = url;
          recreatedCount++;
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn(`[review] failed preview generation: ${item.id}`, error);
          }
        }
      }

      for (const [id, cached] of Object.entries(previewCacheRef.current)) {
        if (activeIds.has(id)) {
          continue;
        }

        URL.revokeObjectURL(cached.url);
        delete previewCacheRef.current[id];
        removedCount++;
      }

      if (import.meta.env.DEV) {
        console.log(`[review] number of review items: ${items.length}`);
        console.log(`[review] preview source reused: ${reusedCount}`);
        console.log(`[review] preview source recreated: ${recreatedCount}`);
        console.log(`[review] preview source removed: ${removedCount}`);
        console.log('[review] object URLs generated only in controlled effect cache');
      }

      const previousKeys = Object.keys(previous);
      const nextKeys = Object.keys(next);
      const changed =
        previousKeys.length !== nextKeys.length ||
        nextKeys.some((id) => previous[id] !== next[id]);

      return changed ? next : previous;
    });
  }, [items]);

  useEffect(() => {
    return () => {
      for (const cached of Object.values(previewCacheRef.current)) {
        URL.revokeObjectURL(cached.url);
      }
      previewCacheRef.current = {};
    };
  }, []);

  const filteredItems = useMemo(
    () => items.filter((item) => selectedAspectRatios.has(item.aspectRatio)),
    [items, selectedAspectRatios]
  );

  const heatmapItems = useMemo(() => filteredItems.slice(0, HEATMAP_LIMIT), [filteredItems]);

  useEffect(() => {
    let cancelled = false;
    const activeIds = new Set(heatmapItems.map((item) => item.id));

    const startedAt = performance.now();

    const syncEmbeddings = async () => {
      const nextEntries: Record<string, Float32Array> = {};
      let reusedCount = 0;
      let borrowedCount = 0;
      let generatedCount = 0;

      for (const item of heatmapItems) {
        const cached = embeddingCacheRef.current[item.id];
        if (cached && cached.blob === item.imageData) {
          nextEntries[item.id] = cached.embedding;
          reusedCount++;
          continue;
        }

        const sourceEmbedding = sourceImages[item.sourceImageId]?.embedding;
        if (sourceEmbedding) {
          embeddingCacheRef.current[item.id] = {
            blob: item.imageData,
            embedding: sourceEmbedding,
          };
          nextEntries[item.id] = sourceEmbedding;
          borrowedCount++;
          continue;
        }

        try {
          const embedding = await generateEmbedding(item.imageData);
          if (cancelled) {
            return;
          }
          embeddingCacheRef.current[item.id] = { blob: item.imageData, embedding };
          nextEntries[item.id] = embedding;
          generatedCount++;
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn(`[review] failed embedding generation: ${item.id}`, error);
          }
        }
      }

      if (cancelled) {
        return;
      }

      setItemEmbeddings((previous) => {
        const next: Record<string, Float32Array> = {};
        let changed = false;

        for (const item of heatmapItems) {
          const nextEmbedding = nextEntries[item.id] ?? previous[item.id];
          if (nextEmbedding) {
            next[item.id] = nextEmbedding;
          }
        }

        for (const id of Object.keys(previous)) {
          if (!activeIds.has(id)) {
            changed = true;
          }
        }

        const nextKeys = Object.keys(next);
        const previousKeys = Object.keys(previous);

        if (
          !changed &&
          nextKeys.length === previousKeys.length &&
          nextKeys.every((id) => previous[id] === next[id])
        ) {
          return previous;
        }

        return next;
      });

      if (import.meta.env.DEV) {
        console.log(`[review] heatmap item count: ${heatmapItems.length}`);
        console.log(`[review] heatmap embeddings reused: ${reusedCount}`);
        console.log(`[review] heatmap embeddings borrowed from source: ${borrowedCount}`);
        console.log(`[review] heatmap embeddings generated: ${generatedCount}`);
        console.log(
          `[review] heatmap generation/render timing: ${(performance.now() - startedAt).toFixed(1)}ms`
        );
      }
    };

    void syncEmbeddings();

    return () => {
      cancelled = true;
    };
  }, [heatmapItems, sourceImages]);

  const aspectRatioCounts = useMemo(
    () =>
      Object.fromEntries(
        ASPECT_RATIOS.map((ratio) => [
          ratio,
          items.filter((item) => item.aspectRatio === ratio).length,
        ])
      ) as Record<string, number>,
    [items]
  );

  const heatmapData = useMemo(() => {
    const startedAt = performance.now();
    const heatmapVisibleItems = heatmapItems.filter((item) => itemEmbeddings[item.id]);

    if (heatmapVisibleItems.length < 2) {
      if (import.meta.env.DEV) {
        console.log('[review] heatmap data exists: false');
      }
      return null;
    }

    const embeddings = new Map<string, Float32Array>();
    for (const item of heatmapVisibleItems) {
      embeddings.set(item.id, itemEmbeddings[item.id]);
    }

    const matrix = computeDistanceMatrix(embeddings);
    const lookup = new Map<string, SimilarityResult>();

    for (const results of matrix.values()) {
      for (const result of results) {
        lookup.set(`${result.imageId1}::${result.imageId2}`, result);
        lookup.set(`${result.imageId2}::${result.imageId1}`, {
          ...result,
          imageId1: result.imageId2,
          imageId2: result.imageId1,
        });
      }
    }

    const itemIndexById = Object.fromEntries(
      heatmapVisibleItems.map((item, index) => [item.id, index + 1])
    ) as Record<string, number>;

    const rows = heatmapVisibleItems.map((rowItem) =>
      heatmapVisibleItems.map((columnItem) => {
        if (rowItem.id === columnItem.id) {
          return 1;
        }

        const similarity = lookup.get(`${rowItem.id}::${columnItem.id}`)?.similarity ?? 0;
        return similarity >= similarityThreshold ? similarity : 0;
      })
    );

    const clusters = performClustering(
      heatmapVisibleItems.map((item) => item.id),
      matrix,
      similarityThreshold
    ).filter((cluster) => cluster.imageIds.length > 1);

    const similarPairs = findSimilarPairs(matrix, similarityThreshold).slice(0, 12);

    if (import.meta.env.DEV) {
      console.log('[review] heatmap data exists: true');
      console.log(`[review] heatmap items included: ${heatmapVisibleItems.length}`);
      console.log(`[review] pair count: ${similarPairs.length}`);
      console.log(`[review] cluster count: ${clusters.length}`);
      console.log(
        `[review] heatmap generation/render timing: ${(performance.now() - startedAt).toFixed(1)}ms`
      );
    }

    return {
      items: heatmapVisibleItems,
      itemIndexById,
      rows,
      clusters,
      similarPairs,
    };
  }, [heatmapItems, itemEmbeddings, similarityThreshold]);

  useEffect(() => {
    if (!heatmapData?.similarPairs.some((pair) => `${pair.imageId1}:${pair.imageId2}` === selectedPairKey)) {
      setSelectedPairKey(null);
    }
    if (!heatmapData?.clusters.some((cluster) => cluster.id === selectedClusterId)) {
      setSelectedClusterId(null);
    }
  }, [heatmapData, selectedClusterId, selectedPairKey]);

  useEffect(() => {
    setActiveSimilarityView('all');
    setSelectedPairKey(null);
    setSelectedClusterId(null);
    setPreviewItemIds(null);
  }, [similarityThreshold, selectedAspectRatios]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(`[review] current Dataset Preview mode: ${activeSimilarityView}`);
      console.log(
        `[review] current Dataset Preview item ids: ${JSON.stringify(previewItemIds ?? filteredItems.map((item) => item.id))}`
      );
    }
  }, [activeSimilarityView, filteredItems, previewItemIds]);

  const highlightedIds = useMemo(() => {
    if (!heatmapData) {
      return new Set<string>();
    }

    if (activeSimilarityView === 'pairs' && selectedPairKey) {
      const pair = heatmapData.similarPairs.find(
        (entry) => `${entry.imageId1}:${entry.imageId2}` === selectedPairKey
      );
      return new Set(pair ? [pair.imageId1, pair.imageId2] : []);
    }

    if (activeSimilarityView === 'clusters' && selectedClusterId) {
      const cluster = heatmapData.clusters.find((entry) => entry.id === selectedClusterId);
      return new Set(cluster?.imageIds ?? []);
    }

    return new Set<string>();
  }, [activeSimilarityView, heatmapData, selectedClusterId, selectedPairKey]);

  const toggleAspectRatio = useCallback((ratio: string) => {
    setSelectedAspectRatios((previous) => {
      const next = new Set(previous);
      if (next.has(ratio)) {
        next.delete(ratio);
      } else {
        next.add(ratio);
      }
      return next;
    });
  }, []);

  const handleDeleteItem = useCallback(
    (id: string) => {
      softDeleteDatasetItem(id);
      addNotification('info', 'Item marked for deletion');
    },
    [addNotification, softDeleteDatasetItem]
  );

  const handleProceedToTagging = useCallback(() => {
    setCurrentStage('tagging');
  }, [setCurrentStage]);

  const showPairs = useCallback(() => {
    setActiveSimilarityView('pairs');
    setSelectedClusterId(null);
    setPreviewItemIds(null);
    if (import.meta.env.DEV) {
      console.log('[review] pair UI clicked');
    }
  }, []);

  const showClusters = useCallback(() => {
    setActiveSimilarityView('clusters');
    setSelectedPairKey(null);
    setPreviewItemIds(null);
    if (import.meta.env.DEV) {
      console.log('[review] cluster UI clicked');
    }
  }, []);

  const previewItems = useMemo(() => {
    if (previewItemIds && previewItemIds.length > 0) {
      const previewSet = new Set(previewItemIds);
      return filteredItems.filter((item) => previewSet.has(item.id));
    }

    return filteredItems;
  }, [filteredItems, previewItemIds]);

  const previewTitle = useMemo(() => {
    if (activeSimilarityView === 'pairs' && selectedPairKey && heatmapData) {
      const pair = heatmapData.similarPairs.find(
        (entry) => `${entry.imageId1}:${entry.imageId2}` === selectedPairKey
      );
      if (pair) {
        return `Dataset Preview (Pair #${heatmapData.itemIndexById[pair.imageId1]} and #${heatmapData.itemIndexById[pair.imageId2]})`;
      }
    }

    if (activeSimilarityView === 'clusters' && selectedClusterId && heatmapData) {
      const cluster = heatmapData.clusters.find((entry) => entry.id === selectedClusterId);
      if (cluster) {
        return `Dataset Preview (Cluster with ${cluster.imageIds.length} items)`;
      }
    }

    return `Dataset Preview (${filteredItems.length} items)`;
  }, [activeSimilarityView, filteredItems.length, heatmapData, selectedClusterId, selectedPairKey]);

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
              <span className="ml-1 font-mono">{aspectRatioCounts[ratio] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Visible Items</p>
          <p className="text-2xl font-bold">{filteredItems.length}</p>
        </div>
        <button
          onClick={showPairs}
          className={`rounded-lg border bg-card p-4 text-left transition-colors ${
            activeSimilarityView === 'pairs' ? 'border-primary bg-primary/5' : 'border-border'
          }`}
        >
          <p className="text-xs text-muted-foreground mb-1">Similar Pairs</p>
          <p className="text-2xl font-bold">{heatmapData?.similarPairs.length ?? 0}</p>
        </button>
        <button
          onClick={showClusters}
          className={`rounded-lg border bg-card p-4 text-left transition-colors ${
            activeSimilarityView === 'clusters' ? 'border-primary bg-primary/5' : 'border-border'
          }`}
        >
          <p className="text-xs text-muted-foreground mb-1">Clusters</p>
          <p className="text-2xl font-bold">{heatmapData?.clusters.length ?? 0}</p>
        </button>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Threshold</p>
          <p className="text-2xl font-bold">{uiThreshold.toFixed(2)}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Similarity Heatmap</h3>
            <p className="text-sm text-muted-foreground">
              Final Review uses a much more sensitive similarity threshold than Remove Duplicates.
            </p>
          </div>
          {heatmapData && (
            <div className="text-right text-sm text-muted-foreground">
              <p>Heatmap items: {heatmapData.items.length}</p>
              <p>Pairs: {heatmapData.similarPairs.length}</p>
              <p>Clusters: {heatmapData.clusters.length}</p>
            </div>
          )}
        </div>

        <div className="rounded-md border border-border bg-secondary/20 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Heatmap Sensitivity</label>
              <p className="text-xs text-muted-foreground">
                Lower values reveal more relationships faster; default is intentionally aggressive.
              </p>
            </div>
            <div className="w-48">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={uiThreshold}
                onChange={(event) => setUiThreshold(parseFloat(event.target.value))}
                className="w-full"
              />
              <div className="text-right text-xs font-mono mt-1">
                {uiThreshold.toFixed(2)} {'->'} {similarityThreshold.toFixed(3)}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
          onClick={() => {
            setActiveSimilarityView('all');
            setSelectedPairKey(null);
            setSelectedClusterId(null);
            setPreviewItemIds(null);
          }}
          className={`px-3 py-2 rounded-md text-sm transition-colors ${
              activeSimilarityView === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary hover:bg-muted'
            }`}
          >
            Heatmap
          </button>
          <button
            onClick={showPairs}
            className={`px-3 py-2 rounded-md text-sm transition-colors ${
              activeSimilarityView === 'pairs'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary hover:bg-muted'
            }`}
          >
            Similar Pairs
          </button>
          <button
            onClick={showClusters}
            className={`px-3 py-2 rounded-md text-sm transition-colors ${
              activeSimilarityView === 'clusters'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary hover:bg-muted'
            }`}
          >
            Clusters
          </button>
        </div>

        {heatmapData ? (
          <div className="space-y-4">
            {activeSimilarityView === 'all' && (
              <>
                <div className="overflow-auto rounded-md border border-border bg-background/60 p-3">
                  <div
                    className="inline-grid gap-1"
                    style={{
                      gridTemplateColumns: `48px repeat(${heatmapData.items.length}, minmax(18px, 22px))`,
                    }}
                  >
                    <div />
                    {heatmapData.items.map((item) => (
                      <div
                        key={`column-${item.id}`}
                        className="text-[10px] text-muted-foreground text-center font-mono"
                        title={`Image ${heatmapData.itemIndexById[item.id]}`}
                      >
                        {heatmapData.itemIndexById[item.id]}
                      </div>
                    ))}

                    {heatmapData.items.map((rowItem, rowIndex) => (
                      <Fragment key={`row-${rowItem.id}`}>
                        <div
                          className="text-[10px] text-muted-foreground flex items-center justify-center font-mono"
                          title={`Image ${heatmapData.itemIndexById[rowItem.id]}`}
                        >
                          {heatmapData.itemIndexById[rowItem.id]}
                        </div>

                        {heatmapData.rows[rowIndex].map((similarity, columnIndex) => {
                          const columnItem = heatmapData.items[columnIndex];
                          return (
                            <div
                              key={`${rowItem.id}-${columnItem.id}`}
                              className="aspect-square rounded-sm border border-black/10"
                              style={{ backgroundColor: getHeatmapColor(similarity) }}
                              title={`#${heatmapData.itemIndexById[rowItem.id]} vs #${
                                heatmapData.itemIndexById[columnItem.id]
                              }: ${(similarity * 100).toFixed(1)}%`}
                            />
                          );
                        })}
                      </Fragment>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm bg-blue-600/40 border border-black/10" />
                    low similarity
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm bg-amber-500/60 border border-black/10" />
                    medium similarity
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm bg-red-600/70 border border-black/10" />
                    very similar
                  </span>
                </div>
              </>
            )}

            {activeSimilarityView === 'pairs' && (
              <div className="rounded-md border border-border bg-secondary/30 p-3">
                <p className="text-sm font-medium mb-3">Most Similar Pairs</p>
                {heatmapData.similarPairs.length > 0 ? (
                  <div className="space-y-2">
                    {heatmapData.similarPairs.map((pair) => {
                      const pairKey = `${pair.imageId1}:${pair.imageId2}`;
                      return (
                        <button
                          key={pairKey}
                          onClick={() => {
                            setSelectedPairKey(pairKey);
                            setSelectedClusterId(null);
                            setActiveSimilarityView('pairs');
                            setPreviewItemIds([pair.imageId1, pair.imageId2]);
                            if (import.meta.env.DEV) {
                              console.log(`[review] pair UI clicked: ${pairKey}`);
                              console.log(`[review] selected pair id(s): ${pair.imageId1}, ${pair.imageId2}`);
                            }
                          }}
                          className={`w-full flex items-center justify-between text-left text-xs rounded-md px-3 py-2 transition-colors ${
                            selectedPairKey === pairKey
                              ? 'bg-primary/10 border border-primary/30'
                              : 'bg-background border border-border hover:border-primary/40'
                          }`}
                        >
                          <span>
                            #{heatmapData.itemIndexById[pair.imageId1]} and #
                            {heatmapData.itemIndexById[pair.imageId2]}
                          </span>
                          <span className="font-mono text-foreground flex items-center gap-2">
                            {(pair.similarity * 100).toFixed(1)}%
                            <ChevronRight size={14} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No strong similarity pairs in the current heatmap window.
                  </p>
                )}
              </div>
            )}

            {activeSimilarityView === 'clusters' && (
              <div className="rounded-md border border-border bg-secondary/30 p-3">
                <p className="text-sm font-medium mb-3">Similarity Clusters</p>
                {heatmapData.clusters.length > 0 ? (
                  <div className="space-y-2">
                    {heatmapData.clusters.map((cluster: SimilarityCluster) => (
                      <button
                        key={cluster.id}
                        onClick={() => {
                          setSelectedClusterId(cluster.id);
                          setSelectedPairKey(null);
                          setActiveSimilarityView('clusters');
                          setPreviewItemIds(cluster.imageIds);
                          if (import.meta.env.DEV) {
                            console.log(`[review] cluster UI clicked: ${cluster.id}`);
                            console.log(`[review] selected cluster id: ${cluster.id}`);
                          }
                        }}
                        className={`w-full flex items-center justify-between text-left text-xs rounded-md px-3 py-2 transition-colors ${
                          selectedClusterId === cluster.id
                            ? 'bg-primary/10 border border-primary/30'
                            : 'bg-background border border-border hover:border-primary/40'
                        }`}
                      >
                        <span>
                          {cluster.imageIds
                            .map((id) => `#${heatmapData.itemIndexById[id]}`)
                            .join(', ')}
                        </span>
                        <span className="font-mono text-foreground flex items-center gap-2">
                          {(cluster.avgSimilarity * 100).toFixed(1)}%
                          <ChevronRight size={14} />
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No multi-image clusters above the current review threshold.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
            Preparing similarity heatmap for the current review dataset...
          </div>
        )}
      </div>

      {filteredItems.length > 0 && (
        <div>
          <div className="mb-4">
            <div>
              <h3 className="text-lg font-semibold">{previewTitle}</h3>
              <p className="text-sm text-muted-foreground">
                {activeSimilarityView === 'pairs' && selectedPairKey
                  ? 'Showing only the selected similar pair.'
                  : activeSimilarityView === 'clusters' && selectedClusterId
                    ? 'Showing only the selected similarity cluster.'
                    : 'Final check before moving to tagging.'}
              </p>
            </div>
          </div>

          <div className="gallery-masonry">
            {previewItems.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                previewUrl={previewUrls[item.id]}
                onDelete={handleDeleteItem}
                highlighted={highlightedIds.has(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      {filteredItems.length === 0 && (
        <div className="text-center py-12 rounded-lg bg-secondary/50 border border-dashed border-border">
          <p className="text-muted-foreground">No items matching selected aspect ratios</p>
        </div>
      )}

      <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4">
        <p className="text-sm text-blue-600">
          <strong>Next step:</strong> Review the thumbnails and similarity map, then continue with
          the remaining dataset flow.
        </p>
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleProceedToTagging}
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity font-medium"
        >
          Proceed to Tag Images
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};
