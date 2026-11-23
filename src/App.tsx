import { useState } from 'react';
import { DashboardSection } from './components/DashboardSection';
import { DeviceDetailModal } from './components/DeviceDetailModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MyDevicesSection } from './components/MyDevicesSection';
import { RegisterDeviceSection } from './components/RegisterDeviceSection';
import { TopBar } from './components/TopBar';
import { useAAPlusStore } from './hooks/useAAPlusStore';
import type { DeviceItem } from './types/aaPlus';

function AAPlusWorkspace() {
  const {
    user,
    authReady,
    authError,
    isLoadingData,
    devices,
    allPresets,
    replacementLogs,
    signInWithGoogle,
    signOutUser,
    addDevice,
    updateDevice,
    deleteDevice,
    logReplacement,
    addPreset,
    deletePreset,
  } = useAAPlusStore();

  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const selectedDevice: DeviceItem | null =
    devices.find((d) => d.id === selectedDeviceId) ?? null;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col">
      <TopBar
        user={user}
        authReady={authReady}
        onSignIn={signInWithGoogle}
        onSignOut={signOutUser}
      />

      {authError && (
        <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 pt-4">
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-xs text-red-800">
            {authError}
          </div>
        </div>
      )}

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-10 space-y-16">
        {/* 1. 내 제품 */}
        <MyDevicesSection
          devices={devices}
          isLoading={isLoadingData}
          onSelectDevice={(dev) => setSelectedDeviceId(dev.id)}
        />

        {/* 2. 제품 등록 */}
        <RegisterDeviceSection
          presets={allPresets}
          onRegisterDevice={addDevice}
          onSavePreset={addPreset}
          onDeletePreset={deletePreset}
        />

        {/* 3. 대시보드 */}
        <DashboardSection
          devices={devices}
          onSelectDevice={(dev) => setSelectedDeviceId(dev.id)}
        />
      </main>

      <footer className="border-t border-slate-200 bg-white py-6">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>AA+ — Household Battery Life Manager</span>
          <span>
            {user
              ? 'Google 계정으로 데이터가 안전하게 동기화되고 있습니다.'
              : '게스트 모드로 체험 중입니다. 상단 Google 로그인 시 기기 간 데이터가 영구 저장됩니다.'}
          </span>
        </div>
      </footer>

      <DeviceDetailModal
        device={selectedDevice}
        logs={replacementLogs}
        onClose={() => setSelectedDeviceId(null)}
        onUpdateDevice={updateDevice}
        onDeleteDevice={deleteDevice}
        onLogReplacement={logReplacement}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AAPlusWorkspace />
    </ErrorBoundary>
  );
}
