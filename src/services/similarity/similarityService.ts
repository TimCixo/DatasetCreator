/**
 * Similarity service
 * Computes similarity between images and performs clustering
 */

import { SimilarityResult, SimilarityCluster } from '../../types';
import { computeSimilarity } from '../image/embeddingService';

/**
 * Compute pairwise distances between all embeddings
 */
export const computeDistanceMatrix = (
  embeddings: Map<string, Float32Array>
): Map<string, SimilarityResult[]> => {
  const results = new Map<string, SimilarityResult[]>();
  const imageIds = Array.from(embeddings.keys());

  for (let i = 0; i < imageIds.length; i++) {
    const id1 = imageIds[i];
    const emb1 = embeddings.get(id1)!;
    const distances: SimilarityResult[] = [];

    for (let j = i + 1; j < imageIds.length; j++) {
      const id2 = imageIds[j];
      const emb2 = embeddings.get(id2)!;

      const distance = computeSimilarity(emb1, emb2);
      const similarity = 1 - distance;

      distances.push({
        imageId1: id1,
        imageId2: id2,
        distance,
        similarity,
      });
    }

    results.set(id1, distances);
  }

  return results;
};

/**
 * Simple agglomerative clustering based on similarity
 */
export const performClustering = (
  imageIds: string[],
  distanceMatrix: Map<string, SimilarityResult[]>,
  threshold: number = 0.7
): SimilarityCluster[] => {
  const clusters: SimilarityCluster[] = [];
  const assigned = new Set<string>();

  // Build adjacency for threshold
  const adjacency = new Map<string, Set<string>>();
  for (const id of imageIds) {
    adjacency.set(id, new Set());
  }

  for (const [id1, results] of distanceMatrix) {
    for (const result of results) {
      if (result.similarity >= threshold) {
        adjacency.get(id1)!.add(result.imageId2);
        adjacency.get(result.imageId2)!.add(id1);
      }
    }
  }

  // Find connected components
  let clusterId = 0;
  for (const id of imageIds) {
    if (!assigned.has(id)) {
      const cluster = bfsCluster(id, adjacency, assigned);
      if (cluster.length > 0) {
        const avgSimilarity = computeAverageSimilarity(
          cluster,
          distanceMatrix
        );
        clusters.push({
          id: `cluster-${clusterId++}`,
          imageIds: cluster,
          avgSimilarity,
        });
      }
    }
  }

  return clusters;
};

/**
 * BFS to find connected component (cluster)
 */
const bfsCluster = (
  startId: string,
  adjacency: Map<string, Set<string>>,
  assigned: Set<string>
): string[] => {
  const cluster: string[] = [];
  const queue: string[] = [startId];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (assigned.has(current)) continue;

    assigned.add(current);
    cluster.push(current);

    const neighbors = adjacency.get(current) || new Set();
    for (const neighbor of neighbors) {
      if (!assigned.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  return cluster;
};

/**
 * Compute average similarity within a cluster
 */
const computeAverageSimilarity = (
  imageIds: string[],
  distanceMatrix: Map<string, SimilarityResult[]>
): number => {
  if (imageIds.length < 2) return 1;

  let sumSimilarity = 0;
  let count = 0;

  for (let i = 0; i < imageIds.length; i++) {
    const results = distanceMatrix.get(imageIds[i]) || [];
    for (const result of results) {
      if (imageIds.includes(result.imageId2)) {
        sumSimilarity += result.similarity;
        count++;
      }
    }
  }

  return count > 0 ? sumSimilarity / count : 0;
};

/**
 * Find most similar pairs (potential duplicates)
 */
export const findSimilarPairs = (
  distanceMatrix: Map<string, SimilarityResult[]>,
  threshold: number = 0.85
): SimilarityResult[] => {
  const pairs: SimilarityResult[] = [];

  for (const results of distanceMatrix.values()) {
    for (const result of results) {
      if (result.similarity >= threshold) {
        pairs.push(result);
      }
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
};

/**
 * Get similar images for a specific image
 */
export const getSimilarImages = (
  imageId: string,
  distanceMatrix: Map<string, SimilarityResult[]>,
  limit: number = 10,
  threshold: number = 0.5
): SimilarityResult[] => {
  const results = distanceMatrix.get(imageId) || [];
  return results
    .filter((r) => r.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
};
