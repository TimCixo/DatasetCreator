import * as Dialog from '@radix-ui/react-dialog';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Settings2, X } from 'lucide-react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';

type PreviewMap = Record<string, string>;
type PreviewCacheEntry = { blob: Blob; url: string };

const parseTagInput = (value: string): string[] =>
  value
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

type TaggingCardProps = {
  item: ReturnType<typeof useProjectStore.getState>['datasetItems'][string];
  previewUrl?: string;
  inputValue: string;
  onInputChange: (itemId: string, value: string) => void;
  onSubmit: (itemId: string) => void;
  onRemoveTag: (itemId: string, tag: string) => void;
};

const TaggingCard = memo(
  ({ item, previewUrl, inputValue, onInputChange, onSubmit, onRemoveTag }: TaggingCardProps) => {
    return (
      <div
        className="gallery-masonry-item rounded-lg overflow-hidden border border-border bg-card"
        style={{ contentVisibility: 'auto', containIntrinsicSize: '420px' }}
      >
        <div className="relative min-h-[12rem] bg-black overflow-hidden flex items-center justify-center">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={`Image ${item.id}`}
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

          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent p-3">
            <p className="text-sm font-medium text-white">Image #{item.exportOrder ?? item.id.slice(0, 8)}</p>
          </div>
        </div>

        <div className="p-3 space-y-3">
          <div className="rounded-md border border-border bg-secondary/40 p-2 h-20 overflow-y-auto">
            <div className="flex flex-wrap gap-2 content-start">
              {item.tags && item.tags.length > 0 ? (
                item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-primary text-primary-foreground rounded text-xs"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => onRemoveTag(item.id, tag)}
                      className="hover:opacity-70"
                      aria-label={`Remove tag ${tag}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">No tags yet</span>
              )}
            </div>
          </div>

          <input
            type="text"
            value={inputValue}
            onChange={(event) => onInputChange(item.id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSubmit(item.id);
              }
            }}
            placeholder="Add tags with commas, then press Enter"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
          />
        </div>
      </div>
    );
  }
);

TaggingCard.displayName = 'TaggingCard';

export const TaggingStage = () => {
  const items = useProjectStore((state) =>
    Object.values(state.datasetItems)
      .filter((item) => !item.deleted)
      .sort((left, right) => (left.exportOrder ?? 0) - (right.exportOrder ?? 0))
  );
  const updateDatasetItem = useProjectStore((state) => state.updateDatasetItem);
  const updateTaggingConfig = useProjectStore((state) => state.updateTaggingConfig);
  const setCurrentStage = useProjectStore((state) => state.setCurrentStage);
  const taggingConfig = useProjectStore((state) => state.taggingConfig);
  const { addNotification } = useUIStore();

  const [tagInputs, setTagInputs] = useState<Record<string, string>>({});
  const [newBlacklistTag, setNewBlacklistTag] = useState('');
  const [globalTagsToAdd, setGlobalTagsToAdd] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<PreviewMap>({});
  const previewCacheRef = useRef<Record<string, PreviewCacheEntry>>({});

  useEffect(() => {
    setPreviewUrls((previous) => {
      const next: PreviewMap = {};
      const activeIds = new Set(items.map((item) => item.id));
      let validThumbnailCount = 0;

      for (const item of items) {
        const cached = previewCacheRef.current[item.id];

        if (cached && cached.blob === item.imageData) {
          next[item.id] = cached.url;
          validThumbnailCount++;
          continue;
        }

        if (cached) {
          URL.revokeObjectURL(cached.url);
        }

        try {
          const url = URL.createObjectURL(item.imageData);
          previewCacheRef.current[item.id] = { blob: item.imageData, url };
          next[item.id] = url;
          validThumbnailCount++;
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn(`[tagging] failed preview generation: ${item.id}`, error);
          }
        }
      }

      for (const [id, cached] of Object.entries(previewCacheRef.current)) {
        if (activeIds.has(id)) {
          continue;
        }
        URL.revokeObjectURL(cached.url);
        delete previewCacheRef.current[id];
      }

      if (import.meta.env.DEV) {
        console.log(`[tagging] gallery item count: ${items.length}`);
        console.log(`[tagging] cards with valid thumbnail source: ${validThumbnailCount}`);
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
      Object.values(previewCacheRef.current).forEach((entry) => URL.revokeObjectURL(entry.url));
      previewCacheRef.current = {};
    };
  }, []);

  const summary = useMemo(() => {
    const taggedCount = items.filter((item) => (item.tags?.length ?? 0) > 0).length;
    const untaggedCount = items.length - taggedCount;
    const frequencies = new Map<string, number>();

    for (const item of items) {
      for (const tag of item.tags ?? []) {
        frequencies.set(tag, (frequencies.get(tag) ?? 0) + 1);
      }
    }

    const topTags = Array.from(frequencies.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 12);

    if (import.meta.env.DEV) {
      console.log(`[tagging] tagged image count: ${taggedCount}`);
      console.log(`[tagging] untagged image count: ${untaggedCount}`);
      console.log(`[tagging] tag frequency map size: ${frequencies.size}`);
    }

    return { taggedCount, untaggedCount, topTags, uniqueTagCount: frequencies.size };
  }, [items]);

  const applyTagsToItem = useCallback(
    (itemId: string, rawValue: string) => {
      const parsedTags = parseTagInput(rawValue);
      const item = items.find((entry) => entry.id === itemId);
      if (!item) {
        return;
      }

      const existingTags = new Set(item.tags ?? []);
      const nextTags = [...(item.tags ?? [])];
      const skippedDuplicates: string[] = [];

      for (const tag of parsedTags) {
        if (taggingConfig.blacklist.includes(tag) || existingTags.has(tag)) {
          if (existingTags.has(tag)) {
            skippedDuplicates.push(tag);
          }
          continue;
        }

        existingTags.add(tag);
        nextTags.push(tag);
      }

      if (import.meta.env.DEV) {
        console.log(`[tagging] raw input string: ${rawValue}`);
        console.log(`[tagging] parsed tag list: ${JSON.stringify(parsedTags)}`);
        console.log(`[tagging] skipped duplicate tags: ${JSON.stringify(skippedDuplicates)}`);
      }

      if (nextTags.length !== (item.tags ?? []).length) {
        updateDatasetItem(itemId, { tags: nextTags });
      }

      setTagInputs((previous) => ({ ...previous, [itemId]: '' }));
    },
    [items, taggingConfig.blacklist, updateDatasetItem]
  );

  const handleAddBlacklistTag = () => {
    const [tag] = parseTagInput(newBlacklistTag);
    if (!tag || taggingConfig.blacklist.includes(tag)) {
      return;
    }

    updateTaggingConfig({
      blacklist: [...taggingConfig.blacklist, tag],
    });
    setNewBlacklistTag('');
  };

  const handleRemoveBlacklistTag = (tag: string) => {
    updateTaggingConfig({
      blacklist: taggingConfig.blacklist.filter((entry) => entry !== tag),
    });
  };

  const handleAddGlobalTags = () => {
    const parsedTags = parseTagInput(globalTagsToAdd);
    if (parsedTags.length === 0) {
      return;
    }

    for (const item of items) {
      const existingTags = new Set(item.tags ?? []);
      const nextTags = [...(item.tags ?? [])];

      for (const tag of parsedTags) {
        if (taggingConfig.blacklist.includes(tag) || existingTags.has(tag)) {
          continue;
        }

        existingTags.add(tag);
        nextTags.push(tag);
      }

      if (nextTags.length !== (item.tags ?? []).length) {
        updateDatasetItem(item.id, { tags: nextTags });
      }
    }

    addNotification('success', `Added ${parsedTags.length} tag(s) across the current dataset`);
    setGlobalTagsToAdd('');
  };

  const handleSettingsOpenChange = (open: boolean) => {
    setIsSettingsOpen(open);
    if (import.meta.env.DEV) {
      console.log(`[tagging] modal opened successfully: ${open}`);
    }
  };

  const handleAutoTaggingAction = () => {
    addNotification('info', 'Auto-tagging settings saved to working state');
    if (import.meta.env.DEV) {
      console.log('[tagging] settings were applied to working state successfully');
    }
  };

  const handleRemoveTag = useCallback(
    (itemId: string, tag: string) => {
      const item = items.find((entry) => entry.id === itemId);
      if (!item?.tags) {
        return;
      }

      const nextTags = item.tags.filter((entry) => entry !== tag);
      updateDatasetItem(itemId, { tags: nextTags });

      if (import.meta.env.DEV) {
        console.log(`[tagging] tag removed: ${tag}`);
        console.log(`[tagging] image id affected: ${itemId}`);
        console.log(`[tagging] resulting tag list for that image: ${JSON.stringify(nextTags)}`);
      }
    },
    [items, updateDatasetItem]
  );

  const handleProceedToExport = () => {
    setCurrentStage('export');
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No images to tag.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Auto-Tag Images</h2>
          <p className="text-sm text-muted-foreground">
            Review each image visually, inspect current tags, and add new tags with comma-separated
            input.
          </p>
        </div>

        <Dialog.Root open={isSettingsOpen} onOpenChange={handleSettingsOpenChange}>
          <Dialog.Trigger asChild>
            <button className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-secondary hover:bg-muted transition-colors">
              <Settings2 size={16} />
              Tagging Settings
            </button>
          </Dialog.Trigger>

          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/60 z-40" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(720px,calc(100vw-2rem))] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-2xl overflow-y-auto">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <Dialog.Title className="text-lg font-semibold">Tagging Settings</Dialog.Title>
                  <Dialog.Description className="text-sm text-muted-foreground">
                    Configure dataset-level tagging rules and bulk tagging actions.
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button className="p-2 rounded-md hover:bg-secondary transition-colors">
                    <X size={16} />
                  </button>
                </Dialog.Close>
              </div>

              <div className="space-y-5">
                <div className="rounded-lg border border-border bg-secondary/20 p-4">
                  <h3 className="text-sm font-semibold mb-2">Dataset Keyword</h3>
                  <input
                    type="text"
                    value={taggingConfig.datasetKeyword}
                    onChange={(event) =>
                      updateTaggingConfig({ datasetKeyword: event.target.value })
                    }
                    placeholder="my_dataset"
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                  />
                </div>

                <div className="rounded-lg border border-border bg-secondary/20 p-4">
                  <h3 className="text-sm font-semibold mb-2">Blacklist</h3>
                  <div className="flex gap-2 mb-3">
                    <input
                      type="text"
                      value={newBlacklistTag}
                      onChange={(event) => setNewBlacklistTag(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleAddBlacklistTag();
                        }
                      }}
                      placeholder="tag_to_block"
                      className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm"
                    />
                    <button
                      onClick={handleAddBlacklistTag}
                      className="px-4 py-2 rounded-md bg-destructive text-destructive-foreground hover:opacity-90"
                    >
                      Add
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {taggingConfig.blacklist.length > 0 ? (
                      taggingConfig.blacklist.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => handleRemoveBlacklistTag(tag)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-destructive/15 text-destructive hover:bg-destructive/25"
                        >
                          {tag}
                          <X size={12} />
                        </button>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">No blacklist tags yet</span>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-secondary/20 p-4">
                  <h3 className="text-sm font-semibold mb-2">Add Tags to All</h3>
                  <textarea
                    value={globalTagsToAdd}
                    onChange={(event) => setGlobalTagsToAdd(event.target.value)}
                    placeholder="tag1, tag2, tag3"
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm min-h-24 resize-none"
                  />
                  <button
                    onClick={handleAddGlobalTags}
                    className="mt-3 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90"
                  >
                    Apply to All {items.length} Images
                  </button>
                </div>

                <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-4">
                  <h3 className="text-sm font-semibold">Auto-Tagging Controls</h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-2">Endpoint</label>
                      <input
                        type="text"
                        value={taggingConfig.autoTaggingEndpoint ?? ''}
                        onChange={(event) =>
                          updateTaggingConfig({ autoTaggingEndpoint: event.target.value })
                        }
                        placeholder="https://..."
                        className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-muted-foreground mb-2">Threshold</label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={taggingConfig.threshold}
                        onChange={(event) =>
                          updateTaggingConfig({ threshold: parseFloat(event.target.value) })
                        }
                        className="w-full"
                      />
                      <p className="text-xs font-mono mt-1">{taggingConfig.threshold.toFixed(2)}</p>
                    </div>

                    <div>
                      <label className="block text-xs text-muted-foreground mb-2">Max Tags</label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={taggingConfig.maxTags}
                        onChange={(event) =>
                          updateTaggingConfig({ maxTags: Math.max(1, parseInt(event.target.value || '1', 10)) })
                        }
                        className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-muted-foreground mb-2">Insert Mode</label>
                      <select
                        value={taggingConfig.insertMode}
                        onChange={(event) =>
                          updateTaggingConfig({
                            insertMode: event.target.value as typeof taggingConfig.insertMode,
                          })
                        }
                        className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                      >
                        <option value="prepend">Prepend</option>
                        <option value="append">Append</option>
                        <option value="overwrite">Overwrite</option>
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={handleAutoTaggingAction}
                    className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90"
                  >
                    Save Auto-Tagging Settings
                  </button>
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Tagged Images</p>
          <p className="text-2xl font-bold">{summary.taggedCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Untagged Images</p>
          <p className="text-2xl font-bold">{summary.untaggedCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Unique Tags</p>
          <p className="text-2xl font-bold">{summary.uniqueTagCount}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold">Tag Frequency Overview</h3>
            <p className="text-sm text-muted-foreground">
              Most repeated tags across the current dataset selection.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {summary.topTags.length > 0 ? (
            summary.topTags.map(([tag, count]) => (
              <span
                key={tag}
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary text-foreground text-sm"
              >
                <span>{tag}</span>
                <span className="text-xs text-muted-foreground">{count}</span>
              </span>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">No tags assigned yet</span>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold">Tagging Gallery</h3>
            <p className="text-sm text-muted-foreground">
              Each card shows the image, current tags, and a one-line input for adding more tags.
            </p>
          </div>
          <div className="text-sm text-muted-foreground">{items.length} images</div>
        </div>

        <div className="gallery-masonry">
          {items.map((item) => (
            <TaggingCard
              key={item.id}
              item={item}
              previewUrl={previewUrls[item.id]}
              inputValue={tagInputs[item.id] ?? ''}
              onInputChange={(itemId, value) =>
                setTagInputs((previous) => ({ ...previous, [itemId]: value }))
              }
              onSubmit={(itemId) => applyTagsToItem(itemId, tagInputs[itemId] ?? '')}
              onRemoveTag={handleRemoveTag}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleProceedToExport}
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity font-medium"
        >
          Proceed to Export
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};
