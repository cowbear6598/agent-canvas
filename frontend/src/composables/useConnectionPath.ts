import type {
  AnchorPosition,
  ConnectionRoutingMode,
  ConnectionRoutingPoint,
  OrthogonalRoutingControlRole,
} from "@/types/connection";
import { MAX_CONNECTION_ROUTING_POINTS } from "@/types/connection";
import { RADIANS_TO_DEGREES } from "@/lib/constants";

interface Point {
  x: number;
  y: number;
}

interface CubicSegment {
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
}

interface OrthogonalRoute {
  points: Point[];
  routeAxis: RouteAxis;
  controls: OrthogonalControlGeometry[];
  existingControlRoles: OrthogonalRoutingControlRole[];
}

interface OrthogonalControlGeometry {
  role: OrthogonalRoutingControlRole;
  point: ConnectionRoutingPoint;
  dragAxis: RouteAxis;
  segmentLength: number;
}

export type RouteAxis = "x" | "y";

export interface PathData {
  path: string;
  midPoint: Point;
  angle: number;
  routeAxis: RouteAxis | null;
  handlePoint: Point;
  bounds: { left: number; top: number; right: number; bottom: number };
}

export interface ArrowPosition extends Point {
  angle: number;
}

export interface RoutingInsertionHandle {
  point: ConnectionRoutingPoint;
  insertIndex: number;
  dragAxis: RouteAxis | null;
}

export interface ConnectionPathParams {
  start: Point;
  end: Point;
  sourceAnchor: AnchorPosition;
  targetAnchor: AnchorPosition;
  routingMode?: ConnectionRoutingMode;
  routingOffset?: number;
  routingPoints?: ConnectionRoutingPoint[];
}

export type BezierPathParams = ConnectionPathParams;

const CURVE_MIDPOINT = 0.5;
const BEZIER_LENGTH_ESTIMATION_FACTOR = 1.2;
const BEZIER_CONTROL_POINT_RATIO = 0.3;
const BEZIER_MAX_OFFSET_PX = 100;
const BEZIER_MIDPOINT_CONTROL_WEIGHT = 0.75;
const BEZIER_SAMPLES_PER_SEGMENT = 20;
const CONNECTION_ANCHOR_LEAD_PX = 24;
const MAX_CONNECTION_ARROWS = 5;
const ORTHOGONAL_CONTROL_ROLES: OrthogonalRoutingControlRole[] = [
  "source-leg",
  "lane",
  "target-leg",
];

function resolveRouteAxis(start: Point, end: Point): RouteAxis {
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? "y" : "x";
}

function applyAnchorOffset(
  baseX: number,
  baseY: number,
  anchor: AnchorPosition,
  offset: number,
): Point {
  const point = { x: baseX, y: baseY };
  if (anchor === "top") point.y -= offset;
  else if (anchor === "bottom") point.y += offset;
  else if (anchor === "left") point.x -= offset;
  else if (anchor === "right") point.x += offset;
  return point;
}

function calculateLeadPoints(params: ConnectionPathParams): {
  sourceLead: Point;
  targetLead: Point;
} {
  if (samePoint(params.start, params.end)) {
    return { sourceLead: params.start, targetLead: params.end };
  }
  return {
    sourceLead: applyAnchorOffset(
      params.start.x,
      params.start.y,
      params.sourceAnchor,
      CONNECTION_ANCHOR_LEAD_PX,
    ),
    targetLead: applyAnchorOffset(
      params.end.x,
      params.end.y,
      params.targetAnchor,
      CONNECTION_ANCHOR_LEAD_PX,
    ),
  };
}

function calculateDefaultControlPoints(params: ConnectionPathParams): {
  control1: Point;
  control2: Point;
} {
  const { start, end, sourceAnchor, targetAnchor } = params;
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const anchorOffset = Math.min(
    distance * BEZIER_CONTROL_POINT_RATIO,
    BEZIER_MAX_OFFSET_PX,
  );
  const control1 = applyAnchorOffset(
    start.x,
    start.y,
    sourceAnchor,
    anchorOffset,
  );
  const control2 = applyAnchorOffset(
    end.x,
    end.y,
    targetAnchor,
    anchorOffset,
  );
  const controlOffset =
    (params.routingOffset ?? 0) / BEZIER_MIDPOINT_CONTROL_WEIGHT;

  if (resolveRouteAxis(start, end) === "y") {
    control1.y += controlOffset;
    control2.y += controlOffset;
  } else {
    control1.x += controlOffset;
    control2.x += controlOffset;
  }
  return { control1, control2 };
}

function buildBezierSegments(params: ConnectionPathParams): CubicSegment[] {
  const routingPoints = params.routingPoints ?? [];
  const { sourceLead, targetLead } = calculateLeadPoints(params);
  if (routingPoints.length === 0) {
    const { control1, control2 } = calculateDefaultControlPoints({
      ...params,
      start: sourceLead,
      end: targetLead,
    });
    return [{ start: sourceLead, control1, control2, end: targetLead }];
  }

  const knots: Point[] = [sourceLead, ...routingPoints, targetLead];
  const segments = knots.slice(0, -1).map((start, index) => {
    const previous = knots[index - 1] ?? start;
    const end = knots[index + 1]!;
    const next = knots[index + 2] ?? end;
    return {
      start,
      control1: {
        x: start.x + (end.x - previous.x) / 6,
        y: start.y + (end.y - previous.y) / 6,
      },
      control2: {
        x: end.x - (next.x - start.x) / 6,
        y: end.y - (next.y - start.y) / 6,
      },
      end,
    };
  });
  const firstSegment = segments[0]!;
  const lastSegment = segments.at(-1)!;
  const firstDistance = Math.min(
    Math.hypot(
      firstSegment.end.x - firstSegment.start.x,
      firstSegment.end.y - firstSegment.start.y,
    ) / 3,
    BEZIER_MAX_OFFSET_PX,
  );
  const lastDistance = Math.min(
    Math.hypot(
      lastSegment.end.x - lastSegment.start.x,
      lastSegment.end.y - lastSegment.start.y,
    ) / 3,
    BEZIER_MAX_OFFSET_PX,
  );
  firstSegment.control1 = applyAnchorOffset(
    firstSegment.start.x,
    firstSegment.start.y,
    params.sourceAnchor,
    firstDistance,
  );
  lastSegment.control2 = applyAnchorOffset(
    lastSegment.end.x,
    lastSegment.end.y,
    params.targetAnchor,
    lastDistance,
  );
  return segments;
}

function calculateBezierCoordinate(
  parameter: number,
  start: number,
  control1: number,
  control2: number,
  end: number,
): number {
  if (
    start === control1 &&
    control1 === control2 &&
    control2 === end
  ) {
    return start;
  }
  const inverse = 1 - parameter;
  return (
    inverse * inverse * inverse * start +
    3 * inverse * inverse * parameter * control1 +
    3 * inverse * parameter * parameter * control2 +
    parameter * parameter * parameter * end
  );
}

function pointOnCubic(segment: CubicSegment, parameter: number): Point {
  return {
    x: calculateBezierCoordinate(
      parameter,
      segment.start.x,
      segment.control1.x,
      segment.control2.x,
      segment.end.x,
    ),
    y: calculateBezierCoordinate(
      parameter,
      segment.start.y,
      segment.control1.y,
      segment.control2.y,
      segment.end.y,
    ),
  };
}

function sampleBezierSegments(segments: CubicSegment[]): Point[] {
  return segments.flatMap((segment, segmentIndex) =>
    Array.from(
      { length: BEZIER_SAMPLES_PER_SEGMENT + 1 },
      (_, sampleIndex) =>
        pointOnCubic(segment, sampleIndex / BEZIER_SAMPLES_PER_SEGMENT),
    ).filter((_, sampleIndex) => segmentIndex === 0 || sampleIndex > 0),
  );
}

function sampleBezierPath(
  params: ConnectionPathParams,
  segments: CubicSegment[],
): Point[] {
  return [params.start, ...sampleBezierSegments(segments), params.end];
}

function samePoint(first: Point, second: Point): boolean {
  return first.x === second.x && first.y === second.y;
}

function getPerpendicularAxis(axis: RouteAxis): RouteAxis {
  return axis === "x" ? "y" : "x";
}

function createAxisPoint(
  routeAxis: RouteAxis,
  routeCoordinate: number,
  perpendicularCoordinate: number,
): Point {
  return routeAxis === "x"
    ? { x: routeCoordinate, y: perpendicularCoordinate }
    : { x: perpendicularCoordinate, y: routeCoordinate };
}

function simplifyOrthogonalPoints(points: Point[]): Point[] {
  const unique = points.filter(
    (point, index) => index === 0 || !samePoint(point, points[index - 1]!),
  );
  return unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true;
    const previous = unique[index - 1]!;
    const next = unique[index + 1]!;
    const betweenX =
      point.x >= Math.min(previous.x, next.x) &&
      point.x <= Math.max(previous.x, next.x);
    const betweenY =
      point.y >= Math.min(previous.y, next.y) &&
      point.y <= Math.max(previous.y, next.y);
    return !(
      (previous.x === point.x && point.x === next.x && betweenY) ||
      (previous.y === point.y && point.y === next.y && betweenX)
    );
  });
}

function classifyLegacyOrthogonalRole(
  point: ConnectionRoutingPoint,
  start: Point,
  end: Point,
  routeAxis: RouteAxis,
): OrthogonalRoutingControlRole {
  const perpendicularAxis = getPerpendicularAxis(routeAxis);
  const startCoordinate = start[perpendicularAxis];
  const endCoordinate = end[perpendicularAxis];
  const pointCoordinate = point[perpendicularAxis];
  const span = endCoordinate - startCoordinate;
  if (span === 0) return "lane";
  const progress = (pointCoordinate - startCoordinate) / span;
  if (progress < 1 / 3) return "source-leg";
  if (progress > 2 / 3) return "target-leg";
  return "lane";
}

function resolveOrthogonalControlEntries(
  routingPoints: ConnectionRoutingPoint[],
  start: Point,
  end: Point,
  routeAxis: RouteAxis,
): Array<{
  source: ConnectionRoutingPoint;
  role: OrthogonalRoutingControlRole;
}> {
  const usedRoles = new Set<OrthogonalRoutingControlRole>();
  return routingPoints.slice(0, MAX_CONNECTION_ROUTING_POINTS).map((point) => {
    const preferredRole =
      point.orthogonalRole ??
      classifyLegacyOrthogonalRole(point, start, end, routeAxis);
    const role = usedRoles.has(preferredRole)
      ? ORTHOGONAL_CONTROL_ROLES.find((candidate) => !usedRoles.has(candidate)) ??
        preferredRole
      : preferredRole;
    usedRoles.add(role);
    return { source: point, role };
  });
}

function calculateDefaultOrthogonalLane(
  start: Point,
  end: Point,
  routeAxis: RouteAxis,
  routingOffset: number,
): number {
  return (start[routeAxis] + end[routeAxis]) / 2 + routingOffset;
}

function buildOrthogonalRoute(params: ConnectionPathParams): OrthogonalRoute {
  const outerStart = params.start;
  const outerEnd = params.end;
  const { sourceLead: start, targetLead: end } = calculateLeadPoints(params);
  const routeAxis = resolveRouteAxis(start, end);
  const perpendicularAxis = getPerpendicularAxis(routeAxis);
  const routingPoints = params.routingPoints ?? [];
  const controlEntries = resolveOrthogonalControlEntries(
    routingPoints,
    start,
    end,
    routeAxis,
  );
  const controlsByRole = new Map(
    controlEntries.map((entry) => [entry.role, entry.source]),
  );
  const laneControl = controlsByRole.get("lane");
  const sourceControl = controlsByRole.get("source-leg");
  const targetControl = controlsByRole.get("target-leg");
  const lane =
    laneControl?.[routeAxis] ??
    calculateDefaultOrthogonalLane(
      start,
      end,
      routeAxis,
      params.routingOffset ?? 0,
    );
  const sourceLeg =
    sourceControl?.[perpendicularAxis] ?? start[perpendicularAxis];
  const targetLeg =
    targetControl?.[perpendicularAxis] ?? end[perpendicularAxis];
  const startRouteCoordinate = start[routeAxis];
  const endRouteCoordinate = end[routeAxis];
  const point = (
    routeCoordinate: number,
    perpendicularCoordinate: number,
  ): Point =>
    createAxisPoint(routeAxis, routeCoordinate, perpendicularCoordinate);
  const corePoints = [
    point(startRouteCoordinate, sourceLeg),
    point(lane, sourceLeg),
    point(lane, targetLeg),
    point(endRouteCoordinate, targetLeg),
  ];
  const control = (
    role: OrthogonalRoutingControlRole,
    routeCoordinate: number,
    perpendicularCoordinate: number,
    dragAxis: RouteAxis,
    segmentLength: number,
  ): OrthogonalControlGeometry => ({
    role,
    point: {
      ...point(routeCoordinate, perpendicularCoordinate),
      orthogonalRole: role,
    },
    dragAxis,
    segmentLength,
  });
  const controls = [
    control(
      "source-leg",
      (startRouteCoordinate + lane) / 2,
      sourceLeg,
      perpendicularAxis,
      Math.abs(lane - startRouteCoordinate),
    ),
    control(
      "lane",
      lane,
      (sourceLeg + targetLeg) / 2,
      routeAxis,
      Math.abs(targetLeg - sourceLeg),
    ),
    control(
      "target-leg",
      (lane + endRouteCoordinate) / 2,
      targetLeg,
      perpendicularAxis,
      Math.abs(endRouteCoordinate - lane),
    ),
  ];
  return {
    points: simplifyOrthogonalPoints([
      outerStart,
      start,
      ...corePoints,
      end,
      outerEnd,
    ]),
    routeAxis,
    controls,
    existingControlRoles: controlEntries.map((entry) => entry.role),
  };
}

function segmentLength(start: Point, end: Point): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function calculatePolylineLength(points: Point[]): number {
  return points.slice(1).reduce(
    (length, point, index) => length + segmentLength(points[index]!, point),
    0,
  );
}

function pointAtPolylineDistance(
  points: Point[],
  distance: number,
): ArrowPosition {
  let remaining = distance;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const length = segmentLength(start, end);
    if (remaining <= length || index === points.length - 1) {
      const ratio = length === 0 ? 0 : Math.min(1, remaining / length);
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
        angle:
          Math.atan2(end.y - start.y, end.x - start.x) * RADIANS_TO_DEGREES,
      };
    }
    remaining -= length;
  }
  return { ...points[0]!, angle: 0 };
}

function calculateBounds(points: Point[]): PathData["bounds"] {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function calculateBezierPathData(params: ConnectionPathParams): PathData {
  const segments = buildBezierSegments(params);
  const sampledPoints = sampleBezierPath(params, segments);
  const length = calculatePolylineLength(sampledPoints);
  const midpoint = pointAtPolylineDistance(sampledPoints, length / 2);
  return {
    path: [
      `M ${params.start.x},${params.start.y} L ${segments[0]!.start.x},${segments[0]!.start.y}`,
      ...segments.map(
        (segment) =>
          `C ${segment.control1.x},${segment.control1.y} ${segment.control2.x},${segment.control2.y} ${segment.end.x},${segment.end.y}`,
      ),
      `L ${params.end.x},${params.end.y}`,
    ].join(" "),
    midPoint: { x: midpoint.x, y: midpoint.y },
    angle: midpoint.angle,
    routeAxis: resolveRouteAxis(params.start, params.end),
    handlePoint: { x: midpoint.x, y: midpoint.y },
    bounds: calculateBounds(sampledPoints),
  };
}

function calculateOrthogonalPathData(params: ConnectionPathParams): PathData {
  const route = buildOrthogonalRoute(params);
  const length = calculatePolylineLength(route.points);
  const midpoint = pointAtPolylineDistance(route.points, length / 2);
  return {
    path: route.points
      .map((point, index) =>
        index === 0 ? `M ${point.x},${point.y}` : `L ${point.x},${point.y}`,
      )
      .join(" "),
    midPoint: { x: midpoint.x, y: midpoint.y },
    angle: midpoint.angle,
    routeAxis: route.routeAxis,
    handlePoint: { x: midpoint.x, y: midpoint.y },
    bounds: calculateBounds(route.points),
  };
}

function calculateBezierArrows(
  params: ConnectionPathParams,
  spacing: number,
): ArrowPosition[] {
  const points = sampleBezierPath(params, buildBezierSegments(params));
  const estimatedLength =
    (params.routingPoints?.length ?? 0) === 0
      ? Math.hypot(params.end.x - params.start.x, params.end.y - params.start.y) *
        BEZIER_LENGTH_ESTIMATION_FACTOR
      : undefined;
  return calculatePolylineArrows(points, spacing, estimatedLength);
}

function calculateOrthogonalArrows(
  params: ConnectionPathParams,
  spacing: number,
): ArrowPosition[] {
  return calculatePolylineArrows(
    buildOrthogonalRoute(params).points,
    spacing,
  );
}

function calculatePolylineArrows(
  points: Point[],
  spacing: number,
  estimatedLength?: number,
): ArrowPosition[] {
  const length = calculatePolylineLength(points);
  const count = Math.min(
    MAX_CONNECTION_ARROWS,
    Math.max(1, Math.floor((estimatedLength ?? length) / spacing)),
  );
  return Array.from({ length: count }, (_, index) =>
    pointAtPolylineDistance(points, (length * (index + 1)) / (count + 1)),
  );
}

function calculateBezierInsertionHandles(
  params: ConnectionPathParams,
): RoutingInsertionHandle[] {
  const existingCount = params.routingPoints?.length ?? 0;
  const availableCount = MAX_CONNECTION_ROUTING_POINTS - existingCount;
  if (availableCount <= 0) {
    return [];
  }
  return buildBezierSegments(params)
    .map((segment, insertIndex) => ({
      point: pointOnCubic(segment, CURVE_MIDPOINT),
      insertIndex,
      dragAxis: null,
      priority: segmentLength(segment.start, segment.end),
    }))
    .sort((first, second) => second.priority - first.priority)
    .slice(0, availableCount)
    .sort((first, second) => first.insertIndex - second.insertIndex)
    .map(({ priority: _priority, ...handle }) => handle);
}

function calculateOrthogonalInsertionHandles(
  params: ConnectionPathParams,
): RoutingInsertionHandle[] {
  const routingPoints = params.routingPoints ?? [];
  const availableCount = MAX_CONNECTION_ROUTING_POINTS - routingPoints.length;
  if (availableCount <= 0) {
    return [];
  }
  const route = buildOrthogonalRoute(params);
  const existingRoles = new Set(route.existingControlRoles);
  return route.controls
    .filter(
      (control) =>
        control.segmentLength > 0 && !existingRoles.has(control.role),
    )
    .slice(0, availableCount)
    .map((control) => ({
      point: control.point,
      insertIndex: ORTHOGONAL_CONTROL_ROLES.filter(
        (role) =>
          ORTHOGONAL_CONTROL_ROLES.indexOf(role) <
            ORTHOGONAL_CONTROL_ROLES.indexOf(control.role) &&
          existingRoles.has(role),
      ).length,
      dragAxis: control.dragAxis,
    }));
}

function calculateRoutingControlPoints(
  params: ConnectionPathParams,
): ConnectionRoutingPoint[] {
  const routingPoints = params.routingPoints ?? [];
  if (params.routingMode !== "orthogonal") {
    return routingPoints.map((point) => ({ ...point }));
  }
  const route = buildOrthogonalRoute(params);
  const controlsByRole = new Map(
    route.controls.map((control) => [control.role, control.point]),
  );
  return route.existingControlRoles.map((role) => ({
    ...controlsByRole.get(role)!,
    orthogonalRole: role,
  }));
}

export function useConnectionPath(): {
  calculatePathData: (params: ConnectionPathParams) => PathData;
  calculateMultipleArrowPositions: (
    params: ConnectionPathParams,
    spacing?: number,
  ) => ArrowPosition[];
  calculateInsertionHandles: (
    params: ConnectionPathParams,
  ) => RoutingInsertionHandle[];
  calculateRoutingControlPoints: (
    params: ConnectionPathParams,
  ) => ConnectionRoutingPoint[];
} {
  const calculatePathData = (params: ConnectionPathParams): PathData =>
    params.routingMode === "orthogonal"
      ? calculateOrthogonalPathData(params)
      : calculateBezierPathData(params);

  const calculateMultipleArrowPositions = (
    params: ConnectionPathParams,
    spacing: number = 80,
  ): ArrowPosition[] =>
    params.routingMode === "orthogonal"
      ? calculateOrthogonalArrows(params, spacing)
      : calculateBezierArrows(params, spacing);

  const calculateInsertionHandles = (
    params: ConnectionPathParams,
  ): RoutingInsertionHandle[] =>
    params.routingMode === "orthogonal"
      ? calculateOrthogonalInsertionHandles(params)
      : calculateBezierInsertionHandles(params);

  return {
    calculatePathData,
    calculateMultipleArrowPositions,
    calculateInsertionHandles,
    calculateRoutingControlPoints,
  };
}
