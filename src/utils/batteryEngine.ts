import type {
  BatteryChemistry,
  BatteryType,
  ConsumptionProfile,
  DeviceItem,
  PredictionConfidence,
  UnknownFieldKey,
  UsageIntensity,
} from '../types/aaPlus';

export const BATTERY_CAPACITY_MAH: Record<BatteryType, Record<BatteryChemistry, number>> = {
  AA: { alkaline: 2400, lithium: 3000, nimh: 2000, zinc_carbon: 950 },
  AAA: { alkaline: 1100, lithium: 1250, nimh: 850, zinc_carbon: 450 },
  C: { alkaline: 7800, lithium: 8500, nimh: 4500, zinc_carbon: 3200 },
  D: { alkaline: 15000, lithium: 18000, nimh: 10000, zinc_carbon: 6500 },
  '9V': { alkaline: 550, lithium: 1200, nimh: 250, zinc_carbon: 350 },
  CR2032: { alkaline: 160, lithium: 225, nimh: 120, zinc_carbon: 120 },
  CR2025: { alkaline: 110, lithium: 160, nimh: 90, zinc_carbon: 90 },
  CR2016: { alkaline: 65, lithium: 90, nimh: 50, zinc_carbon: 50 },
  OTHER: { alkaline: 1500, lithium: 1800, nimh: 1200, zinc_carbon: 700 },
};

export const BATTERY_TYPE_LABELS: Record<BatteryType, string> = {
  AA: 'AA',
  AAA: 'AAA',
  C: 'C',
  D: 'D',
  '9V': '9V',
  CR2032: 'CR2032 코인셀',
  CR2025: 'CR2025 코인셀',
  CR2016: 'CR2016 코인셀',
  OTHER: '기타 규격',
};

export const CHEMISTRY_LABELS: Record<BatteryChemistry, string> = {
  alkaline: '알카라인',
  lithium: '리튬 (일차전지)',
  nimh: '니켈수소 충전지 (NiMH)',
  zinc_carbon: '망간 건전지',
};

export const PROFILE_LABELS: Record<ConsumptionProfile, string> = {
  constant_low: '상시 저전력 (일정 소비)',
  active_duty: '사용 시간 비례',
  event_peak: '작동 횟수 / 고출력 기반',
};

export const INTENSITY_LABELS: Record<UsageIntensity, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
};

const INTENSITY_MULTIPLIER: Record<UsageIntensity, number> = {
  low: 0.75,
  medium: 1.0,
  high: 1.4,
};

interface CategoryBaseline {
  activeMa: number;
  standbyMa: number;
  eventMah: number;
  refHours: number;
  refCount: number;
}

const CATEGORY_BASELINES: Record<string, CategoryBaseline> = {
  mouse: { activeMa: 10.5, standbyMa: 0.08, eventMah: 0.02, refHours: 4, refCount: 40 },
  keyboard: { activeMa: 4.2, standbyMa: 0.06, eventMah: 0.01, refHours: 5, refCount: 50 },
  clock: { activeMa: 0.28, standbyMa: 0.28, eventMah: 0, refHours: 24, refCount: 0 },
  lighting: { activeMa: 145, standbyMa: 0.05, eventMah: 3.5, refHours: 1.5, refCount: 12 },
  remote: { activeMa: 18, standbyMa: 0.03, eventMah: 0.15, refHours: 0.4, refCount: 20 },
  lock: { activeMa: 120, standbyMa: 0.45, eventMah: 2.2, refHours: 0.2, refCount: 10 },
  sensor: { activeMa: 0.85, standbyMa: 0.35, eventMah: 0.08, refHours: 24, refCount: 24 },
  appliance: { activeMa: 65, standbyMa: 0.12, eventMah: 1.2, refHours: 1, refCount: 10 },
  other: { activeMa: 25, standbyMa: 0.1, eventMah: 0.5, refHours: 2, refCount: 15 },
};

export function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysIso(baseIso: string, deltaDays: number): string {
  const parsed = new Date(`${baseIso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return getTodayIsoDate();
  }
  parsed.setDate(parsed.getDate() + deltaDays);
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(`${startIso.slice(0, 10)}T00:00:00`);
  const end = new Date(`${endIso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }
  const diffMs = end.getTime() - start.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export interface CalculationInput {
  category: string;
  batteryType: BatteryType;
  batteryChemistry: BatteryChemistry;
  batteryCount: number;
  consumptionProfile: ConsumptionProfile;
  standardLifeDays?: number | null;
  dailyHours: number;
  dailyCount: number;
  intensity: UsageIntensity;
  calibrationFactor?: number;
  unknownFields?: UnknownFieldKey[];
  hasReplacementHistory?: boolean;
}

export interface CalculationResult {
  effectiveCapacityMah: number;
  estimatedDailyMah: number;
  predictedTotalDays: number;
  confidence: PredictionConfidence;
}

export function calculateBatteryPrediction(input: CalculationInput): CalculationResult {
  const perCellMah =
    BATTERY_CAPACITY_MAH[input.batteryType]?.[input.batteryChemistry] ??
    BATTERY_CAPACITY_MAH.OTHER.alkaline;

  // Multi-cell devices split energy across series/parallel packs; effective capacity
  // scales sub-linearly when voltage doubles in series, or linearly in parallel.
  // Using a conservative 0.72 power factor reflects realistic household series+buck efficiency.
  const count = Math.max(1, Math.min(24, Math.round(input.batteryCount || 1)));
  const effectiveMultiplier = count === 1 ? 1 : 1 + (count - 1) * 0.72;
  const effectiveCapacityMah = Math.round(perCellMah * effectiveMultiplier);

  const baseline = CATEGORY_BASELINES[input.category] ?? CATEGORY_BASELINES.other;
  const intensityMul = INTENSITY_MULTIPLIER[input.intensity] ?? 1.0;
  const safeHours = Math.max(0, Math.min(24, Number(input.dailyHours) || 0));
  const safeCount = Math.max(0, Math.min(10000, Number(input.dailyCount) || 0));

  let baseDailyMah: number;

  if (input.standardLifeDays && input.standardLifeDays > 0) {
    const mfgDailyMah = effectiveCapacityMah / input.standardLifeDays;

    if (input.consumptionProfile === 'constant_low') {
      baseDailyMah = mfgDailyMah * (0.88 + 0.12 * intensityMul);
    } else if (input.consumptionProfile === 'active_duty') {
      const hourRatio = baseline.refHours > 0 ? safeHours / baseline.refHours : 1;
      const clampedHourRatio = Math.max(0.15, Math.min(4.5, hourRatio));
      baseDailyMah = mfgDailyMah * (0.12 + 0.88 * clampedHourRatio * intensityMul);
    } else {
      const countRatio = baseline.refCount > 0 ? safeCount / baseline.refCount : 1;
      const hourRatio = baseline.refHours > 0 ? safeHours / baseline.refHours : 1;
      const combinedRatio = Math.max(0.2, Math.min(5.0, 0.55 * countRatio + 0.45 * hourRatio));
      baseDailyMah = mfgDailyMah * (0.1 + 0.9 * combinedRatio * intensityMul);
    }
  } else {
    if (input.consumptionProfile === 'constant_low') {
      baseDailyMah = baseline.standbyMa * 24 * (0.9 + 0.1 * intensityMul);
    } else if (input.consumptionProfile === 'active_duty') {
      const activeMah = baseline.activeMa * safeHours * intensityMul;
      const standbyMah = baseline.standbyMa * Math.max(0, 24 - safeHours);
      baseDailyMah = activeMah + standbyMah;
    } else {
      const eventMah = baseline.eventMah * safeCount * intensityMul;
      const activeMah = baseline.activeMa * Math.min(safeHours, 6) * 0.35 * intensityMul;
      const standbyMah = baseline.standbyMa * 24;
      baseDailyMah = eventMah + activeMah + standbyMah;
    }
  }

  const calFactor = Math.max(0.25, Math.min(4.0, input.calibrationFactor ?? 1.0));
  const estimatedDailyMah = Number(Math.max(0.5, baseDailyMah * calFactor).toFixed(2));
  const predictedTotalDays = Math.max(1, Math.min(3650, Math.round(effectiveCapacityMah / estimatedDailyMah)));

  const unknownCount = input.unknownFields?.length ?? 0;
  let confidence: PredictionConfidence = 'medium';
  if (input.hasReplacementHistory || (input.standardLifeDays && unknownCount <= 1)) {
    confidence = 'high';
  } else if (!input.standardLifeDays && unknownCount >= 2) {
    confidence = 'low';
  }

  return {
    effectiveCapacityMah,
    estimatedDailyMah,
    predictedTotalDays,
    confidence,
  };
}

export function getRemainingDays(device: Pick<DeviceItem, 'lastReplacedAt' | 'predictedTotalDays'>): number {
  const elapsed = daysBetween(device.lastReplacedAt, getTodayIsoDate());
  return Math.max(0, Math.round(device.predictedTotalDays - elapsed));
}

export type BatteryStatus = 'normal' | 'warning' | 'critical';

export function getBatteryStatus(remainingDays: number): BatteryStatus {
  if (remainingDays <= 0) return 'critical';
  if (remainingDays <= 10) return 'warning';
  return 'normal';
}

export function recalibrateFromReplacement(params: {
  previousPredictedDays: number;
  actualDaysLasted: number;
  currentCalibrationFactor: number;
}): number {
  const safePredicted = Math.max(1, params.previousPredictedDays);
  const safeActual = Math.max(1, params.actualDaysLasted);
  const impliedFactor = (safePredicted / safeActual) * params.currentCalibrationFactor;
  const clampedImplied = Math.max(0.3, Math.min(3.5, impliedFactor));
  const updated = 0.55 * params.currentCalibrationFactor + 0.45 * clampedImplied;
  return Number(Math.max(0.25, Math.min(4.0, updated)).toFixed(3));
}
