/**
 * Export Service
 * Generates PNG + TXT files for export
 */

import JSZip from 'jszip';
import { DatasetItem } from '../../types';

interface ExportConfig {
  datasetKeyword: string;
  items: DatasetItem[];
}

/**
 * Generate tag string for item
 */
export const generateTagString = (
  item: DatasetItem,
  datasetKeyword: string,
  blacklist: string[]
): string => {
  const keyword = datasetKeyword.toLowerCase();
  let tags = [keyword];

  if (item.tags) {
    const filtered = item.tags.filter((t) => !blacklist.includes(t.toLowerCase()));
    tags.push(...filtered);
  }

  return tags.join(', ');
};

/**
 * Export as ZIP
 */
export const exportAsZip = async (config: ExportConfig, blacklist: string[] = []): Promise<Blob> => {
  const zip = new JSZip();
  const itemsFolder = zip.folder('dataset');

  if (!itemsFolder) throw new Error('Failed to create folder');

  for (let i = 0; i < config.items.length; i++) {
    const item = config.items[i];
    const index = i + 1;
    const basename = String(index);

    // Add PNG
    itemsFolder.file(`${basename}.png`, item.imageData);

    // Generate and add TXT
    const tagString = generateTagString(item, config.datasetKeyword, blacklist);
    itemsFolder.file(`${basename}.txt`, tagString + '\n');
  }

  return await zip.generateAsync({ type: 'blob' });
};

/**
 * Save file directly (if File System Access API is available)
 */
export const saveDirectoryViaFilesystemAPI = async (
  config: ExportConfig,
  blacklist: string[]
): Promise<boolean> => {
  // Check if File System Access API is available
  if (!('showDirectoryPicker' in window)) {
    return false;
  }

  try {
    const dirHandle = await (window as any).showDirectoryPicker();

    for (let i = 0; i < config.items.length; i++) {
      const item = config.items[i];
      const index = i + 1;
      const basename = String(index);

      // Write PNG
      const pngHandle = await dirHandle.getFileHandle(`${basename}.png`, { create: true });
      const pngWriter = await pngHandle.createWritable();
      await pngWriter.write(item.imageData);
      await pngWriter.close();

      // Write TXT
      const tagString = generateTagString(item, config.datasetKeyword, blacklist);
      const txtHandle = await dirHandle.getFileHandle(`${basename}.txt`, { create: true });
      const txtWriter = await txtHandle.createWritable();
      await txtWriter.write(tagString + '\n');
      await txtWriter.close();
    }

    return true;
  } catch {
    return false;
  }
};

/**
 * Download ZIP file
 */
export const downloadZipFile = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
