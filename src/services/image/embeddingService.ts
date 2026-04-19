/**
 * Embedding service
 * Generates visual embeddings for images using simple pixel-based features
 * Later enhancement: integrate with ONNX/TensorFlow models for better embeddings
 */

/**
 * Generate a simple visual embedding from image blob
 * This is a placeholder implementation using pixel histograms
 * In production, replace with proper CNN/transformer model
 */
export const generateEmbedding = async (blob: Blob): Promise<Float32Array> => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Use fixed size for consistency
  canvas.width = 32;
  canvas.height = 32;

  const url = URL.createObjectURL(blob);
  const img = new Image();

  return new Promise((resolve, reject) => {
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Generate embedding: grayscale histogram over 256 bins
        const embedding = new Float32Array(256);

        // Compute grayscale histogram across the full 0-255 range.
        // The previous implementation divided by 256 before flooring,
        // which collapsed nearly every pixel into bin 0 and made unrelated
        // images appear identical.
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          const avg = (r + g + b) / 3;
          const bin = Math.max(0, Math.min(255, Math.floor(avg)));
          embedding[Math.min(bin, 255)]++;
        }

        // Normalize
        const sum = embedding.reduce((a, b) => a + b, 0);
        for (let i = 0; i < embedding.length; i++) {
          embedding[i] /= sum;
        }

        URL.revokeObjectURL(url);
        resolve(embedding);
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for embedding'));
    };

    img.src = url;
  });
};

/**
 * Compute cosine distance between two embeddings
 * Returns value between 0 (identical) and 2 (completely different)
 */
export const computeSimilarity = (
  embedding1: Float32Array,
  embedding2: Float32Array
): number => {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
    norm1 += embedding1[i] * embedding1[i];
    norm2 += embedding2[i] * embedding2[i];
  }

  norm1 = Math.sqrt(norm1);
  norm2 = Math.sqrt(norm2);

  if (norm1 === 0 || norm2 === 0) {
    return 1;
  }

  const cosineSimilarity = dotProduct / (norm1 * norm2);
  // Convert to distance (0 = identical, 1 = orthogonal)
  return 1 - cosineSimilarity;
};

/**
 * Generate hash for image (perceptual hash)
 * Simple implementation for deduplication
 */
export const generateImageHash = async (blob: Blob): Promise<string> => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  canvas.width = 8;
  canvas.height = 8;

  const url = URL.createObjectURL(blob);
  const img = new Image();

  return new Promise((resolve, reject) => {
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        let hash = '';
        const average =
          data.reduce((sum, byte, i) => (i % 4 !== 3 ? sum + byte : sum), 0) /
          (data.length - data.length / 4);

        for (let i = 0; i < data.length; i += 4) {
          const pixelValue = (data[i] + data[i + 1] + data[i + 2]) / 3;
          hash += pixelValue > average ? '1' : '0';
        }

        URL.revokeObjectURL(url);
        resolve(hash);
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for hash'));
    };

    img.src = url;
  });
};
