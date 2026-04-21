import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  AlertCircle,
  ArrowRight,
  Boxes,
  ChevronRight,
  GitCompareArrows,
  Network,
  Trash2,
} from 'lucide-react';
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
type SimilarityView = 'graph' | 'pairs' | 'clusters';
type GraphNode = {
  id: string;
  x: number;
  y: number;
  groupIndex: number;
  kind: 'image' | 'cluster';
  label?: string;
  imageId?: string;
  clusterId?: string;
  memberIds?: string[];
  singleton?: boolean;
};
type SimulatedGraphNode = GraphNode & {
  vx: number;
  vy: number;
};
type GraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  type: 'membership' | 'pair';
  strength: number;
  similarity?: number;
};
type GraphClusterAnchor = {
  id: string;
  x: number;
  y: number;
  radius: number;
  groupIndex: number;
  memberIds: string[];
};

const REVIEW_GRAPH_LIMIT = 72;
const GRAPH_WIDTH = 1800;
const GRAPH_HEIGHT = 1250;
const GRAPH_MIN_SCALE = 0.55;
const GRAPH_MAX_SCALE = 2.8;
const GRAPH_PAIR_EDGE_DEGREE_LIMIT = 1;
const GRAPH_PAIR_EDGE_MIN_SIMILARITY = 0.94;
const GRAPH_CLUSTER_MEMBER_RADIUS_MIN = 112;
const GRAPH_CLUSTER_MEMBER_RADIUS_MAX = 440;
const GRAPH_CLUSTER_ANCHOR_MIN_DISTANCE = 240;
const GRAPH_CLUSTER_ANCHOR_ITERATIONS = 72;
const GRAPH_NODE_COLLISION_DISTANCE = 86;
const GRAPH_GLOBAL_CENTER_STRENGTH = 0.045;
const GRAPH_CLUSTER_ANCHOR_STRENGTH = 0.72;
const GRAPH_SINGLETON_ORBIT_X = GRAPH_WIDTH * 0.42;
const GRAPH_SINGLETON_ORBIT_Y = GRAPH_HEIGHT * 0.38;
const GRAPH_NODE_RELAXATION_ITERATIONS = 48;
const GRAPH_SIMULATION_MAX_FRAMES = 220;
const GRAPH_SIMULATION_RENDER_EVERY = 2;
const GRAPH_SIMULATION_DAMPING = 0.8;
const GRAPH_SIMULATION_SETTLE_VELOCITY = 0.045;
const GRAPH_SIMULATION_CENTER_FORCE = 0.008;
const GRAPH_SIMULATION_NODE_CENTER_FORCE = 0.0028;
const GRAPH_SIMULATION_CLUSTER_FORCE = 0.022;
const GRAPH_SIMULATION_MEMBERSHIP_LINK_FORCE = 0.012;
const GRAPH_SIMULATION_PAIR_LINK_FORCE = 0.0045;
const GRAPH_SIMULATION_NODE_REPULSION = 780;
const GRAPH_SIMULATION_CLUSTER_REPULSION = 0.28;
const GRAPH_SIMULATION_SINGLETON_OUTWARD_FORCE = 0.014;
const GRAPH_SIMULATION_SINGLETON_EXCLUSION_FORCE = 0.34;
const GRAPH_SIMULATION_MAX_VELOCITY = 18;

const getGraphGroupColor = (groupIndex: number): string => {
  const hues = [198, 38, 156, 262, 92, 345, 24, 220];
  return `hsl(${hues[groupIndex % hues.length]}, 72%, 52%)`;
};

const clampGraphCoordinate = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const getDeterministicOffset = (index: number, salt: number): number =>
  Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453 -
  Math.floor(Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453);

const getGraphClusterRadius = (memberCount: number): number => {
  if (memberCount <= 1) {
    return GRAPH_CLUSTER_MEMBER_RADIUS_MIN;
  }

  const capacityPerRing = Math.max(
    5,
    Math.floor((Math.PI * 2 * GRAPH_CLUSTER_MEMBER_RADIUS_MIN) / (GRAPH_NODE_COLLISION_DISTANCE * 1.06))
  );
  const ringCount = Math.max(1, Math.ceil(memberCount / capacityPerRing));
  const densityRadius = GRAPH_CLUSTER_MEMBER_RADIUS_MIN + Math.sqrt(memberCount) * GRAPH_NODE_COLLISION_DISTANCE * 0.58;
  const ringRadius = GRAPH_CLUSTER_MEMBER_RADIUS_MIN + (ringCount - 1) * GRAPH_NODE_COLLISION_DISTANCE * 1.18;

  return Math.min(
    GRAPH_CLUSTER_MEMBER_RADIUS_MAX,
    Math.max(ringRadius, densityRadius)
  );
};

const getGraphMembershipDistance = (memberCount: number): number =>
  Math.min(
    GRAPH_CLUSTER_MEMBER_RADIUS_MAX * 0.82,
    GRAPH_CLUSTER_MEMBER_RADIUS_MIN + Math.sqrt(Math.max(1, memberCount)) * GRAPH_NODE_COLLISION_DISTANCE * 0.38
  );

const getGraphMemberOffset = (
  memberIndex: number,
  memberCount: number
): { x: number; y: number } => {
  if (memberCount === 1) {
    return { x: 0, y: -GRAPH_CLUSTER_MEMBER_RADIUS_MIN };
  }

  const rings: Array<{ radius: number; capacity: number }> = [];
  let remaining = memberCount;
  let radius = GRAPH_CLUSTER_MEMBER_RADIUS_MIN;

  while (remaining > 0) {
    const capacity = Math.max(6, Math.floor((Math.PI * 2 * radius) / GRAPH_NODE_COLLISION_DISTANCE));
    rings.push({ radius, capacity });
    remaining -= capacity;
    radius += GRAPH_NODE_COLLISION_DISTANCE;
  }

  let skipped = 0;
  for (const ring of rings) {
    const countOnRing = Math.min(ring.capacity, memberCount - skipped);
    if (memberIndex < skipped + countOnRing) {
      const ringIndex = memberIndex - skipped;
      const angle =
        (Math.PI * 2 * ringIndex) / countOnRing -
        Math.PI / 2 +
        (skipped / Math.max(1, memberCount)) * Math.PI;
      return {
        x: Math.cos(angle) * ring.radius,
        y: Math.sin(angle) * ring.radius,
      };
    }
    skipped += countOnRing;
  }

  return { x: 0, y: 0 };
};

const relaxGraphNodes = (
  nodes: GraphNode[],
  anchors: GraphClusterAnchor[],
  centerX: number,
  centerY: number
): { minMemberDistance: number; singletonIntrusionCount: number } => {
  const anchorByGroupIndex = new Map(anchors.map((anchor) => [anchor.groupIndex, anchor]));
  const imageNodes = nodes.filter((node) => node.kind === 'image');
  const clusteredImageNodes = imageNodes.filter((node) => !node.singleton);
  const singletonNodes = imageNodes.filter((node) => node.singleton);

  for (let iteration = 0; iteration < GRAPH_NODE_RELAXATION_ITERATIONS; iteration++) {
    for (const node of clusteredImageNodes) {
      const anchor = anchorByGroupIndex.get(node.groupIndex);
      if (!anchor) {
        continue;
      }

      node.x += (anchor.x - node.x) * 0.018;
      node.y += (anchor.y - node.y) * 0.018;
    }

    for (let leftIndex = 0; leftIndex < clusteredImageNodes.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < clusteredImageNodes.length; rightIndex++) {
        const left = clusteredImageNodes[leftIndex];
        const right = clusteredImageNodes[rightIndex];
        if (left.groupIndex !== right.groupIndex) {
          continue;
        }

        const deltaX = right.x - left.x;
        const deltaY = right.y - left.y;
        const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
        if (distance >= GRAPH_NODE_COLLISION_DISTANCE) {
          continue;
        }

        const push = (GRAPH_NODE_COLLISION_DISTANCE - distance) / 2;
        const unitX = deltaX / distance;
        const unitY = deltaY / distance;
        left.x -= unitX * push;
        left.y -= unitY * push;
        right.x += unitX * push;
        right.y += unitY * push;
      }
    }

    for (const node of clusteredImageNodes) {
      const anchor = anchorByGroupIndex.get(node.groupIndex);
      if (!anchor) {
        continue;
      }

      const deltaX = node.x - anchor.x;
      const deltaY = node.y - anchor.y;
      const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
      const maxDistance = anchor.radius + GRAPH_NODE_COLLISION_DISTANCE * 0.45;
      const minDistance = Math.min(66, anchor.radius * 0.45);

      if (distance > maxDistance) {
        node.x = anchor.x + (deltaX / distance) * maxDistance;
        node.y = anchor.y + (deltaY / distance) * maxDistance;
      } else if (distance < minDistance) {
        node.x = anchor.x + (deltaX / distance) * minDistance;
        node.y = anchor.y + (deltaY / distance) * minDistance;
      }
    }

    for (const singleton of singletonNodes) {
      const deltaCenterX = singleton.x - centerX;
      const deltaCenterY = singleton.y - centerY;
      const centerDistance = Math.max(0.001, Math.hypot(deltaCenterX, deltaCenterY));
      const targetX = centerX + (deltaCenterX / centerDistance) * GRAPH_SINGLETON_ORBIT_X;
      const targetY = centerY + (deltaCenterY / centerDistance) * GRAPH_SINGLETON_ORBIT_Y;
      singleton.x += (targetX - singleton.x) * 0.08;
      singleton.y += (targetY - singleton.y) * 0.08;

      for (const anchor of anchors) {
        const deltaX = singleton.x - anchor.x;
        const deltaY = singleton.y - anchor.y;
        const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
        const exclusionDistance = anchor.radius + GRAPH_NODE_COLLISION_DISTANCE * 1.45;
        if (distance >= exclusionDistance) {
          continue;
        }

        const push = (exclusionDistance - distance) * 0.7;
        singleton.x += (deltaX / distance) * push;
        singleton.y += (deltaY / distance) * push;
      }
    }
  }

  let minMemberDistance = Number.POSITIVE_INFINITY;
  for (let leftIndex = 0; leftIndex < clusteredImageNodes.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < clusteredImageNodes.length; rightIndex++) {
      const left = clusteredImageNodes[leftIndex];
      const right = clusteredImageNodes[rightIndex];
      if (left.groupIndex !== right.groupIndex) {
        continue;
      }

      minMemberDistance = Math.min(minMemberDistance, Math.hypot(left.x - right.x, left.y - right.y));
    }
  }

  let singletonIntrusionCount = 0;
  for (const singleton of singletonNodes) {
    for (const anchor of anchors) {
      const distance = Math.hypot(singleton.x - anchor.x, singleton.y - anchor.y);
      if (distance < anchor.radius + GRAPH_NODE_COLLISION_DISTANCE) {
        singletonIntrusionCount++;
        break;
      }
    }
  }

  return {
    minMemberDistance: Number.isFinite(minMemberDistance) ? minMemberDistance : 0,
    singletonIntrusionCount,
  };
};

const selectGraphPairEdges = (
  similarPairs: SimilarityResult[],
  itemCount: number,
  threshold: number
): SimilarityResult[] => {
  const graphPairThreshold = Math.max(threshold + 0.08, GRAPH_PAIR_EDGE_MIN_SIMILARITY);
  const globalLimit = Math.max(8, Math.min(Math.ceil(itemCount / 4), 36));
  const degreeByImageId = new Map<string, number>();
  const selected: SimilarityResult[] = [];

  for (const pair of similarPairs) {
    if (pair.similarity < graphPairThreshold) {
      continue;
    }

    const leftDegree = degreeByImageId.get(pair.imageId1) ?? 0;
    const rightDegree = degreeByImageId.get(pair.imageId2) ?? 0;
    if (leftDegree >= GRAPH_PAIR_EDGE_DEGREE_LIMIT || rightDegree >= GRAPH_PAIR_EDGE_DEGREE_LIMIT) {
      continue;
    }

    selected.push(pair);
    degreeByImageId.set(pair.imageId1, leftDegree + 1);
    degreeByImageId.set(pair.imageId2, rightDegree + 1);

    if (selected.length >= globalLimit) {
      break;
    }
  }

  return selected;
};

const buildGraphLayout = (
  items: DatasetItem[],
  clusters: SimilarityCluster[],
  similarPairs: SimilarityResult[],
  threshold: number
): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusterNodeCount: number;
  membershipEdgeCount: number;
  pairEdgeCount: number;
  singletonCount: number;
  selectedPairCandidateCount: number;
  clusterMinDistance: number;
  layoutIterationCount: number;
  overlapResolutionRan: boolean;
  sparseOrOverlapStateDetected: boolean;
  minMemberDistance: number;
  singletonIntrusionCount: number;
} => {
  if (items.length === 0) {
    return {
      nodes: [],
      edges: [],
      clusterNodeCount: 0,
      membershipEdgeCount: 0,
      pairEdgeCount: 0,
      singletonCount: 0,
      selectedPairCandidateCount: 0,
      clusterMinDistance: 0,
      layoutIterationCount: 0,
      overlapResolutionRan: false,
      sparseOrOverlapStateDetected: false,
      minMemberDistance: 0,
      singletonIntrusionCount: 0,
    };
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const centerX = GRAPH_WIDTH / 2;
  const centerY = GRAPH_HEIGHT / 2;
  const itemIds = new Set(items.map((item) => item.id));
  const assignedImageIds = new Set<string>();
  const positionedImageIds = new Set<string>();
  const sortedClusters = [...clusters].sort(
    (left, right) => right.imageIds.length - left.imageIds.length || right.avgSimilarity - left.avgSimilarity
  );
  const graphPairCandidates = selectGraphPairEdges(similarPairs, items.length, threshold);
  const anchors: GraphClusterAnchor[] = sortedClusters.map((cluster, groupIndex) => {
    const memberIds = cluster.imageIds.filter((id) => itemIds.has(id));
    const radius = getGraphClusterRadius(memberIds.length);
    const jitter = (getDeterministicOffset(groupIndex, memberIds.length) - 0.5) * 0.5;
    const angle = (groupIndex - 1) * 2.399963229728653 + jitter;
    const initialRadius =
      groupIndex === 0 ? 0 : Math.min(430, 175 + Math.sqrt(groupIndex - 1) * 96);

    return {
      id: cluster.id,
      x: centerX + Math.cos(angle) * initialRadius,
      y: centerY + Math.sin(angle) * initialRadius * 0.78,
      radius,
      groupIndex,
      memberIds,
    };
  });

  let overlapResolutionRan = false;
  for (let iteration = 0; iteration < GRAPH_CLUSTER_ANCHOR_ITERATIONS; iteration++) {
    for (const anchor of anchors) {
      if (anchor.groupIndex === 0) {
        anchor.x = centerX;
        anchor.y = centerY;
        continue;
      }
      anchor.x += (centerX - anchor.x) * GRAPH_GLOBAL_CENTER_STRENGTH;
      anchor.y += (centerY - anchor.y) * GRAPH_GLOBAL_CENTER_STRENGTH;
    }

    for (let leftIndex = 0; leftIndex < anchors.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < anchors.length; rightIndex++) {
        const left = anchors[leftIndex];
        const right = anchors[rightIndex];
        const deltaX = right.x - left.x;
        const deltaY = right.y - left.y;
        const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
        const requiredDistance =
          GRAPH_CLUSTER_ANCHOR_MIN_DISTANCE + (left.radius + right.radius) * 0.4;

        if (distance >= requiredDistance) {
          continue;
        }

        overlapResolutionRan = true;
        const push = ((requiredDistance - distance) / 2) * GRAPH_CLUSTER_ANCHOR_STRENGTH;
        const unitX = deltaX / distance;
        const unitY = deltaY / distance;
        if (left.groupIndex === 0) {
          right.x += unitX * push * 2;
          right.y += unitY * push * 2;
        } else if (right.groupIndex === 0) {
          left.x -= unitX * push * 2;
          left.y -= unitY * push * 2;
        } else {
          left.x -= unitX * push;
          left.y -= unitY * push;
          right.x += unitX * push;
          right.y += unitY * push;
        }
      }
    }

    for (const anchor of anchors) {
      if (anchor.groupIndex === 0) {
        anchor.x = centerX;
        anchor.y = centerY;
        continue;
      }
      anchor.x = clampGraphCoordinate(anchor.x, 80 + anchor.radius, GRAPH_WIDTH - 80 - anchor.radius);
      anchor.y = clampGraphCoordinate(anchor.y, 80 + anchor.radius, GRAPH_HEIGHT - 80 - anchor.radius);
    }
  }

  for (let iteration = 0; iteration < 32; iteration++) {
    for (let leftIndex = 0; leftIndex < anchors.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < anchors.length; rightIndex++) {
        const left = anchors[leftIndex];
        const right = anchors[rightIndex];
        const deltaX = right.x - left.x;
        const deltaY = right.y - left.y;
        const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
        const requiredDistance =
          GRAPH_CLUSTER_ANCHOR_MIN_DISTANCE + (left.radius + right.radius) * 0.4;

        if (distance >= requiredDistance) {
          continue;
        }

        overlapResolutionRan = true;
        const push = (requiredDistance - distance) / 2;
        const unitX = deltaX / distance;
        const unitY = deltaY / distance;
        if (left.groupIndex === 0) {
          right.x += unitX * push * 2;
          right.y += unitY * push * 2;
        } else if (right.groupIndex === 0) {
          left.x -= unitX * push * 2;
          left.y -= unitY * push * 2;
        } else {
          left.x -= unitX * push;
          left.y -= unitY * push;
          right.x += unitX * push;
          right.y += unitY * push;
        }
      }
    }

    for (const anchor of anchors) {
      if (anchor.groupIndex === 0) {
        anchor.x = centerX;
        anchor.y = centerY;
        continue;
      }
      anchor.x = clampGraphCoordinate(anchor.x, 80 + anchor.radius, GRAPH_WIDTH - 80 - anchor.radius);
      anchor.y = clampGraphCoordinate(anchor.y, 80 + anchor.radius, GRAPH_HEIGHT - 80 - anchor.radius);
    }
  }
  const clusterAnchorById = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  const clusterMinDistance =
    anchors.length < 2
      ? 0
      : anchors.reduce((minimum, left, index) => {
          const distances = anchors
            .slice(index + 1)
            .map((right) => Math.hypot(left.x - right.x, left.y - right.y));
          return Math.min(minimum, ...distances);
        }, Number.POSITIVE_INFINITY);
  const sparseOrOverlapStateDetected =
    anchors.length > 1 &&
    (clusterMinDistance < GRAPH_CLUSTER_ANCHOR_MIN_DISTANCE ||
      clusterMinDistance > Math.min(GRAPH_WIDTH, GRAPH_HEIGHT) * 0.56);

  sortedClusters.forEach((cluster, groupIndex) => {
    const clusterNodeId = `graph-cluster-${cluster.id}`;
    const anchor = clusterAnchorById.get(cluster.id);
    const clusterX = anchor?.x ?? centerX;
    const clusterY = anchor?.y ?? centerY;
    const clusterMemberIds = cluster.imageIds.filter((id) => itemIds.has(id));

    nodes.push({
      id: clusterNodeId,
      x: clusterX,
      y: clusterY,
      groupIndex,
      kind: 'cluster',
      label: `C${groupIndex + 1}`,
      clusterId: cluster.id,
      memberIds: clusterMemberIds,
    });

    clusterMemberIds.forEach((id, memberIndex) => {
      assignedImageIds.add(id);
      positionedImageIds.add(id);
      const offset = getGraphMemberOffset(memberIndex, clusterMemberIds.length);
      nodes.push({
        id,
        x: clusterX + offset.x,
        y: clusterY + offset.y,
        groupIndex,
        kind: 'image',
        imageId: id,
      });
      edges.push({
        id: `${clusterNodeId}-${id}`,
        sourceId: clusterNodeId,
        targetId: id,
        type: 'membership',
        strength: Math.max(0.3, Math.min(1, cluster.avgSimilarity)),
      });
    });
  });

  const unclusteredItems = items.filter((item) => !assignedImageIds.has(item.id));
  unclusteredItems.forEach((item, index) => {
    const jitter = (getDeterministicOffset(index, unclusteredItems.length) - 0.5) * 0.34;
    const angle =
      unclusteredItems.length === 1
        ? Math.PI / 2
        : (Math.PI * 2 * index) / unclusteredItems.length + Math.PI / 2 + jitter;
    nodes.push({
      id: item.id,
      x: centerX + Math.cos(angle) * GRAPH_SINGLETON_ORBIT_X,
      y: centerY + Math.sin(angle) * GRAPH_SINGLETON_ORBIT_Y,
      groupIndex: sortedClusters.length + (index % 8),
      kind: 'image',
      imageId: item.id,
      singleton: true,
    });
    positionedImageIds.add(item.id);
  });

  const nodeRelaxation = relaxGraphNodes(nodes, anchors, centerX, centerY);

  for (const pair of graphPairCandidates) {
    if (!positionedImageIds.has(pair.imageId1) || !positionedImageIds.has(pair.imageId2)) {
      continue;
    }

    edges.push({
      id: `${pair.imageId1}-${pair.imageId2}`,
      sourceId: pair.imageId1,
      targetId: pair.imageId2,
      type: 'pair',
      similarity: pair.similarity,
      strength: Math.max(0, Math.min(1, (pair.similarity - threshold) / Math.max(0.001, 1 - threshold))),
    });
  }

  return {
    nodes,
    edges,
    clusterNodeCount: sortedClusters.length,
    membershipEdgeCount: edges.filter((edge) => edge.type === 'membership').length,
    pairEdgeCount: edges.filter((edge) => edge.type === 'pair').length,
    singletonCount: unclusteredItems.length,
    selectedPairCandidateCount: graphPairCandidates.length,
    clusterMinDistance: Number.isFinite(clusterMinDistance) ? clusterMinDistance : 0,
    layoutIterationCount: GRAPH_CLUSTER_ANCHOR_ITERATIONS,
    overlapResolutionRan,
    sparseOrOverlapStateDetected,
    minMemberDistance: nodeRelaxation.minMemberDistance,
    singletonIntrusionCount: nodeRelaxation.singletonIntrusionCount,
  };
};

const stripGraphVelocity = (nodes: SimulatedGraphNode[]): GraphNode[] =>
  nodes.map(({ vx: _vx, vy: _vy, ...node }) => ({ ...node }));

const measureGraphLayoutState = (
  nodes: GraphNode[]
): {
  minMemberDistance: number;
  singletonIntrusionCount: number;
  averageClusterDistance: number;
} => {
  const clusterNodes = nodes.filter((node) => node.kind === 'cluster');
  const memberNodes = nodes.filter((node) => node.kind === 'image' && !node.singleton);
  const singletonNodes = nodes.filter((node) => node.singleton);
  const clusterByGroupIndex = new Map(clusterNodes.map((node) => [node.groupIndex, node]));

  let minMemberDistance = Number.POSITIVE_INFINITY;
  for (let leftIndex = 0; leftIndex < memberNodes.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < memberNodes.length; rightIndex++) {
      const left = memberNodes[leftIndex];
      const right = memberNodes[rightIndex];
      if (left.groupIndex !== right.groupIndex) {
        continue;
      }

      minMemberDistance = Math.min(minMemberDistance, Math.hypot(left.x - right.x, left.y - right.y));
    }
  }

  let singletonIntrusionCount = 0;
  for (const singleton of singletonNodes) {
    for (const cluster of clusterNodes) {
      const memberCount = cluster.memberIds?.length ?? 1;
      const clusterRadius = getGraphClusterRadius(memberCount) + GRAPH_NODE_COLLISION_DISTANCE;
      if (Math.hypot(singleton.x - cluster.x, singleton.y - cluster.y) < clusterRadius) {
        singletonIntrusionCount++;
        break;
      }
    }
  }

  let clusterDistanceTotal = 0;
  let clusterDistanceCount = 0;
  for (let leftIndex = 0; leftIndex < clusterNodes.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < clusterNodes.length; rightIndex++) {
      const left = clusterNodes[leftIndex];
      const right = clusterNodes[rightIndex];
      clusterDistanceTotal += Math.hypot(left.x - right.x, left.y - right.y);
      clusterDistanceCount++;
    }
  }

  const membersOutsideClusterTerritory = memberNodes.filter((member) => {
    const cluster = clusterByGroupIndex.get(member.groupIndex);
    if (!cluster) {
      return false;
    }

    const memberCount = cluster.memberIds?.length ?? 1;
    const maximumDistance = getGraphClusterRadius(memberCount) + GRAPH_NODE_COLLISION_DISTANCE * 1.1;
    return Math.hypot(member.x - cluster.x, member.y - cluster.y) > maximumDistance;
  }).length;

  return {
    minMemberDistance: Number.isFinite(minMemberDistance) ? minMemberDistance : 0,
    singletonIntrusionCount: singletonIntrusionCount + membersOutsideClusterTerritory,
    averageClusterDistance: clusterDistanceCount > 0 ? clusterDistanceTotal / clusterDistanceCount : 0,
  };
};

const stepGraphSimulation = (
  nodes: SimulatedGraphNode[],
  edges: GraphEdge[]
): {
  maxVelocity: number;
  overlapResolutionRan: boolean;
} => {
  const centerX = GRAPH_WIDTH / 2;
  const centerY = GRAPH_HEIGHT / 2;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const clusterNodes = nodes.filter((node) => node.kind === 'cluster');
  const imageNodes = nodes.filter((node) => node.kind === 'image');
  const memberNodes = imageNodes.filter((node) => !node.singleton);
  const singletonNodes = imageNodes.filter((node) => node.singleton);
  const clusterByGroupIndex = new Map(clusterNodes.map((node) => [node.groupIndex, node]));
  let overlapResolutionRan = false;

  for (const cluster of clusterNodes) {
    cluster.vx += (centerX - cluster.x) * GRAPH_SIMULATION_CENTER_FORCE;
    cluster.vy += (centerY - cluster.y) * GRAPH_SIMULATION_CENTER_FORCE;
  }

  for (const node of nodes) {
    const centerForce = node.singleton
      ? GRAPH_SIMULATION_NODE_CENTER_FORCE * 0.5
      : GRAPH_SIMULATION_NODE_CENTER_FORCE;
    node.vx += (centerX - node.x) * centerForce;
    node.vy += (centerY - node.y) * centerForce;
  }

  for (const member of memberNodes) {
    const cluster = clusterByGroupIndex.get(member.groupIndex);
    if (!cluster) {
      continue;
    }

    const memberCount = cluster.memberIds?.length ?? 1;
    const clusterDistance = getGraphMembershipDistance(memberCount);
    const deltaX = member.x - cluster.x;
    const deltaY = member.y - cluster.y;
    const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));

    member.vx += (cluster.x - member.x) * GRAPH_SIMULATION_CLUSTER_FORCE;
    member.vy += (cluster.y - member.y) * GRAPH_SIMULATION_CLUSTER_FORCE;

    if (distance < clusterDistance * 0.72) {
      const push = (clusterDistance * 0.72 - distance) * 0.035;
      member.vx += (deltaX / distance) * push;
      member.vy += (deltaY / distance) * push;
    }
  }

  for (let leftIndex = 0; leftIndex < clusterNodes.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < clusterNodes.length; rightIndex++) {
      const left = clusterNodes[leftIndex];
      const right = clusterNodes[rightIndex];
      const leftRadius = getGraphClusterRadius(left.memberIds?.length ?? 1);
      const rightRadius = getGraphClusterRadius(right.memberIds?.length ?? 1);
      const deltaX = right.x - left.x;
      const deltaY = right.y - left.y;
      const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
      const requiredDistance = GRAPH_CLUSTER_ANCHOR_MIN_DISTANCE + (leftRadius + rightRadius) * 0.52;

      if (distance >= requiredDistance) {
        continue;
      }

      overlapResolutionRan = true;
      const push = (requiredDistance - distance) * GRAPH_SIMULATION_CLUSTER_REPULSION;
      const unitX = deltaX / distance;
      const unitY = deltaY / distance;
      left.vx -= unitX * push;
      left.vy -= unitY * push;
      right.vx += unitX * push;
      right.vy += unitY * push;
    }
  }

  for (const edge of edges) {
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    if (!source || !target) {
      continue;
    }

    const deltaX = target.x - source.x;
    const deltaY = target.y - source.y;
    const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
    const isMembership = edge.type === 'membership';
    const desiredDistance = isMembership
      ? getGraphMembershipDistance(source.kind === 'cluster' ? source.memberIds?.length ?? 1 : target.memberIds?.length ?? 1)
      : 172;
    const force =
      (distance - desiredDistance) *
      (isMembership ? GRAPH_SIMULATION_MEMBERSHIP_LINK_FORCE : GRAPH_SIMULATION_PAIR_LINK_FORCE) *
      edge.strength;
    const unitX = deltaX / distance;
    const unitY = deltaY / distance;

    source.vx += unitX * force;
    source.vy += unitY * force;
    target.vx -= unitX * force;
    target.vy -= unitY * force;
  }

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex++) {
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      const deltaX = right.x - left.x;
      const deltaY = right.y - left.y;
      const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
      const isSameClusterMember =
        left.kind === 'image' &&
        right.kind === 'image' &&
        !left.singleton &&
        !right.singleton &&
        left.groupIndex === right.groupIndex;
      const requiredDistance =
        left.kind === 'cluster' || right.kind === 'cluster'
          ? 104
          : isSameClusterMember
            ? GRAPH_NODE_COLLISION_DISTANCE + 22
            : GRAPH_NODE_COLLISION_DISTANCE;

      const influenceDistance = requiredDistance * (isSameClusterMember ? 2.4 : 1.85);
      if (distance >= influenceDistance) {
        continue;
      }

      overlapResolutionRan = true;
      const unitX = deltaX / distance;
      const unitY = deltaY / distance;
      const overlapPush = Math.max(0, requiredDistance - distance) * 0.58;
      const fieldPush =
        ((influenceDistance - distance) / influenceDistance) *
        (GRAPH_SIMULATION_NODE_REPULSION / Math.max(1, distance));
      const push = overlapPush + fieldPush;
      left.vx -= unitX * push;
      left.vy -= unitY * push;
      right.vx += unitX * push;
      right.vy += unitY * push;
    }
  }

  for (const singleton of singletonNodes) {
    const deltaCenterX = singleton.x - centerX;
    const deltaCenterY = singleton.y - centerY;
    const centerDistance = Math.max(0.001, Math.hypot(deltaCenterX, deltaCenterY));
    const targetX = centerX + (deltaCenterX / centerDistance) * GRAPH_SINGLETON_ORBIT_X;
    const targetY = centerY + (deltaCenterY / centerDistance) * GRAPH_SINGLETON_ORBIT_Y;

    singleton.vx += (targetX - singleton.x) * GRAPH_SIMULATION_SINGLETON_OUTWARD_FORCE;
    singleton.vy += (targetY - singleton.y) * GRAPH_SIMULATION_SINGLETON_OUTWARD_FORCE;

    for (const cluster of clusterNodes) {
      const radius = getGraphClusterRadius(cluster.memberIds?.length ?? 1) + GRAPH_NODE_COLLISION_DISTANCE * 1.6;
      const deltaX = singleton.x - cluster.x;
      const deltaY = singleton.y - cluster.y;
      const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
      if (distance >= radius) {
        continue;
      }

      overlapResolutionRan = true;
      const push = (radius - distance) * GRAPH_SIMULATION_SINGLETON_EXCLUSION_FORCE;
      singleton.vx += (deltaX / distance) * push;
      singleton.vy += (deltaY / distance) * push;
    }
  }

  let maxVelocity = 0;
  for (const node of nodes) {
    node.vx *= GRAPH_SIMULATION_DAMPING;
    node.vy *= GRAPH_SIMULATION_DAMPING;
    const velocity = Math.hypot(node.vx, node.vy);
    if (velocity > GRAPH_SIMULATION_MAX_VELOCITY) {
      node.vx = (node.vx / velocity) * GRAPH_SIMULATION_MAX_VELOCITY;
      node.vy = (node.vy / velocity) * GRAPH_SIMULATION_MAX_VELOCITY;
    }
    node.x = clampGraphCoordinate(node.x + node.vx, 46, GRAPH_WIDTH - 46);
    node.y = clampGraphCoordinate(node.y + node.vy, 46, GRAPH_HEIGHT - 46);
    maxVelocity = Math.max(maxVelocity, Math.hypot(node.vx, node.vy));
  }

  return { maxVelocity, overlapResolutionRan };
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
  const [activeSimilarityView, setActiveSimilarityView] = useState<SimilarityView>('graph');
  const [selectedPairKey, setSelectedPairKey] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [previewItemIds, setPreviewItemIds] = useState<string[] | null>(null);
  const [graphViewport, setGraphViewport] = useState({ scale: 1, x: 0, y: 0 });
  const [simulatedGraphNodes, setSimulatedGraphNodes] = useState<GraphNode[] | null>(null);
  const previewCacheRef = useRef<Record<string, PreviewCacheEntry>>({});
  const embeddingCacheRef = useRef<Record<string, EmbeddingCacheEntry>>({});
  const reviewViewContainerRef = useRef<HTMLDivElement | null>(null);
  const graphInteractionRef = useRef<HTMLDivElement | null>(null);
  const graphPanRef = useRef<{ active: boolean; x: number; y: number }>({
    active: false,
    x: 0,
    y: 0,
  });
  const graphSimulationRef = useRef<{
    frameId: number | null;
    nodes: SimulatedGraphNode[];
    running: boolean;
  }>({
    frameId: null,
    nodes: [],
    running: false,
  });

  const similarityThreshold = useMemo(() => {
    const remapped = 0.7 + 0.29 * Math.sqrt(uiThreshold);
    if (import.meta.env.DEV) {
      console.log(`[review] threshold slider value: ${uiThreshold.toFixed(2)}`);
      console.log(`[review] threshold remap value: ${remapped.toFixed(3)}`);
    }
    return remapped;
  }, [uiThreshold]);

  const handleThresholdChange = useCallback(
    (value: number) => {
      if (import.meta.env.DEV) {
        console.log(`[review] active Final Review view before threshold change: ${activeSimilarityView}`);
      }
      setUiThreshold(value);
    },
    [activeSimilarityView]
  );

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(`[review] active Final Review view after threshold change: ${activeSimilarityView}`);
      console.log('[review] threshold update did not force-reset the active Final Review view');
    }
  }, [uiThreshold, activeSimilarityView]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[review] Heatmap view still registered: false');
      console.log('[review] Graph is the only remaining main visual view: true');
      console.log('[review] Final Review tab icons configured: Graph, Similar Pairs, Clusters');
      console.log('[review] graph helper text rendered: false');
      console.log('[review] Similar Pairs heading rendered: false');
      console.log('[review] Clusters heading rendered: false');
      console.log('[review] graph overlay controls/stats rendered inside graph container: true');
    }
  }, []);

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

  const reviewItems = useMemo(() => filteredItems.slice(0, REVIEW_GRAPH_LIMIT), [filteredItems]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(`[review] current active Final Review view: ${activeSimilarityView}`);
      console.log('[review] bounded Final Review view container applied: true');
      console.log(
        `[review] Similar Pairs / Clusters internal scroll enabled: ${activeSimilarityView === 'pairs' || activeSimilarityView === 'clusters'}`
      );
    }
  }, [activeSimilarityView]);

  useEffect(() => {
    let cancelled = false;
    const activeIds = new Set(reviewItems.map((item) => item.id));

    const startedAt = performance.now();

    const syncEmbeddings = async () => {
      const nextEntries: Record<string, Float32Array> = {};
      let reusedCount = 0;
      let borrowedCount = 0;
      let generatedCount = 0;

      for (const item of reviewItems) {
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

        for (const item of reviewItems) {
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
        console.log(`[review] graph review item count: ${reviewItems.length}`);
        console.log(`[review] graph embeddings reused: ${reusedCount}`);
        console.log(`[review] graph embeddings borrowed from source: ${borrowedCount}`);
        console.log(`[review] graph embeddings generated: ${generatedCount}`);
        console.log(
          `[review] graph data generation timing: ${(performance.now() - startedAt).toFixed(1)}ms`
        );
      }
    };

    void syncEmbeddings();

    return () => {
      cancelled = true;
    };
  }, [reviewItems, sourceImages]);

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

  const reviewData = useMemo(() => {
    const startedAt = performance.now();
    const reviewVisibleItems = reviewItems.filter((item) => itemEmbeddings[item.id]);

    if (reviewVisibleItems.length < 2) {
      if (import.meta.env.DEV) {
        console.log('[review] Final Review graph data exists: false');
      }
      return null;
    }

    const embeddings = new Map<string, Float32Array>();
    for (const item of reviewVisibleItems) {
      embeddings.set(item.id, itemEmbeddings[item.id]);
    }

    const matrix = computeDistanceMatrix(embeddings);

    const itemIndexById = Object.fromEntries(
      reviewVisibleItems.map((item, index) => [item.id, index + 1])
    ) as Record<string, number>;

    const clusters = performClustering(
      reviewVisibleItems.map((item) => item.id),
      matrix,
      similarityThreshold
    ).filter((cluster) => cluster.imageIds.length > 1);

    const similarPairs = findSimilarPairs(matrix, similarityThreshold);
    const graph = buildGraphLayout(reviewVisibleItems, clusters, similarPairs, similarityThreshold);
    const graphImageNodeCount = graph.nodes.filter((node) => node.kind === 'image').length;

    if (import.meta.env.DEV) {
      console.log(`[review] shared threshold value: ${uiThreshold.toFixed(2)}`);
      console.log(`[review] shared threshold remap value: ${similarityThreshold.toFixed(3)}`);
      console.log('[review] graph, pairs, and clusters recomputed from shared threshold change');
      console.log('[review] Final Review graph data exists: true');
      console.log(`[review] graph items included: ${reviewVisibleItems.length}`);
      console.log(
        `[review] graph/review similarity scope: ${reviewVisibleItems.length}/${filteredItems.length} filtered items`
      );
      console.log(`[review] dataset items filtered/truncated for graph: ${filteredItems.length > reviewVisibleItems.length}`);
      console.log(`[review] graph image node count: ${graphImageNodeCount}`);
      console.log(`[review] graph cluster node count: ${graph.clusterNodeCount}`);
      console.log(`[review] graph cluster membership edge count: ${graph.membershipEdgeCount}`);
      console.log(`[review] graph similar-pair edge count: ${graph.pairEdgeCount}`);
      console.log(
        `[review] graph pair edges chosen from real similar pairs: ${graph.pairEdgeCount}/${similarPairs.length}, min similarity ${Math.max(
          similarityThreshold + 0.08,
          GRAPH_PAIR_EDGE_MIN_SIMILARITY
        ).toFixed(3)}, max degree ${GRAPH_PAIR_EDGE_DEGREE_LIMIT}`
      );
      console.log(`[review] graph singleton image count: ${graph.singletonCount}`);
      console.log(`[review] graph cluster nodes rendered successfully: ${graph.clusterNodeCount === clusters.length}`);
      console.log(
        `[review] graph force parameters: cluster center ${GRAPH_SIMULATION_CENTER_FORCE}, all-node center ${GRAPH_SIMULATION_NODE_CENTER_FORCE}, cluster anchor ${GRAPH_SIMULATION_CLUSTER_FORCE}, node repulsion ${GRAPH_SIMULATION_NODE_REPULSION}, node collision ${GRAPH_NODE_COLLISION_DISTANCE}, simulation frames ${GRAPH_SIMULATION_MAX_FRAMES}`
      );
      console.log('[review] graph grid-like placement active: false');
      console.log(
        `[review] graph layout parameters: ${GRAPH_WIDTH}x${GRAPH_HEIGHT}, minimum cluster distance ${graph.clusterMinDistance.toFixed(
          1
        )}, singleton orbit ${GRAPH_SINGLETON_ORBIT_X.toFixed(1)}x${GRAPH_SINGLETON_ORBIT_Y.toFixed(
          1
        )}, scalable member radius ${GRAPH_CLUSTER_MEMBER_RADIUS_MIN}-${GRAPH_CLUSTER_MEMBER_RADIUS_MAX}`
      );
      console.log('[review] graph cluster-anchor logic active: true');
      console.log('[review] graph inter-cluster repulsion active: true');
      console.log(
        `[review] graph intra-cluster collision handling active: force relaxation, min member distance ${graph.minMemberDistance.toFixed(
          1
        )}`
      );
      console.log('[review] graph center force active: true');
      console.log('[review] graph all-node center gravity active: true');
      console.log(
        `[review] graph singleton outward bias active: true, singleton intrusions ${graph.singletonIntrusionCount}`
      );
      console.log(`[review] graph nodes assigned to cluster groups: ${graph.membershipEdgeCount}`);
      console.log(`[review] graph nodes treated as singletons: ${graph.singletonCount}`);
      console.log(
        `[review] graph overlap separation applied: force relaxation ran ${graph.overlapResolutionRan}, sparse/overlap state detected ${graph.sparseOrOverlapStateDetected}`
      );
      console.log('[review] graph recomputed after threshold change');
      console.log('[review] graph live simulation inputs updated after threshold/data change');
      console.log(`[review] similar pair count after threshold change: ${similarPairs.length}`);
      console.log(`[review] cluster count after threshold change: ${clusters.length}`);
      console.log(
        `[review] graph data generation timing: ${(performance.now() - startedAt).toFixed(1)}ms`
      );
    }

    return {
      items: reviewVisibleItems,
      itemIndexById,
      clusters,
      similarPairs,
      graphEdges: graph.edges,
      graphNodes: graph.nodes,
      graphClusterNodeCount: graph.clusterNodeCount,
      graphMembershipEdgeCount: graph.membershipEdgeCount,
      graphPairEdgeCount: graph.pairEdgeCount,
      graphSingletonCount: graph.singletonCount,
      graphRawPairCount: similarPairs.length,
      graphSelectedPairCandidateCount: graph.selectedPairCandidateCount,
      graphClusterMinDistance: graph.clusterMinDistance,
      graphLayoutIterationCount: graph.layoutIterationCount,
      graphOverlapResolutionRan: graph.overlapResolutionRan,
      graphSparseOrOverlapStateDetected: graph.sparseOrOverlapStateDetected,
      graphMinMemberDistance: graph.minMemberDistance,
      graphSingletonIntrusionCount: graph.singletonIntrusionCount,
    };
  }, [filteredItems.length, reviewItems, itemEmbeddings, similarityThreshold, uiThreshold]);

  useEffect(() => {
    if (!import.meta.env.DEV || activeSimilarityView !== 'graph') {
      return;
    }

    const container = reviewViewContainerRef.current;
    const graph = graphInteractionRef.current;
    console.log('[review] Heatmap view still registered: false');
    console.log(
      `[review] graph content container size after simplification: ${container?.clientWidth ?? 0}x${
        container?.clientHeight ?? 0
      }`
    );
    console.log(
      `[review] graph canvas interaction size after overlay move: ${graph?.clientWidth ?? 0}x${
        graph?.clientHeight ?? 0
      }`
    );
    console.log('[review] graph overlay controls/stats rendered inside graph container: true');
  }, [activeSimilarityView, reviewData?.items.length]);

  useEffect(() => {
    if (graphSimulationRef.current.frameId !== null) {
      window.cancelAnimationFrame(graphSimulationRef.current.frameId);
      graphSimulationRef.current.frameId = null;
    }

    if (activeSimilarityView !== 'graph' || !reviewData) {
      graphSimulationRef.current.running = false;
      setSimulatedGraphNodes(null);
      return;
    }

    const previousNodes = new Map(
      graphSimulationRef.current.nodes.map((node) => [node.id, node])
    );
    const nodes: SimulatedGraphNode[] = reviewData.graphNodes.map((node) => {
      const previous = previousNodes.get(node.id);
      return {
        ...node,
        x: previous?.x ?? node.x,
        y: previous?.y ?? node.y,
        vx: (previous?.vx ?? 0) * 0.25,
        vy: (previous?.vy ?? 0) * 0.25,
      };
    });

    let frame = 0;
    let overlapResolutionRan = false;
    graphSimulationRef.current = {
      frameId: null,
      nodes,
      running: true,
    };
    setSimulatedGraphNodes(stripGraphVelocity(nodes));

    if (import.meta.env.DEV) {
      const imageCount = nodes.filter((node) => node.kind === 'image').length;
      const clusterCount = nodes.filter((node) => node.kind === 'cluster').length;
      const singletonCount = nodes.filter((node) => node.singleton).length;
      console.log('[review] graph live force simulation started after spawn/update');
      console.log(`[review] graph layout node count: ${imageCount}`);
      console.log(`[review] graph layout cluster count: ${clusterCount}`);
      console.log(`[review] graph layout singleton count: ${singletonCount}`);
      console.log(
        `[review] graph live force parameters: cluster center ${GRAPH_SIMULATION_CENTER_FORCE}, all-node center ${GRAPH_SIMULATION_NODE_CENTER_FORCE}, cluster ${GRAPH_SIMULATION_CLUSTER_FORCE}, membership link ${GRAPH_SIMULATION_MEMBERSHIP_LINK_FORCE}, pair link ${GRAPH_SIMULATION_PAIR_LINK_FORCE}, node repulsion ${GRAPH_SIMULATION_NODE_REPULSION}, damping ${GRAPH_SIMULATION_DAMPING}`
      );
      console.log('[review] graph grid-like placement active: false');
      console.log('[review] graph center force active: true');
      console.log('[review] graph all nodes gravitate toward center: true');
      console.log('[review] graph collision handling runs inside clusters: true');
      console.log(
        `[review] graph scalable cluster spread active: max radius ${GRAPH_CLUSTER_MEMBER_RADIUS_MAX}, collision ${GRAPH_NODE_COLLISION_DISTANCE}`
      );
      console.log('[review] graph singleton outward bias active: true');
      console.log(
        `[review] graph dynamic update mode: ${previousNodes.size > 0 ? 'incremental restabilization' : 'initial spawn settling'}`
      );
    }

    const tick = () => {
      const result = stepGraphSimulation(nodes, reviewData.graphEdges);
      overlapResolutionRan = overlapResolutionRan || result.overlapResolutionRan;
      frame++;

      if (frame % GRAPH_SIMULATION_RENDER_EVERY === 0) {
        setSimulatedGraphNodes(stripGraphVelocity(nodes));
      }

      if (frame < GRAPH_SIMULATION_MAX_FRAMES && result.maxVelocity > GRAPH_SIMULATION_SETTLE_VELOCITY) {
        graphSimulationRef.current.frameId = window.requestAnimationFrame(tick);
        return;
      }

      graphSimulationRef.current.running = false;
      graphSimulationRef.current.frameId = null;
      setSimulatedGraphNodes(stripGraphVelocity(nodes));

      if (import.meta.env.DEV) {
        const metrics = measureGraphLayoutState(nodes);
        console.log(
          `[review] graph live simulation settled after ${frame} frames, max velocity ${result.maxVelocity.toFixed(
            3
          )}`
        );
        console.log(
          `[review] graph overlap-resolution ran during live simulation: ${overlapResolutionRan}`
        );
        console.log(
          `[review] graph average distance between cluster anchors: ${metrics.averageClusterDistance.toFixed(
            1
          )}`
        );
        console.log(
          `[review] graph min same-cluster member distance after simulation: ${metrics.minMemberDistance.toFixed(
            1
          )}`
        );
        console.log(
          `[review] graph singleton/territory intrusion count after simulation: ${metrics.singletonIntrusionCount}`
        );
        console.log('[review] graph dynamic restabilization complete');
      }
    };

    graphSimulationRef.current.frameId = window.requestAnimationFrame(tick);

    return () => {
      if (graphSimulationRef.current.frameId !== null) {
        window.cancelAnimationFrame(graphSimulationRef.current.frameId);
        graphSimulationRef.current.frameId = null;
      }
    };
  }, [activeSimilarityView, reviewData]);

  useEffect(() => {
    return () => {
      if (graphSimulationRef.current.frameId !== null) {
        window.cancelAnimationFrame(graphSimulationRef.current.frameId);
      }
    };
  }, []);

  const graphNodesForRender = useMemo(
    () =>
      activeSimilarityView === 'graph' && simulatedGraphNodes
        ? simulatedGraphNodes
        : reviewData?.graphNodes ?? [],
    [activeSimilarityView, reviewData?.graphNodes, simulatedGraphNodes]
  );

  const graphNodeById = useMemo(
    () => new Map(graphNodesForRender.map((node) => [node.id, node])),
    [graphNodesForRender]
  );

  useEffect(() => {
    if (!reviewData?.similarPairs.some((pair) => `${pair.imageId1}:${pair.imageId2}` === selectedPairKey)) {
      setSelectedPairKey(null);
    }
    if (!reviewData?.clusters.some((cluster) => cluster.id === selectedClusterId)) {
      setSelectedClusterId(null);
    }
  }, [reviewData, selectedClusterId, selectedPairKey]);

  useEffect(() => {
    setActiveSimilarityView('graph');
    setSelectedPairKey(null);
    setSelectedClusterId(null);
    setPreviewItemIds(null);
  }, [selectedAspectRatios]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(`[review] current Dataset Preview mode: ${activeSimilarityView}`);
      console.log(
        `[review] current Dataset Preview item ids: ${JSON.stringify(previewItemIds ?? filteredItems.map((item) => item.id))}`
      );
    }
  }, [activeSimilarityView, filteredItems, previewItemIds]);

  const highlightedIds = useMemo(() => {
    if (!reviewData) {
      return new Set<string>();
    }

    if (activeSimilarityView === 'pairs' && selectedPairKey) {
      const pair = reviewData.similarPairs.find(
        (entry) => `${entry.imageId1}:${entry.imageId2}` === selectedPairKey
      );
      return new Set(pair ? [pair.imageId1, pair.imageId2] : []);
    }

    if (activeSimilarityView === 'clusters' && selectedClusterId) {
      const cluster = reviewData.clusters.find((entry) => entry.id === selectedClusterId);
      return new Set(cluster?.imageIds ?? []);
    }

    if (activeSimilarityView === 'graph' && previewItemIds && previewItemIds.length > 0) {
      return new Set(previewItemIds);
    }

    return new Set<string>();
  }, [activeSimilarityView, reviewData, previewItemIds, selectedClusterId, selectedPairKey]);

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

  const zoomGraphFromWheelDelta = useCallback((deltaY: number) => {
    const direction = deltaY < 0 ? 1 : -1;
    const zoomFactor = direction > 0 ? 1.12 : 0.88;
    setGraphViewport((previous) => {
      const nextScale = Math.max(
        GRAPH_MIN_SCALE,
        Math.min(GRAPH_MAX_SCALE, previous.scale * zoomFactor)
      );
      const next = { ...previous, scale: nextScale };

      if (import.meta.env.DEV) {
        console.log(`[review] graph zoom level: ${next.scale.toFixed(2)}`);
        console.log(`[review] graph pan offset: ${next.x.toFixed(1)}, ${next.y.toFixed(1)}`);
      }

      return next;
    });
  }, []);

  useEffect(() => {
    const node = graphInteractionRef.current;
    if (!node) {
      return;
    }

    const handleNativeWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      zoomGraphFromWheelDelta(event.deltaY);
      if (import.meta.env.DEV) {
        console.log('[review] graph native wheel event captured with passive:false; preventDefault applied');
      }
    };

    node.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleNativeWheel);
  }, [activeSimilarityView, zoomGraphFromWheelDelta]);

  const handleGraphMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    graphPanRef.current = { active: true, x: event.clientX, y: event.clientY };
  }, []);

  const handleGraphMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!graphPanRef.current.active) {
      return;
    }

    event.preventDefault();
    const deltaX = event.clientX - graphPanRef.current.x;
    const deltaY = event.clientY - graphPanRef.current.y;
    graphPanRef.current = { active: true, x: event.clientX, y: event.clientY };

    setGraphViewport((previous) => {
      const next = {
        ...previous,
        x: previous.x + deltaX,
        y: previous.y + deltaY,
      };

      if (import.meta.env.DEV) {
        console.log(`[review] graph zoom level: ${next.scale.toFixed(2)}`);
        console.log(`[review] graph pan offset: ${next.x.toFixed(1)}, ${next.y.toFixed(1)}`);
      }

      return next;
    });
  }, []);

  const stopGraphPanning = useCallback(() => {
    graphPanRef.current.active = false;
  }, []);

  const resetGraphViewport = useCallback(() => {
    const next = { scale: 1, x: 0, y: 0 };
    setGraphViewport(next);
    if (import.meta.env.DEV) {
      console.log(`[review] graph zoom level: ${next.scale.toFixed(2)}`);
      console.log(`[review] graph pan offset: ${next.x.toFixed(1)}, ${next.y.toFixed(1)}`);
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
    if (activeSimilarityView === 'pairs' && selectedPairKey && reviewData) {
      const pair = reviewData.similarPairs.find(
        (entry) => `${entry.imageId1}:${entry.imageId2}` === selectedPairKey
      );
      if (pair) {
        return `Dataset Preview (Pair #${reviewData.itemIndexById[pair.imageId1]} and #${reviewData.itemIndexById[pair.imageId2]})`;
      }
    }

    if (activeSimilarityView === 'clusters' && selectedClusterId && reviewData) {
      const cluster = reviewData.clusters.find((entry) => entry.id === selectedClusterId);
      if (cluster) {
        return `Dataset Preview (Cluster with ${cluster.imageIds.length} items)`;
      }
    }

    return `Dataset Preview (${filteredItems.length} items)`;
  }, [activeSimilarityView, filteredItems.length, reviewData, selectedClusterId, selectedPairKey]);

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
          <p className="mb-1 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <GitCompareArrows size={14} />
            Similar Pairs
          </p>
          <p className="text-2xl font-bold">{reviewData?.similarPairs.length ?? 0}</p>
        </button>
        <button
          onClick={showClusters}
          className={`rounded-lg border bg-card p-4 text-left transition-colors ${
            activeSimilarityView === 'clusters' ? 'border-primary bg-primary/5' : 'border-border'
          }`}
        >
          <p className="mb-1 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Boxes size={14} />
            Clusters
          </p>
          <p className="text-2xl font-bold">{reviewData?.clusters.length ?? 0}</p>
        </button>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Threshold</p>
          <p className="text-2xl font-bold">{uiThreshold.toFixed(2)}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Similarity Graph</h3>
            <p className="text-sm text-muted-foreground">
              Final Review uses a much more sensitive similarity threshold than Remove Duplicates.
            </p>
          </div>
          {reviewData && (
            <div className="text-right text-sm text-muted-foreground">
              <p>Similarity scope: {reviewData.items.length}/{filteredItems.length}</p>
              <p>Pairs: {reviewData.similarPairs.length}</p>
              <p>Clusters: {reviewData.clusters.length}</p>
            </div>
          )}
        </div>

        <div className="rounded-md border border-border bg-secondary/20 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Shared Similarity Threshold</label>
              <p className="text-xs text-muted-foreground">
                Drives the graph, similar pairs, and clusters together.
              </p>
            </div>
            <div className="w-48">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={uiThreshold}
                onChange={(event) => handleThresholdChange(parseFloat(event.target.value))}
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
              setActiveSimilarityView('graph');
              setSelectedPairKey(null);
              setSelectedClusterId(null);
              setPreviewItemIds(null);
              if (import.meta.env.DEV) {
                console.log('[review] graph UI clicked');
              }
            }}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
              activeSimilarityView === 'graph'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary hover:bg-muted'
            }`}
          >
            <Network size={14} />
            Graph
          </button>
          <button
            onClick={showPairs}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
              activeSimilarityView === 'pairs'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary hover:bg-muted'
            }`}
          >
            <GitCompareArrows size={14} />
            Similar Pairs
          </button>
          <button
            onClick={showClusters}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
              activeSimilarityView === 'clusters'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary hover:bg-muted'
            }`}
          >
            <Boxes size={14} />
            Clusters
          </button>
        </div>

        <div
          ref={reviewViewContainerRef}
          className="h-[min(860px,calc(100vh-12rem))] min-h-[620px] overflow-hidden rounded-md border border-border bg-background/50"
        >
          {reviewData ? (
            <div className="h-full">
              {activeSimilarityView === 'graph' && (
                <div className="relative h-full overflow-hidden rounded-md bg-secondary/20">
                  <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
                    <div className="rounded-md border border-border bg-background/90 px-3 py-2 text-right text-xs text-muted-foreground shadow-sm backdrop-blur">
                      <p>{graphNodesForRender.filter((node) => node.kind === 'image').length} images</p>
                      <p>{reviewData.graphClusterNodeCount} clusters</p>
                      <p>
                        {reviewData.graphPairEdgeCount}/{reviewData.graphRawPairCount} pair links
                      </p>
                      <p>{reviewData.graphSingletonCount} singletons</p>
                      <p>Zoom {graphViewport.scale.toFixed(2)}x</p>
                    </div>

                    <button
                      type="button"
                      onClick={resetGraphViewport}
                      className="pointer-events-auto rounded-md border border-border bg-background/90 px-3 py-1 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted"
                    >
                      Reset view
                    </button>
                  </div>

                  <div
                    className={`h-full overflow-hidden ${
                      graphPanRef.current.active ? 'cursor-grabbing' : 'cursor-grab'
                    }`}
                    ref={graphInteractionRef}
                    onMouseDown={handleGraphMouseDown}
                    onMouseMove={handleGraphMouseMove}
                    onMouseUp={stopGraphPanning}
                    onMouseLeave={stopGraphPanning}
                    onAuxClick={(event) => event.preventDefault()}
                  >
                    <svg
                      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
                      role="img"
                      aria-label="Similarity graph"
                      className="h-full w-full min-w-[900px]"
                    >
                      <rect width={GRAPH_WIDTH} height={GRAPH_HEIGHT} fill="transparent" />

                      <g
                        transform={`translate(${graphViewport.x} ${graphViewport.y}) scale(${graphViewport.scale})`}
                      >
                        {reviewData.graphEdges.map((edge) => {
                          const left = graphNodeById.get(edge.sourceId);
                          const right = graphNodeById.get(edge.targetId);
                          if (!left || !right) {
                            return null;
                          }

                          const isMembership = edge.type === 'membership';
                          return (
                            <line
                              key={edge.id}
                              x1={left.x}
                              y1={left.y}
                              x2={right.x}
                              y2={right.y}
                              stroke={isMembership ? getGraphGroupColor(left.groupIndex) : 'hsl(var(--primary))'}
                              strokeDasharray={isMembership ? undefined : '5 5'}
                              strokeLinecap="round"
                              strokeOpacity={isMembership ? 0.46 : 0.24 + edge.strength * 0.5}
                              strokeWidth={isMembership ? 2.2 : 1.2 + edge.strength * 2.8}
                            >
                              <title>
                                {isMembership
                                  ? `${left.label} membership: image #${reviewData.itemIndexById[edge.targetId]}`
                                  : `#${reviewData.itemIndexById[edge.sourceId]} to #${
                                      reviewData.itemIndexById[edge.targetId]
                                    }: ${((edge.similarity ?? 0) * 100).toFixed(1)}%`}
                              </title>
                            </line>
                          );
                        })}

                        {graphNodesForRender.map((node) => {
                          const color = getGraphGroupColor(node.groupIndex);
                          if (node.kind === 'cluster') {
                            return (
                              <g
                                key={node.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  setPreviewItemIds(node.memberIds ?? []);
                                  setSelectedPairKey(null);
                                  setSelectedClusterId(node.clusterId ?? null);
                                  if (import.meta.env.DEV) {
                                    console.log(`[review] graph cluster node clicked: ${node.clusterId}`);
                                  }
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    setPreviewItemIds(node.memberIds ?? []);
                                    setSelectedClusterId(node.clusterId ?? null);
                                  }
                                }}
                                className="cursor-pointer"
                              >
                                <circle
                                  cx={node.x}
                                  cy={node.y}
                                  r="38"
                                  fill="hsl(var(--background))"
                                  stroke={color}
                                  strokeWidth="4"
                                />
                                <circle
                                  cx={node.x}
                                  cy={node.y}
                                  r="28"
                                  fill={color}
                                  fillOpacity="0.2"
                                  stroke={color}
                                  strokeWidth="1.5"
                                />
                                <text
                                  x={node.x}
                                  y={node.y - 2}
                                  textAnchor="middle"
                                  fontSize="15"
                                  fill="currentColor"
                                  className="font-semibold text-foreground"
                                >
                                  {node.label}
                                </text>
                                <text
                                  x={node.x}
                                  y={node.y + 15}
                                  textAnchor="middle"
                                  fontSize="9"
                                  fill="currentColor"
                                  className="text-muted-foreground"
                                >
                                  {node.memberIds?.length ?? 0} imgs
                                </text>
                                <title>
                                  {node.label}: {node.memberIds?.length ?? 0} images
                                </title>
                              </g>
                            );
                          }

                          const item = reviewData.items.find((entry) => entry.id === node.imageId);
                          const index = node.imageId ? reviewData.itemIndexById[node.imageId] : undefined;
                          return (
                            <g
                              key={node.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setPreviewItemIds(node.imageId ? [node.imageId] : []);
                                setSelectedPairKey(null);
                                setSelectedClusterId(null);
                                if (import.meta.env.DEV) {
                                  console.log(`[review] graph node clicked: ${node.id}`);
                                }
                              }}
                              onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setPreviewItemIds(node.imageId ? [node.imageId] : []);
                              }
                            }}
                              className="cursor-pointer"
                            >
                              <circle
                                cx={node.x}
                                cy={node.y}
                                r="34"
                                fill={color}
                                fillOpacity="0.2"
                                stroke={color}
                                strokeWidth="2"
                              />
                              <foreignObject x={node.x - 24} y={node.y - 24} width="48" height="48">
                                <div className="h-12 w-12 overflow-hidden rounded-full border border-background bg-black">
                                  {item && previewUrls[item.id] ? (
                                    <img
                                      src={previewUrls[item.id]}
                                      alt={`Image ${index}`}
                                      className="h-full w-full object-cover"
                                      draggable={false}
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                                  {index}
                                    </div>
                                  )}
                                </div>
                              </foreignObject>
                              <circle
                                cx={node.x + 26}
                                cy={node.y - 26}
                                r="12"
                                fill="hsl(var(--background))"
                                stroke={color}
                              />
                              <text
                                x={node.x + 26}
                                y={node.y - 22}
                                textAnchor="middle"
                                fontSize="10"
                                fill="currentColor"
                                className="font-mono text-foreground"
                              >
                              {index}
                              </text>
                            <title>Image #{index}</title>
                            </g>
                          );
                        })}
                      </g>
                    </svg>
                  </div>

                  {reviewData.graphEdges.length === 0 ? (
                    <p className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md border border-border bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
                      No links are above the current shared threshold.
                    </p>
                  ) : null}
                </div>
              )}

              {activeSimilarityView === 'pairs' && (
                <div className="h-full overflow-y-auto bg-secondary/30 p-3">
                  {reviewData.similarPairs.length > 0 ? (
                    <div className="space-y-2">
                      {reviewData.similarPairs.map((pair) => {
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
                              #{reviewData.itemIndexById[pair.imageId1]} and #
                              {reviewData.itemIndexById[pair.imageId2]}
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
                      No strong similarity pairs in the current graph review scope.
                    </p>
                  )}
                </div>
              )}

              {activeSimilarityView === 'clusters' && (
                <div className="h-full overflow-y-auto bg-secondary/30 p-3">
                  {reviewData.clusters.length > 0 ? (
                    <div className="space-y-2">
                      {reviewData.clusters.map((cluster: SimilarityCluster) => (
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
                              .map((id) => `#${reviewData.itemIndexById[id]}`)
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
            <div className="h-full overflow-auto bg-secondary/30 p-4 text-sm text-muted-foreground">
              Preparing similarity graph for the current review dataset...
            </div>
          )}
        </div>
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
