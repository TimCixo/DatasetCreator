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
  _imageIds: string[],
  distanceMatrix: Map<string, SimilarityResult[]>,
  threshold: number = 0.7
): SimilarityCluster[] => {
  const clusters: string[][] = [];
  const assignment = new Map<string, number>();
  const pairMap = buildPairMap(distanceMatrix);
  const candidatePairs = findSimilarPairs(distanceMatrix, threshold);
  const representativeThreshold = Math.min(0.995, Math.max(threshold + 0.08, threshold * 1.05));
  const clusterThreshold = Math.min(0.995, Math.max(threshold + 0.05, threshold));

  for (const { imageId1, imageId2, similarity } of candidatePairs) {
    const clusterIndex1 = assignment.get(imageId1);
    const clusterIndex2 = assignment.get(imageId2);

    if (clusterIndex1 == null && clusterIndex2 == null) {
      clusters.push([imageId1, imageId2]);
      const newIndex = clusters.length - 1;
      assignment.set(imageId1, newIndex);
      assignment.set(imageId2, newIndex);
      continue;
    }

    if (clusterIndex1 != null && clusterIndex2 != null) {
      if (clusterIndex1 === clusterIndex2) {
        continue;
      }

      const left = clusters[clusterIndex1];
      const right = clusters[clusterIndex2];
      if (!left || !right) {
        continue;
      }

      if (canMergeClusters(left, right, pairMap, clusterThreshold, representativeThreshold)) {
        const merged = [...left, ...right];
        clusters[clusterIndex1] = merged;
        clusters[clusterIndex2] = [];

        for (const id of merged) {
          assignment.set(id, clusterIndex1);
        }
      }
      continue;
    }

    const existingClusterIndex = clusterIndex1 ?? clusterIndex2!;
    const existingCluster = clusters[existingClusterIndex];
    const candidateId = clusterIndex1 == null ? imageId1 : imageId2;
    const anchorId = clusterIndex1 == null ? imageId2 : imageId1;

    if (!existingCluster) {
      continue;
    }

    if (
      canJoinCluster(
        candidateId,
        existingCluster,
        anchorId,
        pairMap,
        similarity,
        clusterThreshold,
        representativeThreshold
      )
    ) {
      existingCluster.push(candidateId);
      assignment.set(candidateId, existingClusterIndex);
    }
  }

  return clusters
    .filter((cluster) => cluster.length > 0)
    .map((cluster, index) => ({
      id: `cluster-${index}`,
      imageIds: cluster,
      avgSimilarity: computeAverageSimilarity(cluster, distanceMatrix),
    }));
};

const buildPairMap = (
  distanceMatrix: Map<string, SimilarityResult[]>
): Map<string, SimilarityResult> => {
  const pairMap = new Map<string, SimilarityResult>();

  for (const results of distanceMatrix.values()) {
    for (const result of results) {
      pairMap.set(createPairKey(result.imageId1, result.imageId2), result);
    }
  }

  return pairMap;
};

const createPairKey = (left: string, right: string): string =>
  left < right ? `${left}::${right}` : `${right}::${left}`;

const getPairSimilarity = (
  pairMap: Map<string, SimilarityResult>,
  left: string,
  right: string
): number | null => {
  const pair = pairMap.get(createPairKey(left, right));
  return pair ? pair.similarity : null;
};

const canJoinCluster = (
  candidateId: string,
  cluster: string[],
  anchorId: string,
  pairMap: Map<string, SimilarityResult>,
  anchorSimilarity: number,
  clusterThreshold: number,
  representativeThreshold: number
): boolean => {
  if (anchorSimilarity < clusterThreshold) {
    return false;
  }

  const representativeId = cluster[0] ?? anchorId;
  const representativeSimilarity = getPairSimilarity(pairMap, candidateId, representativeId);
  if (representativeSimilarity == null || representativeSimilarity < representativeThreshold) {
    return false;
  }

  let strongConnections = 0;
  let similaritySum = 0;
  let similarityCount = 0;

  for (const memberId of cluster) {
    const similarity = getPairSimilarity(pairMap, candidateId, memberId);
    if (similarity == null) {
      continue;
    }

    similaritySum += similarity;
    similarityCount++;

    if (similarity >= clusterThreshold) {
      strongConnections++;
    }
  }

  if (similarityCount === 0) {
    return false;
  }

  const averageSimilarity = similaritySum / similarityCount;
  return strongConnections >= Math.max(1, Math.ceil(cluster.length / 2)) && averageSimilarity >= clusterThreshold;
};

const canMergeClusters = (
  left: string[],
  right: string[],
  pairMap: Map<string, SimilarityResult>,
  clusterThreshold: number,
  representativeThreshold: number
): boolean => {
  const leftRepresentative = left[0];
  const rightRepresentative = right[0];
  const representativeSimilarity = getPairSimilarity(pairMap, leftRepresentative, rightRepresentative);

  if (representativeSimilarity == null || representativeSimilarity < representativeThreshold) {
    return false;
  }

  let strongConnections = 0;
  let similaritySum = 0;
  let similarityCount = 0;

  for (const leftId of left) {
    for (const rightId of right) {
      const similarity = getPairSimilarity(pairMap, leftId, rightId);
      if (similarity == null) {
        continue;
      }

      similaritySum += similarity;
      similarityCount++;

      if (similarity >= clusterThreshold) {
        strongConnections++;
      }
    }
  }

  if (similarityCount === 0) {
    return false;
  }

  const averageSimilarity = similaritySum / similarityCount;
  const minimumStrongConnections = Math.max(1, Math.ceil(Math.min(left.length, right.length) / 2));
  return strongConnections >= minimumStrongConnections && averageSimilarity >= clusterThreshold;
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
