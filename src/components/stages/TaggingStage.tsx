import { useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { AlertCircle, X, Plus } from 'lucide-react';

export const TaggingStage = () => {
  const { getDatasetItems, updateDatasetItem, updateTaggingConfig, taggingConfig } = useProjectStore();
  const { addNotification } = useUIStore();

  const [newTag, setNewTag] = useState('');
  const [newBlacklistTag, setNewBlacklistTag] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [globalTagsToAdd, setGlobalTagsToAdd] = useState('');

  const items = getDatasetItems(false);
  const selectedItem = items.find((i) => i.id === selectedItemId) || items[0];

  const handleAddTag = (itemId: string, tag: string) => {
    const cleanTag = tag.trim().toLowerCase();
    if (!cleanTag || taggingConfig.blacklist.includes(cleanTag)) return;

    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    const tags = item.tags ? [...item.tags] : [];
    if (!tags.includes(cleanTag)) {
      tags.push(cleanTag);
      updateDatasetItem(itemId, { tags });
    }
  };

  const handleRemoveTag = (itemId: string, tag: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item?.tags) return;

    updateDatasetItem(itemId, {
      tags: item.tags.filter((t) => t !== tag),
    });
  };

  const handleAddBlacklistTag = (tag: string) => {
    const cleanTag = tag.trim().toLowerCase();
    if (!cleanTag) return;

    if (!taggingConfig.blacklist.includes(cleanTag)) {
      updateTaggingConfig({
        blacklist: [...taggingConfig.blacklist, cleanTag],
      });
      setNewBlacklistTag('');
    }
  };

  const handleRemoveBlacklistTag = (tag: string) => {
    updateTaggingConfig({
      blacklist: taggingConfig.blacklist.filter((t) => t !== tag),
    });
  };

  const handleAddGlobalTags = () => {
    const tags = globalTagsToAdd.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tags.length === 0) return;

    for (const itemId of items.map((i) => i.id)) {
      const item = items.find((i) => i.id === itemId);
      if (item) {
        const existingTags = item.tags || [];
        const newTags = [...existingTags, ...tags].filter(
          (t, i, arr) => arr.indexOf(t) === i && !taggingConfig.blacklist.includes(t)
        );
        updateDatasetItem(itemId, { tags: newTags });
      }
    }

    addNotification('success', `Added ${tags.length} tags to all items`);
    setGlobalTagsToAdd('');
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
    <div className="grid grid-cols-3 gap-6">
      {/* Left: Item List */}
      <div className="rounded-lg border border-border bg-card p-4 overflow-y-auto max-h-96">
        <h3 className="text-sm font-semibold mb-3">Items ({items.length})</h3>
        <div className="space-y-1">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelectedItemId(item.id)}
              className={`w-full text-left px-2 py-1 rounded text-sm ${
                selectedItemId === item.id
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-secondary'
              }`}
            >
              {item.width}×{item.height}
              {item.tags && item.tags.length > 0 && (
                <span className="ml-2 text-xs opacity-70">({item.tags.length})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Middle: Item Tagging */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold mb-2">Add Tags</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && selectedItem) {
                  handleAddTag(selectedItem.id, newTag);
                  setNewTag('');
                }
              }}
              placeholder="Enter tag..."
              className="flex-1 px-2 py-1 rounded border border-border bg-background text-sm"
            />
            <button
              onClick={() => {
                if (selectedItem) {
                  handleAddTag(selectedItem.id, newTag);
                  setNewTag('');
                }
              }}
              className="px-2 py-1 bg-primary text-primary-foreground rounded text-sm hover:opacity-90"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {selectedItem && (
          <div>
            <h3 className="text-sm font-semibold mb-2">Current Tags</h3>
            <div className="flex flex-wrap gap-2 p-2 rounded bg-secondary/50 min-h-10">
              {selectedItem.tags && selectedItem.tags.length > 0 ? (
                selectedItem.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-primary text-primary-foreground rounded text-xs"
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(selectedItem.id, tag)}
                      className="hover:opacity-70"
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
        )}
      </div>

      {/* Right: Global Settings */}
      <div className="space-y-4">
        {/* Keyword */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-2">Dataset Keyword</h3>
          <input
            type="text"
            value={taggingConfig.datasetKeyword}
            onChange={(e) =>
              updateTaggingConfig({ datasetKeyword: e.target.value })
            }
            placeholder="my_dataset"
            className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Will be first tag in all exports
          </p>
        </div>

        {/* Blacklist */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-2">Blacklist</h3>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={newBlacklistTag}
              onChange={(e) => setNewBlacklistTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddBlacklistTag(newBlacklistTag);
                }
              }}
              placeholder="Tag to block..."
              className="flex-1 px-2 py-1 rounded border border-border bg-background text-sm"
            />
            <button
              onClick={() => handleAddBlacklistTag(newBlacklistTag)}
              className="px-2 py-1 bg-destructive text-destructive-foreground rounded text-sm hover:opacity-90"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {taggingConfig.blacklist.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-1 bg-destructive/20 text-destructive rounded text-xs"
              >
                {tag}
                <button
                  onClick={() => handleRemoveBlacklistTag(tag)}
                  className="hover:opacity-70"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Global Tags */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-2">Add Tags to All</h3>
          <textarea
            value={globalTagsToAdd}
            onChange={(e) => setGlobalTagsToAdd(e.target.value)}
            placeholder="tag1, tag2, tag3"
            className="w-full px-2 py-1 rounded border border-border bg-background text-sm min-h-20 resize-none"
          />
          <button
            onClick={handleAddGlobalTags}
            className="w-full mt-2 px-3 py-1 bg-primary text-primary-foreground rounded text-sm hover:opacity-90"
          >
            Apply to All {items.length} Items
          </button>
        </div>

        {/* Stats */}
        <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4">
          <p className="text-xs font-mono text-blue-600">
            <strong>{items.filter((i) => i.tags && i.tags.length > 0).length}</strong> / {items.length} tagged
          </p>
        </div>
      </div>
    </div>
  );
};
