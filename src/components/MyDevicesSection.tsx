import { useMemo, useState } from 'react';
import { Battery, Clock, Cpu, Lamp, Lock, Mouse, Radio, Search, Tv } from 'lucide-react';
import type { DeviceItem } from '../types/aaPlus';
import { BATTERY_TYPE_LABELS, getRemainingDays } from '../utils/batteryEngine';

interface MyDevicesSectionProps {
  devices: DeviceItem[];
  isLoading: boolean;
  onSelectDevice: (device: DeviceItem) => void;
}

type FilterBucket = 'all' | 'AA' | 'AAA' | 'COIN' | 'OTHER';

function CategoryFallbackIcon({ category }: { category: string }) {
  const iconClass = 'w-10 h-10 text-slate-400';
  switch (category) {
    case 'mouse':
      return <Mouse className={iconClass} strokeWidth={1.5} />;
    case 'clock':
      return <Clock className={iconClass} strokeWidth={1.5} />;
    case 'lighting':
      return <Lamp className={iconClass} strokeWidth={1.5} />;
    case 'lock':
      return <Lock className={iconClass} strokeWidth={1.5} />;
    case 'remote':
      return <Tv className={iconClass} strokeWidth={1.5} />;
    case 'sensor':
      return <Radio className={iconClass} strokeWidth={1.5} />;
    case 'keyboard':
    case 'appliance':
      return <Cpu className={iconClass} strokeWidth={1.5} />;
    default:
      return <Battery className={iconClass} strokeWidth={1.5} />;
  }
}

function DeviceThumbnail({ device }: { device: DeviceItem }) {
  const [imgFailed, setImgFailed] = useState(false);

  if (device.imageUrl && !imgFailed) {
    return (
      <img
        src={device.imageUrl}
        alt={device.name}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
      />
    );
  }

  return (
    <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-50 flex flex-col items-center justify-center gap-2 p-4">
      <CategoryFallbackIcon category={device.category} />
      <span className="text-xs font-medium text-slate-400 truncate max-w-full">
        {device.manufacturer || device.name}
      </span>
    </div>
  );
}

export function MyDevicesSection({
  devices,
  isLoading,
  onSelectDevice,
}: MyDevicesSectionProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBucket, setFilterBucket] = useState<FilterBucket>('all');

  const filteredDevices = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return devices
      .filter((dev) => {
        if (filterBucket === 'AA' && dev.batteryType !== 'AA') return false;
        if (filterBucket === 'AAA' && dev.batteryType !== 'AAA') return false;
        if (
          filterBucket === 'COIN' &&
          !['CR2032', 'CR2025', 'CR2016'].includes(dev.batteryType)
        ) {
          return false;
        }
        if (
          filterBucket === 'OTHER' &&
          ['AA', 'AAA', 'CR2032', 'CR2025', 'CR2016'].includes(dev.batteryType)
        ) {
          return false;
        }
        if (!q) return true;
        return (
          dev.name.toLowerCase().includes(q) ||
          (dev.manufacturer ?? '').toLowerCase().includes(q) ||
          (dev.modelNumber ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => getRemainingDays(a) - getRemainingDays(b));
  }, [devices, searchTerm, filterBucket]);

  const filterTabs: { id: FilterBucket; label: string }[] = [
    { id: 'all', label: '전체' },
    { id: 'AA', label: 'AA' },
    { id: 'AAA', label: 'AAA' },
    { id: 'COIN', label: '코인셀' },
    { id: 'OTHER', label: 'C·D·9V·기타' },
  ];

  return (
    <section id="my-devices" className="scroll-mt-20 space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            내 제품
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            등록된 제품의 남은 배터리 사용 기간을 확인하고 세부 정보를 관리하세요.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="제품명·모델명 검색"
              aria-label="등록된 제품 검색"
              className="w-full sm:w-52 pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          {/* Segmented Filter Control */}
          <div
            role="tablist"
            aria-label="배터리 규격 필터"
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto"
          >
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filterBucket === tab.id}
                onClick={() => setFilterBucket(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filterBucket === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden animate-pulse"
            >
              <div className="aspect-[4/3] bg-slate-100" />
              <div className="p-5 space-y-3">
                <div className="h-3.5 w-1/2 bg-slate-100 rounded" />
                <div className="h-5 w-2/3 bg-slate-100 rounded" />
                <div className="h-7 w-20 bg-slate-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredDevices.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <p className="text-base font-semibold text-slate-900">
            {devices.length === 0
              ? '아직 등록된 제품이 없습니다'
              : '조건에 일치하는 제품이 없습니다'}
          </p>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            {devices.length === 0
              ? '아래 제품 등록 섹션에서 제품명 검색 또는 사진 촬영으로 첫 번째 기기를 등록해 보세요.'
              : '검색어나 배터리 규격 필터를 조정해 주세요.'}
          </p>
          {devices.length === 0 ? (
            <a
              href="#register-device"
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
            >
              제품 등록으로 이동
            </a>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setFilterBucket('all');
              }}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              필터 초기화
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDevices.map((device) => {
            const remaining = getRemainingDays(device);
            const batteryLabel = BATTERY_TYPE_LABELS[device.batteryType] || device.batteryType;

            return (
              <button
                key={device.id}
                type="button"
                onClick={() => onSelectDevice(device)}
                className="group text-left bg-white border border-slate-200 hover:border-slate-300 rounded-xl overflow-hidden transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer flex flex-col"
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-slate-50 border-b border-slate-100">
                  <DeviceThumbnail device={device} />
                </div>

                <div className="p-5 flex-1 flex flex-col justify-between gap-4 w-full">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate">
                      <span>{device.manufacturer || '가정용 기기'}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {batteryLabel} {device.batteryCount}개
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 truncate">
                      {device.name}
                    </h3>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-baseline justify-between">
                    <span className="text-xs text-slate-500">예상 잔여 수명</span>
                    <span
                      className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {remaining}일
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
