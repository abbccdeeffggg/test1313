import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { BatteryType, DeviceItem } from '../types/aaPlus';
import {
  BATTERY_TYPE_LABELS,
  getBatteryStatus,
  getRemainingDays,
} from '../utils/batteryEngine';

interface DashboardSectionProps {
  devices: DeviceItem[];
  onSelectDevice: (device: DeviceItem) => void;
}

export function DashboardSection({ devices, onSelectDevice }: DashboardSectionProps) {
  const stats = useMemo(() => {
    const totalCount = devices.length;
    if (totalCount === 0) {
      return {
        totalCount: 0,
        avgRemainingDays: 0,
        lowBatteryCount: 0,
        totalDailyMah: 0,
        byBattery: [] as Array<{ type: BatteryType; deviceCount: number; cellCount: number }>,
        sortedDevices: [] as Array<{ device: DeviceItem; remaining: number }>,
      };
    }

    let sumRemaining = 0;
    let lowBatteryCount = 0;
    let totalDailyMah = 0;
    const batteryMap = new Map<BatteryType, { deviceCount: number; cellCount: number }>();

    const sortedDevices = devices
      .map((device) => {
        const remaining = getRemainingDays(device);
        sumRemaining += remaining;
        if (remaining <= 10) {
          lowBatteryCount += 1;
        }
        totalDailyMah += device.estimatedDailyMah;

        const existing = batteryMap.get(device.batteryType) ?? {
          deviceCount: 0,
          cellCount: 0,
        };
        batteryMap.set(device.batteryType, {
          deviceCount: existing.deviceCount + 1,
          cellCount: existing.cellCount + device.batteryCount,
        });

        return { device, remaining };
      })
      .sort((a, b) => a.remaining - b.remaining);

    const byBattery = Array.from(batteryMap.entries())
      .map(([type, counts]) => ({ type, ...counts }))
      .sort((a, b) => b.cellCount - a.cellCount);

    return {
      totalCount,
      avgRemainingDays: Math.floor(sumRemaining / totalCount),
      lowBatteryCount,
      totalDailyMah: Number(totalDailyMah.toFixed(1)),
      byBattery,
      sortedDevices,
    };
  }, [devices]);

  const maxTimelineDays = useMemo(() => {
    const maxVal = stats.sortedDevices.reduce(
      (acc, item) => Math.max(acc, item.remaining),
      30,
    );
    return Math.max(30, maxVal);
  }, [stats.sortedDevices]);

  return (
    <section id="dashboard" className="scroll-mt-20 space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">대시보드</h2>
        <p className="mt-1 text-sm text-slate-500">
          전체 제품의 배터리 상태, 평균 잔여 수명 및 규격별 소비 현황 요약입니다.
        </p>
      </div>

      {/* 4-column structured KPI summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <p className="text-xs font-medium text-slate-500">등록된 제품</p>
          <p
            className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {stats.totalCount}개
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <p className="text-xs font-medium text-slate-500">평균 예상 잔여 수명</p>
          <p
            className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {stats.avgRemainingDays}일
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <p className="text-xs font-medium text-slate-500">교체 임박 (10일 이하)</p>
          <div className="flex items-center gap-2">
            <p
              className={`text-3xl font-bold tracking-tight tabular-nums ${
                stats.lowBatteryCount > 0 ? 'text-amber-600' : 'text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {stats.lowBatteryCount}개
            </p>
            {stats.lowBatteryCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                점검 필요
              </span>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <p className="text-xs font-medium text-slate-500">일일 총 추정 소비량</p>
          <p
            className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {stats.totalDailyMah}
            <span className="text-sm font-normal text-slate-500 ml-1">mAh/일</span>
          </p>
        </div>
      </div>

      {/* Lifespan comparison + Battery inventory breakdown */}
      {stats.totalCount > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                제품별 잔여 수명 비교
              </h3>
              <span className="text-xs text-slate-500">잔여 일수 짧은 순</span>
            </div>

            <div className="divide-y divide-slate-100">
              {stats.sortedDevices.map(({ device, remaining }) => {
                const status = getBatteryStatus(remaining);
                const barWidth = Math.max(3, Math.min(100, Math.round((remaining / maxTimelineDays) * 100)));
                const barColor =
                  status === 'critical'
                    ? 'bg-red-600'
                    : status === 'warning'
                      ? 'bg-amber-500'
                      : 'bg-slate-900';
                const statusText =
                  status === 'critical'
                    ? '교체 필요'
                    : status === 'warning'
                      ? '교체 임박'
                      : '정상';
                const statusColor =
                  status === 'critical'
                    ? 'text-red-600'
                    : status === 'warning'
                      ? 'text-amber-700'
                      : 'text-emerald-700';

                return (
                  <button
                    key={device.id}
                    type="button"
                    onClick={() => onSelectDevice(device)}
                    className="w-full py-3 first:pt-1 last:pb-1 text-left hover:bg-slate-50/80 transition-colors rounded-lg px-2 -mx-2 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-4 text-sm mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-slate-900 truncate">
                          {device.name}
                        </span>
                        <span className="text-xs text-slate-400 shrink-0">
                          {device.batteryType} {device.batteryCount}개
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`text-xs font-medium ${statusColor}`}>
                          {statusText}
                        </span>
                        <span
                          className="text-sm font-semibold text-slate-900 tabular-nums w-14 text-right"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          {remaining}일
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              사용 중인 배터리 규격 현황
            </h3>
            <p className="text-xs text-slate-500">
              가정 내 기기들이 요구하는 규격별 총 건전지 수입니다.
            </p>
            <div className="divide-y divide-slate-100">
              {stats.byBattery.map((item) => (
                <div
                  key={item.type}
                  className="py-3 first:pt-1 last:pb-1 flex items-center justify-between text-sm"
                >
                  <div>
                    <p className="font-medium text-slate-900">
                      {BATTERY_TYPE_LABELS[item.type] || item.type}
                    </p>
                    <p className="text-xs text-slate-500">{item.deviceCount}개 제품</p>
                  </div>
                  <span
                    className="text-sm font-semibold text-slate-900 tabular-nums"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    총 {item.cellCount}개 장착
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
