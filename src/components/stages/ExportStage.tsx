import { useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import {
  exportAsZip,
  downloadZipFile,
  saveDirectoryViaFilesystemAPI,
} from '../../services/export/exportService';
import { AlertCircle, Download, FolderOpen } from 'lucide-react';

export const ExportStage = () => {
  const { getDatasetItems, taggingConfig } = useProjectStore();
  const { addNotification } = useUIStore();

  const [isExporting, setIsExporting] = useState(false);
  const [exportMethod, setExportMethod] = useState<'zip' | 'directory'>('zip');

  const items = getDatasetItems(false);
  const totalSize = items.reduce((sum, item) => sum + item.imageData.size, 0);

  const handleExport = async () => {
    if (items.length === 0) {
      addNotification('warning', 'No images to export');
      return;
    }

    setIsExporting(true);

    try {
      // Try directory API if selected
      if (exportMethod === 'directory') {
        const success = await saveDirectoryViaFilesystemAPI(
          {
            datasetKeyword: taggingConfig.datasetKeyword,
            items,
          },
          taggingConfig.blacklist
        );

        if (success) {
          addNotification('success', `Exported ${items.length} images and tag files`);
          setIsExporting(false);
          return;
        }

        addNotification('info', 'Directory API not available, using ZIP fallback');
      }

      // Fallback to ZIP
      const zipBlob = await exportAsZip(
        {
          datasetKeyword: taggingConfig.datasetKeyword,
          items,
        },
        taggingConfig.blacklist
      );

      downloadZipFile(zipBlob, `dataset-${new Date().toISOString().split('T')[0]}.zip`);
      addNotification('success', `Exported ${items.length} images as ZIP`);
    } catch (error) {
      console.error('Export failed:', error);
      addNotification('error', 'Failed to export dataset');
    } finally {
      setIsExporting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No images to export.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Dataset Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Total Images</p>
          <p className="text-2xl font-bold">{items.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Total Size</p>
          <p className="text-2xl font-bold">{(totalSize / 1024 / 1024).toFixed(1)} MB</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Tagged</p>
          <p className="text-2xl font-bold">
            {items.filter((i) => i.tags && i.tags.length > 0).length}/{items.length}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Keyword</p>
          <p className="text-sm font-mono font-bold">{taggingConfig.datasetKeyword}</p>
        </div>
      </div>

      {/* Export Format Selection */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h3 className="text-lg font-semibold">Export Format</h3>

        <div className="space-y-3">
          <label className="flex items-center gap-3 p-4 rounded-lg border-2 border-border hover:border-primary cursor-pointer transition-colors" onClick={() => setExportMethod('directory')}>
            <input
              type="radio"
              name="export-method"
              value="directory"
              checked={exportMethod === 'directory'}
              onChange={() => setExportMethod('directory')}
              className="w-4 h-4"
            />
            <div>
              <p className="font-medium">Save to Directory (Recommended)</p>
              <p className="text-sm text-muted-foreground">
                Uses File System Access API to save files directly
              </p>
            </div>
            <FolderOpen className="ml-auto text-muted-foreground" />
          </label>

          <label className="flex items-center gap-3 p-4 rounded-lg border-2 border-border hover:border-primary cursor-pointer transition-colors" onClick={() => setExportMethod('zip')}>
            <input
              type="radio"
              name="export-method"
              value="zip"
              checked={exportMethod === 'zip'}
              onChange={() => setExportMethod('zip')}
              className="w-4 h-4"
            />
            <div>
              <p className="font-medium">Download as ZIP</p>
              <p className="text-sm text-muted-foreground">
                Creates a ZIP file with all images and tag files
              </p>
            </div>
            <Download className="ml-auto text-muted-foreground" />
          </label>
        </div>
      </div>

      {/* Export Preview */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h3 className="text-lg font-semibold">Preview</h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {items.slice(0, 5).map((item, index) => (
            <div key={item.id} className="p-2 bg-secondary/50 rounded text-sm font-mono text-xs">
              <div className="font-semibold">{index + 1}.png / {index + 1}.txt</div>
              <div className="text-muted-foreground">
                {taggingConfig.datasetKeyword}
                {item.tags && item.tags.length > 0
                  ? ', ' + item.tags.join(', ')
                  : ' (no tags)'}
              </div>
            </div>
          ))}
          {items.length > 5 && (
            <div className="p-2 text-xs text-muted-foreground">
              ... and {items.length - 5} more files
            </div>
          )}
        </div>
      </div>

      {/* Export Button */}
      <button
        onClick={handleExport}
        disabled={isExporting}
        className="w-full px-6 py-4 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity font-semibold text-lg"
      >
        {isExporting ? 'Exporting...' : `Export ${items.length} Images`}
      </button>

      {/* Notes */}
      <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-4 space-y-2">
        <p className="text-sm font-medium text-yellow-700">Export Notes:</p>
        <ul className="text-sm text-yellow-600 space-y-1 ml-4">
          <li>• Files numbered 1, 2, 3... in final list order</li>
          <li>• Each PNG has matching TXT file with tags</li>
          <li>• Dataset keyword always first tag</li>
          <li>• Tags separated by comma + space</li>
          <li>• Blacklisted tags automatically removed</li>
        </ul>
      </div>
    </div>
  );
};
