export type BatteryType =
  | 'AA'
  | 'AAA'
  | 'C'
  | 'D'
  | '9V'
  | 'CR2032'
  | 'CR2025'
  | 'CR2016'
  | 'OTHER';

export type BatteryChemistry = 'alkaline' | 'lithium' | 'nimh' | 'zinc_carbon';

export type ConsumptionProfile = 'constant_low' | 'active_duty' | 'event_peak';

export type UsageIntensity = 'low' | 'medium' | 'high';

export type PredictionConfidence = 'high' | 'medium' | 'low';

export type DeviceCategory =
  | 'mouse'
  | 'clock'
  | 'lighting'
  | 'keyboard'
  | 'remote'
  | 'lock'
  | 'sensor'
  | 'appliance'
  | 'other';

export type UnknownFieldKey =
  | 'dailyHours'
  | 'dailyCount'
  | 'intensity'
  | 'batteryType'
  | 'batteryCount'
  | 'lastReplacedAt';

export interface DeviceItem {
  id: string;
  ownerId: string;
  name: string;
  manufacturer?: string;
  modelNumber?: string;
  category: DeviceCategory | string;
  imageUrl?: string;
  batteryType: BatteryType;
  batteryChemistry: BatteryChemistry;
  batteryCount: number;
  consumptionProfile: ConsumptionProfile;
  standardLifeDays?: number;
  specSourceNote?: string;
  dailyHours: number;
  dailyCount: number;
  intensity: UsageIntensity;
  unknownFields?: UnknownFieldKey[];
  presetId?: string;
  lastReplacedAt: string; // YYYY-MM-DD
  calibrationFactor: number;
  predictedTotalDays: number;
  estimatedDailyMah: number;
  confidence: PredictionConfidence;
  createdAt?: string;
  updatedAt?: string;
}

export interface UsagePreset {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  categoryHint?: string;
  dailyHours: number;
  dailyCount: number;
  intensity: UsageIntensity;
  isBuiltIn?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReplacementLog {
  id: string;
  ownerId: string;
  deviceId: string;
  replacedAt: string; // YYYY-MM-DD
  chemistryUsed: BatteryChemistry;
  actualDaysLasted: number;
  previousPredictedDays: number;
  notes?: string;
  createdAt?: string;
}

export interface DeviceIdentificationCandidate {
  name: string;
  manufacturer: string;
  modelNumber: string;
  category: DeviceCategory;
  batteryType: BatteryType;
  batteryChemistry: BatteryChemistry;
  batteryCount: number;
  consumptionProfile: ConsumptionProfile;
  standardLifeDays: number | null;
  recommendedDailyHours: number;
  recommendedDailyCount: number;
  recommendedIntensity: UsageIntensity;
  specSourceNote: string;
  confidenceScore: number; // 0..1
}

export interface DeviceIdentificationResponse {
  needsConfirmation: boolean;
  uncertaintyReason?: string;
  candidates: DeviceIdentificationCandidate[];
  sources?: Array<{ title: string; uri: string }>;
}

export interface UsageRecommendationResponse {
  dailyHours?: number;
  dailyCount?: number;
  intensity?: UsageIntensity;
  rationale: string;
}
