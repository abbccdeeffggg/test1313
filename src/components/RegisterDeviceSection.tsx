import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  Camera,
  Check,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Loader2,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  BatteryChemistry,
  BatteryType,
  ConsumptionProfile,
  DeviceCategory,
  DeviceIdentificationCandidate,
  DeviceIdentificationResponse,
  DeviceItem,
  UnknownFieldKey,
  UsageIntensity,
  UsagePreset,
  UsageRecommendationResponse,
} from '../types/aaPlus';
import {
  BATTERY_TYPE_LABELS,
  CHEMISTRY_LABELS,
  INTENSITY_LABELS,
  PROFILE_LABELS,
  calculateBatteryPrediction,
  daysBetween,
  getTodayIsoDate,
} from '../utils/batteryEngine';

interface RegisterDeviceSectionProps {
  presets: UsagePreset[];
  onRegisterDevice: (
    device: Omit<DeviceItem, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
  ) => Promise<unknown>;
  onSavePreset: (
    preset: Omit<UsagePreset, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
  ) => Promise<unknown>;
  onDeletePreset: (presetId: string) => Promise<void>;
}

const CATEGORY_OPTIONS: { value: DeviceCategory; label: string }[] = [
  { value: 'mouse', label: '마우스' },
  { value: 'keyboard', label: '키보드' },
  { value: 'clock', label: '벽시계 · 탁상시계' },
  { value: 'lighting', label: '무선 조명 · 스탠드' },
  { value: 'remote', label: '리모컨' },
  { value: 'lock', label: '도어락' },
  { value: 'sensor', label: '온습도 · 모션 센서' },
  { value: 'appliance', label: '소형 가전' },
  { value: 'other', label: '기타 전자제품' },
];

const SAMPLE_SEARCH_QUERIES = [
  '로지텍 M650 무선 마우스',
  '샤오미 블루투스 온습도계 2',
  '삼성 스마트 도어락',
  '무아스 LED 벽시계',
];

async function resizeImageToBase64(
  file: File,
): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const img = new Image();
      img.onerror = () => reject(new Error('지원하지 않는 이미지 형식입니다.'));
      img.onload = () => {
        const maxDim = 1024;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('이미지 처리 컨텍스트를 생성하지 못했습니다.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = compressedDataUrl.split(',')[1] || '';
        resolve({ base64, mimeType: 'image/jpeg', previewUrl: compressedDataUrl });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

type WizardStep = 1 | 2 | 3;

export function RegisterDeviceSection({
  presets,
  onRegisterDevice,
  onSavePreset,
  onDeletePreset,
}: RegisterDeviceSectionProps) {
  // null = collapsed 2-button entry screen
  const [inputMode, setInputMode] = useState<'search' | 'photo' | null>(null);
  const [step, setStep] = useState<WizardStep>(1);

  const [searchQuery, setSearchQuery] = useState('');
  const [photoHint, setPhotoHint] = useState('');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [identification, setIdentification] = useState<DeviceIdentificationResponse | null>(null);
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState<number>(0);

  // Camera capture state
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Device specification & hybrid usage state
  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [modelNumber, setModelNumber] = useState('');
  const [category, setCategory] = useState<DeviceCategory>('other');
  const [batteryType, setBatteryType] = useState<BatteryType>('AA');
  const [batteryChemistry, setBatteryChemistry] = useState<BatteryChemistry>('alkaline');
  const [batteryCount, setBatteryCount] = useState<number>(2);
  const [consumptionProfile, setConsumptionProfile] = useState<ConsumptionProfile>('active_duty');
  const [standardLifeDays, setStandardLifeDays] = useState<string>('');
  const [specSourceNote, setSpecSourceNote] = useState<string>('');

  const [dailyHours, setDailyHours] = useState<number>(2);
  const [dailyCount, setDailyCount] = useState<number>(10);
  const [intensity, setIntensity] = useState<UsageIntensity>('medium');
  const [lastReplacedAt, setLastReplacedAt] = useState<string>(getTodayIsoDate());
  const [unknownFields, setUnknownFields] = useState<UnknownFieldKey[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>('');

  // AI "잘 모르겠음" recommendation state
  const [isRecommending, setIsRecommending] = useState(false);
  const [aiRationale, setAiRationale] = useState<string | null>(null);

  // Save custom preset inline state
  const [showPresetForm, setShowPresetForm] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [presetMsg, setPresetMsg] = useState<string | null>(null);

  // Submit state
  const [isSaving, setIsSaving] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  };

  const resetWizard = () => {
    stopCamera();
    setInputMode(null);
    setStep(1);
    setSearchQuery('');
    setPhotoHint('');
    setPhotoPreview(null);
    setAiError(null);
    setFormError(null);
    setIdentification(null);
    setSelectedCandidateIdx(0);
    setName('');
    setManufacturer('');
    setModelNumber('');
    setCategory('other');
    setBatteryType('AA');
    setBatteryChemistry('alkaline');
    setBatteryCount(2);
    setConsumptionProfile('active_duty');
    setStandardLifeDays('');
    setSpecSourceNote('');
    setDailyHours(2);
    setDailyCount(10);
    setIntensity('medium');
    setLastReplacedAt(getTodayIsoDate());
    setUnknownFields([]);
    setActivePresetId('');
    setAiRationale(null);
    setShowPresetForm(false);
    setNewPresetName('');
  };

  const startMode = (mode: 'search' | 'photo') => {
    resetWizard();
    setRegisterSuccess(null);
    setInputMode(mode);
    setStep(1);
  };

  const applyCandidate = (cand: DeviceIdentificationCandidate) => {
    setName(cand.name);
    setManufacturer(cand.manufacturer);
    setModelNumber(cand.modelNumber);
    setCategory(cand.category);
    setBatteryType(cand.batteryType);
    setBatteryChemistry(cand.batteryChemistry);
    setBatteryCount(cand.batteryCount);
    setConsumptionProfile(cand.consumptionProfile);
    setStandardLifeDays(cand.standardLifeDays ? String(cand.standardLifeDays) : '');
    setSpecSourceNote(cand.specSourceNote);
    setDailyHours(cand.recommendedDailyHours);
    setDailyCount(cand.recommendedDailyCount);
    setIntensity(cand.recommendedIntensity);
    setActivePresetId('');
    setAiRationale(null);
  };

  const handleSearchAnalyze = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? searchQuery).trim();
    if (!q) {
      setAiError('제품명, 제조사 또는 모델명을 입력해 주세요.');
      return;
    }
    if (overrideQuery) setSearchQuery(overrideQuery);
    setAiError(null);
    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/ai/identify-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '제품 검색 분석에 실패했습니다.');
      }
      const typed = data as DeviceIdentificationResponse;
      setIdentification(typed);
      setSelectedCandidateIdx(0);
      if (typed.candidates.length > 0) {
        applyCandidate(typed.candidates[0]);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : '제품 검색 중 오류가 발생했습니다.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const analyzeBase64Photo = async (base64: string, mimeType: string) => {
    setAiError(null);
    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/ai/identify-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType,
          hint: photoHint.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '사진 인식에 실패했습니다.');
      }
      const typed = data as DeviceIdentificationResponse;
      setIdentification(typed);
      setSelectedCandidateIdx(0);
      if (typed.candidates.length > 0) {
        applyCandidate(typed.candidates[0]);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : '사진 분석 중 오류가 발생했습니다.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { base64, mimeType, previewUrl } = await resizeImageToBase64(file);
      setPhotoPreview(previewUrl);
      await analyzeBase64Photo(base64, mimeType);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : '이미지를 처리하지 못했습니다.');
    }
  };

  const openCamera = async () => {
    setAiError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 50);
    } catch {
      setAiError('카메라에 접근할 수 없습니다. 이미지 파일 업로드를 이용해 주세요.');
    }
  };

  const captureFromCamera = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.split(',')[1] || '';
    stopCamera();
    setPhotoPreview(dataUrl);
    await analyzeBase64Photo(base64, 'image/jpeg');
  };

  const toggleUnknownField = (field: UnknownFieldKey) => {
    setUnknownFields((prev) => {
      const exists = prev.includes(field);
      const next = exists ? prev.filter((f) => f !== field) : [...prev, field];
      if (!exists && field === 'lastReplacedAt') {
        setLastReplacedAt(getTodayIsoDate());
      }
      return next;
    });
  };

  const handleApplyAiRecommendations = async () => {
    if (!name.trim()) {
      setFormError('먼저 제품명을 입력해 주세요.');
      return;
    }
    setFormError(null);
    setIsRecommending(true);
    try {
      const targetFields =
        unknownFields.length > 0 ? unknownFields : ['dailyHours', 'dailyCount', 'intensity'];
      const res = await fetch('/api/ai/recommend-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceName: name.trim(),
          category,
          batteryType,
          unknownFields: targetFields,
        }),
      });
      const data = (await res.json()) as UsageRecommendationResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'AI 추천값을 가져오지 못했습니다.');
      }
      if (
        typeof data.dailyHours === 'number' &&
        (unknownFields.includes('dailyHours') || unknownFields.length === 0)
      ) {
        setDailyHours(data.dailyHours);
      }
      if (
        typeof data.dailyCount === 'number' &&
        (unknownFields.includes('dailyCount') || unknownFields.length === 0)
      ) {
        setDailyCount(data.dailyCount);
      }
      if (data.intensity && (unknownFields.includes('intensity') || unknownFields.length === 0)) {
        setIntensity(data.intensity);
      }
      setAiRationale(data.rationale);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'AI 추천값 조회 중 오류가 발생했습니다.');
    } finally {
      setIsRecommending(false);
    }
  };

  const handleSelectPreset = (presetId: string) => {
    setActivePresetId(presetId);
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    setDailyHours(preset.dailyHours);
    setDailyCount(preset.dailyCount);
    setIntensity(preset.intensity);
    setUnknownFields((prev) =>
      prev.filter((f) => f !== 'dailyHours' && f !== 'dailyCount' && f !== 'intensity'),
    );
    setAiRationale(`"${preset.name}" 프리셋 패턴이 적용되었습니다.`);
  };

  const handleSaveNewPreset = async () => {
    const trimmed = newPresetName.trim();
    if (!trimmed) return;
    await onSavePreset({
      name: trimmed,
      description: `하루 ${dailyHours}시간 · ${dailyCount}회 · 강도 ${INTENSITY_LABELS[intensity]}`,
      categoryHint: category,
      dailyHours,
      dailyCount,
      intensity,
    });
    setNewPresetName('');
    setShowPresetForm(false);
    setPresetMsg(`"${trimmed}" 프리셋이 저장되었습니다.`);
    setTimeout(() => setPresetMsg(null), 3500);
  };

  const livePrediction = useMemo(() => {
    const parsedStd = Number(standardLifeDays);
    return calculateBatteryPrediction({
      category,
      batteryType,
      batteryChemistry,
      batteryCount,
      consumptionProfile,
      standardLifeDays: Number.isFinite(parsedStd) && parsedStd > 0 ? parsedStd : null,
      dailyHours,
      dailyCount,
      intensity,
      calibrationFactor: 1.0,
      unknownFields,
      hasReplacementHistory: false,
    });
  }, [
    category,
    batteryType,
    batteryChemistry,
    batteryCount,
    consumptionProfile,
    standardLifeDays,
    dailyHours,
    dailyCount,
    intensity,
    unknownFields,
  ]);

  const liveRemainingDays = useMemo(() => {
    const elapsed = daysBetween(lastReplacedAt, getTodayIsoDate());
    return Math.max(0, Math.round(livePrediction.predictedTotalDays - elapsed));
  }, [lastReplacedAt, livePrediction.predictedTotalDays]);

  const handleSubmitDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('제품명을 입력해 주세요.');
      return;
    }
    setFormError(null);
    setIsSaving(true);
    try {
      const parsedStd = Number(standardLifeDays);
      const registeredName = name.trim();
      const predictedDays = liveRemainingDays;

      await onRegisterDevice({
        name: registeredName,
        manufacturer: manufacturer.trim() || undefined,
        modelNumber: modelNumber.trim() || undefined,
        category,
        batteryType,
        batteryChemistry,
        batteryCount,
        consumptionProfile,
        standardLifeDays: Number.isFinite(parsedStd) && parsedStd > 0 ? parsedStd : undefined,
        specSourceNote: specSourceNote.trim() || undefined,
        dailyHours,
        dailyCount,
        intensity,
        unknownFields,
        presetId: activePresetId || undefined,
        lastReplacedAt,
        calibrationFactor: 1.0,
        predictedTotalDays: livePrediction.predictedTotalDays,
        estimatedDailyMah: livePrediction.estimatedDailyMah,
        confidence: livePrediction.confidence,
      });

      resetWizard();
      setRegisterSuccess(
        `"${registeredName}" 등록 완료 — 예상 잔여 수명 ${predictedDays}일로 내 제품에 반영되었습니다.`,
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '제품 등록 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedPreset = presets.find((p) => p.id === activePresetId);

  return (
    <section id="register-device" className="scroll-mt-20 space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">제품 등록</h2>
        <p className="mt-1 text-sm text-slate-500">
          원하는 등록 방식을 선택하면 단계별로 제품 사양과 사용 환경을 간편하게 입력할 수 있습니다.
        </p>
      </div>

      {registerSuccess && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3 text-sm text-emerald-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{registerSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setRegisterSuccess(null)}
            className="text-xs font-medium text-emerald-800 hover:underline cursor-pointer shrink-0"
          >
            닫기
          </button>
        </div>
      )}

      {/* Initial State: Clean 2-button choice */}
      {inputMode === null ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => startMode('search')}
            className="group text-left bg-white border border-slate-200 hover:border-slate-400 rounded-xl p-6 transition-colors cursor-pointer flex items-start gap-4"
          >
            <div className="w-11 h-11 rounded-lg bg-slate-100 group-hover:bg-slate-900 group-hover:text-white text-slate-700 flex items-center justify-center transition-colors shrink-0">
              <Search className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-slate-900">제품 검색</h3>
              <p className="text-sm text-slate-500">제품명 · 제조사 · 모델명</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => startMode('photo')}
            className="group text-left bg-white border border-slate-200 hover:border-slate-400 rounded-xl p-6 transition-colors cursor-pointer flex items-start gap-4"
          >
            <div className="w-11 h-11 rounded-lg bg-slate-100 group-hover:bg-slate-900 group-hover:text-white text-slate-700 flex items-center justify-center transition-colors shrink-0">
              <Camera className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-slate-900">사진 등록</h3>
              <p className="text-sm text-slate-500">촬영 · 이미지 업로드</p>
            </div>
          </button>
        </div>
      ) : (
        /* Sequential 3-Step Registration Flow */
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          {/* Step Header Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={resetWizard}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                방식 선택으로
              </button>
              <span className="text-slate-300" aria-hidden="true">
                |
              </span>
              <span className="text-xs font-semibold text-slate-900">
                {inputMode === 'search' ? '제품 검색 등록' : '사진 촬영 · 업로드 등록'}
              </span>
            </div>

            {/* Step Indicator */}
            <ol className="flex items-center gap-2 text-xs">
              {[
                { num: 1 as WizardStep, label: '1. 제품 찾기' },
                { num: 2 as WizardStep, label: '2. 사양 확인' },
                { num: 3 as WizardStep, label: '3. 사용 환경' },
              ].map((s) => (
                <li key={s.num}>
                  <button
                    type="button"
                    onClick={() => {
                      if (s.num < step || (s.num === 2 && identification) || (s.num === 3 && name.trim())) {
                        setStep(s.num);
                      }
                    }}
                    className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap ${
                      step === s.num
                        ? 'bg-slate-900 text-white'
                        : step > s.num
                          ? 'bg-slate-100 text-slate-800 cursor-pointer hover:bg-slate-200'
                          : 'text-slate-400 cursor-default'
                    }`}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ol>
          </div>

          {/* STEP 1: Search or Photo Identification */}
          {step === 1 && (
            <div className="space-y-5">
              {inputMode === 'search' ? (
                <div className="space-y-3">
                  <label className="block text-sm font-semibold text-slate-900">
                    등록할 제품명이나 모델명을 입력하세요
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleSearchAnalyze();
                        }
                      }}
                      placeholder="예: 로지텍 M650, 무아스 벽시계, CR2032 체중계"
                      className="flex-1 px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                    <button
                      type="button"
                      disabled={isAnalyzing}
                      onClick={() => void handleSearchAnalyze()}
                      className="px-5 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 inline-flex items-center justify-center gap-2"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          사양 분석 중...
                        </>
                      ) : (
                        'AI 사양 검색'
                      )}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400">빠른 예시:</span>
                    {SAMPLE_SEARCH_QUERIES.map((sample) => (
                      <button
                        key={sample}
                        type="button"
                        onClick={() => void handleSearchAnalyze(sample)}
                        className="text-xs text-slate-600 hover:text-slate-900 underline underline-offset-2 cursor-pointer"
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <label className="block text-sm font-semibold text-slate-900">
                    제품 사진을 촬영하거나 이미지를 올려주세요
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    <div className="space-y-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      <div className="flex flex-wrap gap-2.5">
                        <button
                          type="button"
                          disabled={isAnalyzing}
                          onClick={() => fileInputRef.current?.click()}
                          className="px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-2"
                        >
                          <Upload className="w-4 h-4" />
                          이미지 업로드
                        </button>
                        <button
                          type="button"
                          disabled={isAnalyzing}
                          onClick={cameraOpen ? stopCamera : () => void openCamera()}
                          className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-2"
                        >
                          <Camera className="w-4 h-4" />
                          {cameraOpen ? '카메라 닫기' : '카메라 촬영'}
                        </button>
                      </div>

                      <input
                        type="text"
                        value={photoHint}
                        onChange={(e) => setPhotoHint(e.target.value)}
                        placeholder="선택 힌트 (예: 거실 무선 마우스)"
                        className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg"
                      />
                    </div>

                    <div>
                      {cameraOpen ? (
                        <div className="space-y-2">
                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            className="w-full aspect-[4/3] object-cover rounded-lg bg-slate-900"
                          />
                          <button
                            type="button"
                            onClick={() => void captureFromCamera()}
                            className="w-full py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
                          >
                            사진 찍고 AI 인식하기
                          </button>
                        </div>
                      ) : photoPreview ? (
                        <div className="relative aspect-[4/3] rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                          <img
                            src={photoPreview}
                            alt="업로드된 제품 미리보기"
                            className="w-full h-full object-contain"
                          />
                          {isAnalyzing && (
                            <div className="absolute inset-0 bg-white/80 flex items-center justify-center gap-2 text-sm font-medium text-slate-900">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              이미지 분석 중...
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="aspect-[4/3] rounded-lg border border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-center p-4 text-xs text-slate-500">
                          제품 정면이나 모델명 라벨이 보이게 올리면 AI가 배터리 규격을 찾아드립니다.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {aiError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
                  {aiError}
                </div>
              )}

              {identification && identification.candidates.length > 0 && (
                <div className="border border-slate-200 bg-slate-50/70 rounded-lg p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-900">
                      {identification.needsConfirmation
                        ? '확인이 필요한 식별 결과입니다 — 일치하는 모델을 선택하세요.'
                        : 'AI가 제품 사양을 식별했습니다.'}
                    </p>
                    {identification.uncertaintyReason && (
                      <span className="text-xs text-amber-700">
                        {identification.uncertaintyReason}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {identification.candidates.map((cand, idx) => {
                      const isSelected = idx === selectedCandidateIdx;
                      return (
                        <button
                          key={`${cand.name}-${idx}`}
                          type="button"
                          onClick={() => {
                            setSelectedCandidateIdx(idx);
                            applyCandidate(cand);
                          }}
                          className={`text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-white border-blue-600 ring-1 ring-blue-600'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-900 truncate">
                              {cand.name}
                            </p>
                            {isSelected && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            {cand.manufacturer} {cand.modelNumber}
                          </p>
                          <p className="text-xs text-slate-600 mt-1.5 tabular-nums">
                            {cand.batteryType} {cand.batteryCount}개 ·{' '}
                            {cand.standardLifeDays
                              ? `표준 ${cand.standardLifeDays}일`
                              : '표준 수명 미상'}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  {identification.sources && identification.sources.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-slate-500">
                      <span>참고 출처:</span>
                      {identification.sources.map((src) => (
                        <a
                          key={src.uri}
                          href={src.uri}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                        >
                          <span className="truncate max-w-[180px]">{src.title}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    if (!name.trim() && searchQuery.trim()) {
                      setName(searchQuery.trim());
                    }
                    setStep(2);
                  }}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900 underline underline-offset-2 cursor-pointer"
                >
                  검색 없이 직접 사양 입력하기
                </button>

                {identification && identification.candidates.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5"
                  >
                    다음: 사양 확인
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: Confirm / Edit Battery & Device Specifications */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  제품 정보와 배터리 사양을 확인해 주세요
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  AI가 찾은 정보 중 실제 제품과 다른 부분이 있다면 수정할 수 있습니다.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700">제품명 *</span>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="예: 서재 무선 마우스"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700">제조사</span>
                  <input
                    type="text"
                    maxLength={80}
                    value={manufacturer}
                    onChange={(e) => setManufacturer(e.target.value)}
                    placeholder="예: Logitech"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700">모델명</span>
                  <input
                    type="text"
                    maxLength={80}
                    value={modelNumber}
                    onChange={(e) => setModelNumber(e.target.value)}
                    placeholder="예: M650"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700">제품 분류</span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as DeviceCategory)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700">배터리 규격</span>
                  <select
                    value={batteryType}
                    onChange={(e) => setBatteryType(e.target.value as BatteryType)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {Object.entries(BATTERY_TYPE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700">배터리 개수</span>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={batteryCount}
                    onChange={(e) =>
                      setBatteryCount(Math.max(1, Math.min(24, Number(e.target.value) || 1)))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg tabular-nums"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700">배터리 화학 종류</span>
                  <select
                    value={batteryChemistry}
                    onChange={(e) => setBatteryChemistry(e.target.value as BatteryChemistry)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {Object.entries(CHEMISTRY_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700">소비 특성 모델</span>
                  <select
                    value={consumptionProfile}
                    onChange={(e) => setConsumptionProfile(e.target.value as ConsumptionProfile)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {Object.entries(PROFILE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700">
                    제조사 표준 수명 (일, 선택)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={3650}
                    value={standardLifeDays}
                    onChange={(e) => setStandardLifeDays(e.target.value)}
                    placeholder="모르면 비워두세요"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg tabular-nums"
                  />
                </label>

                {specSourceNote && (
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-slate-700 block">AI 사양 참고</span>
                    <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      {specSourceNote}
                    </p>
                  </div>
                )}
              </div>

              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
                  {formError}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setStep(1);
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer inline-flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  이전 단계
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!name.trim()) {
                      setFormError('제품명을 입력해 주세요.');
                      return;
                    }
                    setFormError(null);
                    setStep(3);
                  }}
                  className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5"
                >
                  다음: 사용 환경 입력
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Usage Environment (Direct + "잘 모르겠음" AI Recommend + Presets) & Submit */}
          {step === 3 && (
            <form onSubmit={handleSubmitDevice} className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    실제 사용 환경 입력
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    직접 입력하거나 프리셋을 불러오고, 모르는 항목은 &quot;잘 모르겠음&quot;을 눌러
                    AI 추천값을 적용하세요.
                  </p>
                </div>

                {/* Preset Bar */}
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    aria-label="사용 패턴 프리셋 선택"
                    value={activePresetId}
                    onChange={(e) => handleSelectPreset(e.target.value)}
                    className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700"
                  >
                    <option value="">프리셋 불러오기...</option>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.isBuiltIn ? `[기본] ${p.name}` : `[내 프리셋] ${p.name}`}
                      </option>
                    ))}
                  </select>

                  {selectedPreset && !selectedPreset.isBuiltIn && (
                    <button
                      type="button"
                      onClick={() => {
                        void onDeletePreset(selectedPreset.id);
                        setActivePresetId('');
                      }}
                      title="선택한 내 프리셋 삭제"
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-md cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowPresetForm((v) => !v)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <BookmarkPlus className="w-3.5 h-3.5" />
                    프리셋 저장
                  </button>
                </div>
              </div>

              {showPresetForm && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <input
                    type="text"
                    maxLength={60}
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    placeholder="새 프리셋 이름 (예: 안방 취침등 패턴)"
                    className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveNewPreset()}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md cursor-pointer"
                  >
                    현재 사용 패턴 저장
                  </button>
                </div>
              )}

              {presetMsg && <p className="text-xs text-emerald-700 font-medium">{presetMsg}</p>}

              <div className="border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 bg-slate-50/50">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">
                    모르는 항목은 &apos;잘 모르겠음&apos; 선택 후 AI 추천값을 적용할 수 있습니다
                  </span>
                  <button
                    type="button"
                    disabled={isRecommending}
                    onClick={() => void handleApplyAiRecommendations()}
                    className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5 w-fit"
                  >
                    {isRecommending ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        AI 추천값 산출 중...
                      </>
                    ) : (
                      <>
                        <HelpCircle className="w-3.5 h-3.5" />
                        AI 추천값 채우기
                      </>
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Daily Hours */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-700">하루 사용 시간</span>
                      <button
                        type="button"
                        onClick={() => toggleUnknownField('dailyHours')}
                        className={`text-[11px] font-medium px-2 py-0.5 rounded border cursor-pointer ${
                          unknownFields.includes('dailyHours')
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        잘 모르겠음
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={24}
                        step={0.5}
                        value={dailyHours}
                        onChange={(e) => {
                          setDailyHours(Math.max(0, Math.min(24, Number(e.target.value) || 0)));
                          setUnknownFields((p) => p.filter((f) => f !== 'dailyHours'));
                        }}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white tabular-nums"
                      />
                      <span className="text-xs text-slate-500 shrink-0">시간</span>
                    </div>
                  </div>

                  {/* Daily Count */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-700">하루 사용 횟수</span>
                      <button
                        type="button"
                        onClick={() => toggleUnknownField('dailyCount')}
                        className={`text-[11px] font-medium px-2 py-0.5 rounded border cursor-pointer ${
                          unknownFields.includes('dailyCount')
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        잘 모르겠음
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={10000}
                        value={dailyCount}
                        onChange={(e) => {
                          setDailyCount(Math.max(0, Number(e.target.value) || 0));
                          setUnknownFields((p) => p.filter((f) => f !== 'dailyCount'));
                        }}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white tabular-nums"
                      />
                      <span className="text-xs text-slate-500 shrink-0">회</span>
                    </div>
                  </div>

                  {/* Intensity */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-700">사용 강도</span>
                      <button
                        type="button"
                        onClick={() => toggleUnknownField('intensity')}
                        className={`text-[11px] font-medium px-2 py-0.5 rounded border cursor-pointer ${
                          unknownFields.includes('intensity')
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        잘 모르겠음
                      </button>
                    </div>
                    <div className="flex gap-1 p-1 bg-slate-200/70 rounded-lg">
                      {(['low', 'medium', 'high'] as UsageIntensity[]).map((level) => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => {
                            setIntensity(level);
                            setUnknownFields((p) => p.filter((f) => f !== 'intensity'));
                          }}
                          className={`flex-1 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                            intensity === level
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600'
                          }`}
                        >
                          {INTENSITY_LABELS[level]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Last Replaced Date */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-700">마지막 교체일</span>
                      <button
                        type="button"
                        onClick={() => toggleUnknownField('lastReplacedAt')}
                        className={`text-[11px] font-medium px-2 py-0.5 rounded border cursor-pointer ${
                          unknownFields.includes('lastReplacedAt')
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        잘 모르겠음
                      </button>
                    </div>
                    <input
                      type="date"
                      value={lastReplacedAt}
                      max={getTodayIsoDate()}
                      onChange={(e) => {
                        setLastReplacedAt(e.target.value);
                        setUnknownFields((p) => p.filter((f) => f !== 'lastReplacedAt'));
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white tabular-nums"
                    />
                  </div>
                </div>

                {aiRationale && (
                  <p className="text-xs text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2">
                    <span className="font-semibold text-slate-900">추천 안내:</span> {aiRationale}
                  </p>
                )}
              </div>

              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
                  {formError}
                </div>
              )}

              {/* Live Deterministic Calculation Preview & Submit */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-3 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-6 text-xs">
                  <div>
                    <span className="text-slate-500 block">예상 잔여 수명</span>
                    <span
                      className="text-xl font-bold text-slate-900 tabular-nums"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {liveRemainingDays}일
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">총 예상 수명</span>
                    <span
                      className="text-base font-semibold text-slate-800 tabular-nums"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {livePrediction.predictedTotalDays}일
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">일일 추정 소비량</span>
                    <span
                      className="text-base font-semibold text-slate-800 tabular-nums"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {livePrediction.estimatedDailyMah} mAh/일
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="px-4 py-2.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    이전
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-6 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {isSaving ? '등록 중...' : '제품 등록하기'}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
