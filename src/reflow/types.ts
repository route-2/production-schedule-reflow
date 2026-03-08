export type BaseDoc<TType extends string, TData> = {
  docId: string;
  docType: TType;
  data: TData;
};

export type Shift = {
  dayOfWeek: number; // 0-6, Sunday = 0
  startHour: number; // 0-23
  endHour: number; // 0-23
};

export type MaintenanceWindow = {
  startDate: string;
  endDate: string;
  reason?: string;
};

export type WorkOrderData = {
  workOrderNumber: string;
  manufacturingOrderId: string;
  workCenterId: string;

  startDate: string;
  endDate: string;

  durationMinutes: number;

  isMaintenance: boolean;

  dependsOnWorkOrderIds: string[];

  setupTimeMinutes?: number;
};

export type WorkCenterData = {
  name: string;
  shifts: Shift[];
  maintenanceWindows: MaintenanceWindow[];
};

export type ManufacturingOrderData = {
  manufacturingOrderNumber: string;
  itemId: string;
  quantity: number;
  dueDate: string;
};

export type WorkOrderDoc = BaseDoc<"workOrder", WorkOrderData>;
export type WorkCenterDoc = BaseDoc<"workCenter", WorkCenterData>;
export type ManufacturingOrderDoc = BaseDoc<
  "manufacturingOrder",
  ManufacturingOrderData
>;

export type InputDocuments = {
  workOrders: WorkOrderDoc[];
  workCenters: WorkCenterDoc[];
  manufacturingOrders: ManufacturingOrderDoc[];
};

export type ChangeReason =
  | "dependency"
  | "work-center-conflict"
  | "shift-boundary"
  | "maintenance-window"
  | "duration-overrun"
  | "unchanged";

export type WorkOrderChange = {
  workOrderId: string;
  workOrderNumber: string;
  oldStartDate: string;
  oldEndDate: string;
  newStartDate: string;
  newEndDate: string;
  deltaStartMinutes: number;
  deltaEndMinutes: number;
  reasons: ChangeReason[];
  explanation: string;
};

export type ReflowResult = {
  updatedWorkOrders: WorkOrderDoc[];
  changes: WorkOrderChange[];
  explanation: string[];
  executionSegmentsByWorkOrderId?: Map<string, ExecutionSegmentInternal[]>;
};

export type GraphNode = {
  workOrder: WorkOrderDoc;
  parentIds: string[];
  childIds: string[];
};

export type DependencyGraph = {
  nodesById: Map<string, GraphNode>;
  indegreeById: Map<string, number>;
};

export type CycleDetectionResult = {
  hasCycle: boolean;
  cyclePath: string[];
};

export type ValidationErrorType =
  | "missing-work-center"
  | "missing-dependency"
  | "cyclic-dependency"
  | "overlap"
  | "dependency-violation"
  | "maintenance-violation"
  | "shift-violation"
  | "no-valid-slot";

export type ValidationError = {
  type: ValidationErrorType;
  message: string;
  workOrderIds?: string[];
  workCenterId?: string;
};

export type ValidationResult = {
  isValid: boolean;
  errors: ValidationError[];
};

export type OptimizationMetrics = {
  totalDelayMinutes: number;
  movedWorkOrdersCount: number;
  unchangedWorkOrdersCount: number;
};

export type ReflowOptions = {
  preserveOriginalStartAsLowerBound?: boolean;
};
export type ExecutionSegment = {
  startDate: string;
  endDate: string;
};

export type ExecutionSegmentInternal = {
  start: import("luxon").DateTime;
  end: import("luxon").DateTime;
};