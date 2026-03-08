import {
  CycleDetectionResult,
  DependencyGraph,
  GraphNode,
  WorkOrderDoc,
} from "./types";

/**
 * Builds a dependency graph from work orders.
 *
 * Edge direction:
 * parent -> child
 *
 * If WO-B depends on WO-A, then:
 * WO-A -> WO-B
 */
export function buildDependencyGraph(
  workOrders: WorkOrderDoc[],
): DependencyGraph {
  const nodesById = new Map<string, GraphNode>();
  const indegreeById = new Map<string, number>();

  // First pass: create all nodes
  for (const workOrder of workOrders) {
    nodesById.set(workOrder.docId, {
      workOrder,
      parentIds: [...(workOrder.data.dependsOnWorkOrderIds ?? [])],
      childIds: [],
    });

    indegreeById.set(workOrder.docId, 0);
  }

  // Second pass: wires parent -> child edges
  for (const workOrder of workOrders) {
    const childId = workOrder.docId;
    const parentIds = workOrder.data.dependsOnWorkOrderIds ?? [];

    for (const parentId of parentIds) {
      const parentNode = nodesById.get(parentId);

      if (!parentNode) {
        throw new Error(
          `Missing dependency: work order "${childId}" depends on missing parent "${parentId}"`,
        );
      }

      parentNode.childIds.push(childId);
      indegreeById.set(childId, (indegreeById.get(childId) ?? 0) + 1);
    }
  }

  return {
    nodesById,
    indegreeById,
  };
}

/**
 * Returns work orders in a valid dependency-safe
 * Throws a helpful error if a cycle is detected.
 */
export function topologicalSortOrThrow(
  graph: DependencyGraph,
): WorkOrderDoc[] {
  const indegree = new Map(graph.indegreeById);
  const zeroIndegreeQueue: string[] = [];
  const ordered: WorkOrderDoc[] = [];

  for (const [nodeId, degree] of indegree.entries()) {
    if (degree === 0) {
      zeroIndegreeQueue.push(nodeId);
    }
  }

  zeroIndegreeQueue.sort();

  while (zeroIndegreeQueue.length > 0) {
    const currentId = zeroIndegreeQueue.shift()!;
    const node = graph.nodesById.get(currentId);

    if (!node) {
      throw new Error(`Graph corruption: missing node "${currentId}"`);
    }

    ordered.push(node.workOrder);

    for (const childId of node.childIds) {
      const nextDegree = (indegree.get(childId) ?? 0) - 1;
      indegree.set(childId, nextDegree);

      if (nextDegree === 0) {
        zeroIndegreeQueue.push(childId);
        zeroIndegreeQueue.sort();
      }
    }
  }

  if (ordered.length !== graph.nodesById.size) {
    const cycle = detectCycle(graph);

    if (cycle.hasCycle) {
      throw new Error(
        `Cyclic dependency detected: ${cycle.cyclePath.join(" -> ")}`,
      );
    }

    throw new Error("Cyclic dependency detected in work orders");
  }

  return ordered;
}

/**
 * DFS-based cycle detection used to produce a readable cycle path.
 */
export function detectCycle(graph: DependencyGraph): CycleDetectionResult {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];
  let cyclePath: string[] = [];

  const dfs = (nodeId: string): boolean => {
    visited.add(nodeId);
    inStack.add(nodeId);
    path.push(nodeId);

    const node = graph.nodesById.get(nodeId);
    if (!node) {
      path.pop();
      inStack.delete(nodeId);
      return false;
    }

    for (const childId of node.childIds) {
      if (!visited.has(childId)) {
        if (dfs(childId)) {
          return true;
        }
      } else if (inStack.has(childId)) {
        const cycleStartIndex = path.indexOf(childId);
        cyclePath = [...path.slice(cycleStartIndex), childId];
        return true;
      }
    }

    path.pop();
    inStack.delete(nodeId);
    return false;
  };

  for (const nodeId of graph.nodesById.keys()) {
    if (!visited.has(nodeId)) {
      if (dfs(nodeId)) {
        return {
          hasCycle: true,
          cyclePath,
        };
      }
    }
  }

  return {
    hasCycle: false,
    cyclePath: [],
  };
}


export function buildTopologicalOrder(
  workOrders: WorkOrderDoc[],
): WorkOrderDoc[] {
  const graph = buildDependencyGraph(workOrders);
  return topologicalSortOrThrow(graph);
}