import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, History, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type {
  BatteryChemistry,
  DeviceItem,
  ReplacementLog,
  UsageIntensity,
} from '../types/aaPlus';
import {
  BATTERY_TYPE_LABELS,
  CHEMISTRY_LABELS,
  INTENSITY_LABELS,
  PROFILE_LABELS,
  calculateBatteryPrediction,
  getBatteryStatus,
  getRemainingDays,
  getTodayIsoDate,
} from '../utils/batteryEngine';

interface DeviceDetailModalProps {
  device: DeviceItem | null;
  logs: ReplacementLog[];
  onClose: () => void;
  onUpdateDevice: (deviceId: string, updated: DeviceItem) => Promise<void>;
  onDeleteDevice: (deviceId: string) => Promise<void>;
  onLogReplacement: (params: {
    device: DeviceItem;
    replacedAt: string;
    chemistryUsed: BatteryChemistry;
    notes?: string;
  }) => Promise<unknown>;
}

const CONFIDENCE_LABELS: Record<DeviceItem['confidence'], string> = {
  high: '높음',
  medium: '보통',
  low: '낮음',
};

export function DeviceDetailModal({
  device,
  logs,
  onClose,
  onUpdateDevice,
  onDeleteDevice,
  onLogReplacement,
}: DeviceDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'replace' | 'edit'>('overview');
  const [replacedAt, setReplacedAt] = useState(getTodayIsoDate());
  const [chemistryUsed, setChemistryUsed] = useState<BatteryChemistry>('alkaline');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Edit usage state
  const [editHours, setEditHours] = useState(2);
  const [editCount, setEditCount] = useState(10);
  const [editIntensity, setEditIntensity] = useState<UsageIntensity>('medium');
  const [editLastReplaced, setEditLastReplaced] = useState(getTodayIsoDate());

  useEffect(() => {
    if (!device) return;
    setActiveTab('overview');
    setReplacedAt(getTodayIsoDate());
    setChemistryUsed(device.batteryChemistry);
    setNotes('');
    setFeedbackMsg(null);
    setConfirmDelete(false);
    setEditHours(device.dailyHours);
    setEditCount(device.dailyCount);
    setEditIntensity(device.intensity);
    setEditLastReplaced(device.lastReplacedAt);
  }, [device]);

  if (!device) return null;

  const remainingDays = getRemainingDays(device);
  const status = getBatteryStatus(remainingDays);
  const deviceLogs = logs.filter((l) => l.deviceId === device.id);

  const handleLogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedbackMsg(null);
    try {
      await onLogReplacement({
        device,
        replacedAt,
        chemistryUsed,
        notes,
      });
      setFeedbackMsg('배터리 교체 기록이 저장되었으며 예측 보정 계수가 업데이트되었습니다.');
      setActiveTab('overview');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedbackMsg(null);
    try {
      const calc = calculateBatteryPrediction({
        category: device.category,
        batteryType: device.batteryType,
        batteryChemistry: device.batteryChemistry,
        batteryCount: device.batteryCount,
        consumptionProfile: device.consumptionProfile,
        standardLifeDays: device.standardLifeDays,
        dailyHours: editHours,
        dailyCount: editCount,
        intensity: editIntensity,
        calibrationFactor: device.calibrationFactor,
        unknownFields: device.unknownFields,
        hasReplacementHistory: deviceLogs.length > 0,
      });
      await onUpdateDevice(device.id, {
        ...device,
        dailyHours: editHours,
        dailyCount: editCount,
        intensity: editIntensity,
        lastReplacedAt: editLastReplaced,
        predictedTotalDays: calc.predictedTotalDays,
        estimatedDailyMah: calc.estimatedDailyMah,
        confidence: calc.confidence,
      });
      setFeedbackMsg('사용 환경 설정과 예상 수명이 재계산되었습니다.');
      setActiveTab('overview');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setSubmitting(true);
    try {
      await onDeleteDevice(device.id);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="device-detail-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-start justify-between gap-4 z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>{device.manufacturer || '미지정 제조사'}</span>
              {device.modelNumber && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{device.modelNumber}</span>
                </>
              )}
            </div>
            <h2
              id="device-detail-title"
              className="text-xl font-bold text-slate-900 truncate mt-0.5"
            >
              {device.name}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="상세 창 닫기"
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* 10일 이하 교체 알림 (제품 상세 화면 전용) */}
          {status !== 'normal' && (
            <div
              className={`rounded-lg border px-4 py-3 flex items-start gap-3 ${
                status === 'critical'
                  ? 'bg-red-50 border-red-200 text-red-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <AlertTriangle
                className={`w-5 h-5 shrink-0 mt-0.5 ${
                  status === 'critical' ? 'text-red-600' : 'text-amber-600'
                }`}
              />
              <div className="text-sm space-y-0.5">
                <p className="font-semibold">
                  {status === 'critical'
                    ? '배터리 교체가 필요합니다 (예상 수명 만료)'
                    : `교체 임박 알림 — 예상 잔여 수명 ${remainingDays}일 남음`}
                </p>
                <p className="text-xs opacity-90">
                  교체용 {BATTERY_TYPE_LABELS[device.batteryType]} 건전지 {device.batteryCount}개를
                  준비해 주세요. 교체 후 아래에서 교체 기록을 남기면 다음 예측 정확도가 높아집니다.
                </p>
              </div>
            </div>
          )}

          {feedbackMsg && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 flex items-center gap-2 text-sm text-emerald-900">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{feedbackMsg}</span>
            </div>
          )}

          {/* Action Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                activeTab === 'overview'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              세부 정보 · 이력
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('replace')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                activeTab === 'replace'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              배터리 교체 기록
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('edit')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                activeTab === 'edit'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              사용 패턴 수정
            </button>
          </div>

          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Primary Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="border border-slate-200 rounded-lg p-3.5">
                  <p className="text-xs text-slate-500">예상 잔여 수명</p>
                  <p
                    className={`mt-1 text-2xl font-bold tabular-nums ${
                      status === 'critical'
                        ? 'text-red-600'
                        : status === 'warning'
                          ? 'text-amber-600'
                          : 'text-slate-900'
                    }`}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {remainingDays}일
                  </p>
                </div>
                <div className="border border-slate-200 rounded-lg p-3.5">
                  <p className="text-xs text-slate-500">하루 평균 소비량</p>
                  <p
                    className="mt-1 text-xl font-bold text-slate-900 tabular-nums"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {device.estimatedDailyMah}
                    <span className="text-xs font-normal text-slate-500 ml-1">mAh</span>
                  </p>
                </div>
                <div className="border border-slate-200 rounded-lg p-3.5">
                  <p className="text-xs text-slate-500">마지막 교체일</p>
                  <p
                    className="mt-1 text-sm font-semibold text-slate-900 tabular-nums"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {device.lastReplacedAt}
                  </p>
                </div>
                <div className="border border-slate-200 rounded-lg p-3.5">
                  <p className="text-xs text-slate-500">예측 신뢰도</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {CONFIDENCE_LABELS[device.confidence]}
                    <span className="text-xs font-normal text-slate-500 ml-1 tabular-nums">
                      (보정 ×{device.calibrationFactor.toFixed(2)})
                    </span>
                  </p>
                </div>
              </div>

              {/* Specification Table */}
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-sm">
                <div className="px-4 py-2.5 flex justify-between gap-4">
                  <span className="text-slate-500">배터리 규격 · 종류</span>
                  <span className="font-medium text-slate-900 text-right">
                    {BATTERY_TYPE_LABELS[device.batteryType]} × {device.batteryCount}개 (
                    {CHEMISTRY_LABELS[device.batteryChemistry]})
                  </span>
                </div>
                <div className="px-4 py-2.5 flex justify-between gap-4">
                  <span className="text-slate-500">소비 특성 모델</span>
                  <span className="font-medium text-slate-900 text-right">
                    {PROFILE_LABELS[device.consumptionProfile]}
                  </span>
                </div>
                <div className="px-4 py-2.5 flex justify-between gap-4">
                  <span className="text-slate-500">실제 사용 환경</span>
                  <span className="font-medium text-slate-900 text-right tabular-nums">
                    일 {device.dailyHours}시간 · {device.dailyCount}회 · 강도{' '}
                    {INTENSITY_LABELS[device.intensity]}
                  </span>
                </div>
                {device.specSourceNote && (
                  <div className="px-4 py-2.5 flex justify-between gap-4">
                    <span className="text-slate-500 shrink-0">사양 근거</span>
                    <span className="text-slate-700 text-right text-xs leading-relaxed">
                      {device.specSourceNote}
                    </span>
                  </div>
                )}
              </div>

              {/* Replacement History */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">배터리 교체 이력</h3>
                  <button
                    type="button"
                    onClick={() => setActiveTab('replace')}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
                  >
                    + 새 교체 기록 추가
                  </button>
                </div>
                {deviceLogs.length === 0 ? (
                  <p className="text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg p-4">
                    아직 기록된 교체 이력이 없습니다. 배터리를 교체할 때 기록을 남기면 실제 사용
                    일수를 반영해 예측 정확도가 개선됩니다.
                  </p>
                ) : (
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {deviceLogs.map((log) => (
                      <div
                        key={log.id}
                        className="px-4 py-3 flex items-center justify-between gap-4 text-xs"
                      >
                        <div className="space-y-0.5">
                          <p className="font-medium text-slate-900 tabular-nums">
                            {log.replacedAt} · {CHEMISTRY_LABELS[log.chemistryUsed]}
                          </p>
                          {log.notes && <p className="text-slate-500">{log.notes}</p>}
                        </div>
                        <div className="text-right tabular-nums shrink-0">
                          <p className="font-semibold text-slate-900">
                            실사용 {log.actualDaysLasted}일
                          </p>
                          <p className="text-slate-400">기존 예측 {log.previousPredictedDays}일</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Delete confirmation footer */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                {!confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    제품 삭제
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-600 font-medium">
                      정말 이 제품을 삭제할까요?
                    </span>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleDelete}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                    >
                      삭제 확인
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                    >
                      취소
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  닫기
                </button>
              </div>
            </div>
          )}

          {activeTab === 'replace' && (
            <form onSubmit={handleLogSubmit} className="space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                배터리를 새로 교체한 날짜와 종류를 기록하면 직전 장착일({device.lastReplacedAt})로부터
                실제 버틴 일수를 계산하여 소비량 보정 계수를 자동으로 업데이트합니다.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1.5 text-sm">
                  <span className="text-xs font-medium text-slate-700">배터리 교체 날짜</span>
                  <input
                    type="date"
                    required
                    value={replacedAt}
                    max={getTodayIsoDate()}
                    onChange={(e) => setReplacedAt(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums"
                  />
                </label>

                <label className="block space-y-1.5 text-sm">
                  <span className="text-xs font-medium text-slate-700">새로 넣은 배터리 종류</span>
                  <select
                    value={chemistryUsed}
                    onChange={(e) => setChemistryUsed(e.target.value as BatteryChemistry)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                  >
                    {Object.entries(CHEMISTRY_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block space-y-1.5 text-sm">
                <span className="text-xs font-medium text-slate-700">메모 (선택)</span>
                <input
                  type="text"
                  maxLength={200}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="예: 에너자이저 알카라인으로 교체"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('overview')}
                  className="px-4 py-2 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {submitting ? '저장 중...' : '교체 기록 저장 및 예측 보정'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'edit' && (
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-slate-700">
                    하루 평균 사용 시간 (시간)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    value={editHours}
                    onChange={(e) => setEditHours(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-slate-700">하루 사용 횟수 (회)</span>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={editCount}
                    onChange={(e) => setEditCount(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-slate-700 block">사용 강도</span>
                  <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
                    {(['low', 'medium', 'high'] as UsageIntensity[]).map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setEditIntensity(level)}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                          editIntensity === level
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600'
                        }`}
                      >
                        {INTENSITY_LABELS[level]}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-slate-700">마지막 교체일</span>
                  <input
                    type="date"
                    value={editLastReplaced}
                    max={getTodayIsoDate()}
                    onChange={(e) => setEditLastReplaced(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('overview')}
                  className="px-4 py-2 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {submitting ? '저장 중...' : '변경사항 저장'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
