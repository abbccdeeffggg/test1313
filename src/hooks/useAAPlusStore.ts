import { useCallback, useEffect, useState } from 'react';
import {
  type User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  createBuiltinPresets,
  createInitialDevices,
  createInitialLogs,
} from '../data/defaultData';
import {
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
} from '../firebase';
import type {
  BatteryChemistry,
  DeviceItem,
  ReplacementLog,
  UsagePreset,
} from '../types/aaPlus';
import {
  calculateBatteryPrediction,
  daysBetween,
  recalibrateFromReplacement,
} from '../utils/batteryEngine';

const LOCAL_DEVICES_KEY = 'aa_plus_local_devices_v1';
const LOCAL_PRESETS_KEY = 'aa_plus_local_presets_v1';
const LOCAL_LOGS_KEY = 'aa_plus_local_logs_v1';

function generateSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

function sanitizeDeviceForFirestore(
  device: Omit<DeviceItem, 'createdAt' | 'updatedAt'>,
  ownerId: string,
) {
  const cleanUnknowns = (device.unknownFields ?? [])
    .slice(0, 6)
    .map((f) => String(f).slice(0, 40));

  const payload: Record<string, unknown> = {
    ownerId,
    name: String(device.name || '전자제품').trim().slice(0, 80),
    category: String(device.category || 'other').trim().slice(0, 40),
    batteryType: device.batteryType,
    batteryChemistry: device.batteryChemistry,
    batteryCount: Math.max(1, Math.min(24, Math.round(Number(device.batteryCount) || 1))),
    consumptionProfile: device.consumptionProfile,
    dailyHours: Math.max(0, Math.min(24, Number(device.dailyHours) || 0)),
    dailyCount: Math.max(0, Math.min(10000, Number(device.dailyCount) || 0)),
    intensity: device.intensity,
    unknownFields: cleanUnknowns,
    lastReplacedAt: String(device.lastReplacedAt).slice(0, 32),
    calibrationFactor: Math.max(0.1, Math.min(10, Number(device.calibrationFactor) || 1)),
    predictedTotalDays: Math.max(0, Math.min(10000, Number(device.predictedTotalDays) || 1)),
    estimatedDailyMah: Math.max(0.01, Math.min(100000, Number(device.estimatedDailyMah) || 1)),
    confidence: device.confidence,
  };

  if (device.manufacturer) {
    payload.manufacturer = String(device.manufacturer).trim().slice(0, 80);
  }
  if (device.modelNumber) {
    payload.modelNumber = String(device.modelNumber).trim().slice(0, 80);
  }
  if (device.imageUrl && device.imageUrl.length <= 300) {
    payload.imageUrl = device.imageUrl;
  }
  if (typeof device.standardLifeDays === 'number' && Number.isFinite(device.standardLifeDays)) {
    payload.standardLifeDays = Math.max(0, Math.min(10000, device.standardLifeDays));
  }
  if (device.specSourceNote) {
    payload.specSourceNote = String(device.specSourceNote).trim().slice(0, 240);
  }
  if (device.presetId) {
    payload.presetId = String(device.presetId).trim().slice(0, 128);
  }

  return payload;
}

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function useAAPlusStore() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);

  const [devices, setDevices] = useState<DeviceItem[]>(() =>
    loadLocal(LOCAL_DEVICES_KEY, createInitialDevices()),
  );
  const [customPresets, setCustomPresets] = useState<UsagePreset[]>(() =>
    loadLocal(LOCAL_PRESETS_KEY, []),
  );
  const [replacementLogs, setReplacementLogs] = useState<ReplacementLog[]>(() =>
    loadLocal(LOCAL_LOGS_KEY, createInitialLogs()),
  );

  // Sync guest workspace to localStorage when signed out
  useEffect(() => {
    if (!authReady || user) return;
    try {
      localStorage.setItem(LOCAL_DEVICES_KEY, JSON.stringify(devices));
      localStorage.setItem(LOCAL_PRESETS_KEY, JSON.stringify(customPresets));
      localStorage.setItem(LOCAL_LOGS_KEY, JSON.stringify(replacementLogs));
    } catch {
      // Ignore storage quota errors in guest mode
    }
  }, [authReady, user, devices, customPresets, replacementLogs]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setDevices(loadLocal(LOCAL_DEVICES_KEY, createInitialDevices()));
        setCustomPresets(loadLocal(LOCAL_PRESETS_KEY, []));
        setReplacementLogs(loadLocal(LOCAL_LOGS_KEY, createInitialLogs()));
        setIsLoadingData(false);
      }
    });
    return () => unsub();
  }, []);

  // Ensure user profile & subscribe to Firestore collections when signed in
  useEffect(() => {
    if (!authReady || !user) return;

    const uid = user.uid;
    setIsLoadingData(true);

    const ensureUserProfileAndSeed = async () => {
      const profilePath = `users/${uid}`;
      const profileRef = doc(db, 'users', uid);
      try {
        const snap = await getDoc(profileRef);
        if (!snap.exists()) {
          await setDoc(profileRef, {
            ownerId: uid,
            displayName: (user.displayName || user.email?.split('@')[0] || 'AA+ 사용자').slice(0, 100),
            email: (user.email || '').slice(0, 200),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          // Seed initial household devices on very first sign-in so user sees immediate examples
          const batch = writeBatch(db);
          const initial = createInitialDevices(uid);
          for (const item of initial) {
            const devRef = doc(db, 'users', uid, 'devices', item.id);
            batch.set(devRef, {
              ...sanitizeDeviceForFirestore(item, uid),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          await batch.commit();
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, profilePath);
      }
    };

    void ensureUserProfileAndSeed();

    const devicesPath = `users/${uid}/devices`;
    const unsubDevices = onSnapshot(
      query(collection(db, 'users', uid, 'devices'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        const next: DeviceItem[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            ...(data as Omit<DeviceItem, 'id' | 'createdAt' | 'updatedAt'>),
            id: d.id,
          };
        });
        setDevices(next);
        setIsLoadingData(false);
      },
      (error) => {
        setIsLoadingData(false);
        handleFirestoreError(error, OperationType.LIST, devicesPath);
      },
    );

    const presetsPath = `users/${uid}/presets`;
    const unsubPresets = onSnapshot(
      query(collection(db, 'users', uid, 'presets'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        const next: UsagePreset[] = snapshot.docs.map((d) => ({
          ...(d.data() as Omit<UsagePreset, 'id' | 'createdAt' | 'updatedAt'>),
          id: d.id,
          isBuiltIn: false,
        }));
        setCustomPresets(next);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, presetsPath);
      },
    );

    const logsPath = `users/${uid}/replacementLogs`;
    const unsubLogs = onSnapshot(
      query(collection(db, 'users', uid, 'replacementLogs'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        const next: ReplacementLog[] = snapshot.docs.map((d) => ({
          ...(d.data() as Omit<ReplacementLog, 'id' | 'createdAt'>),
          id: d.id,
        }));
        setReplacementLogs(next);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, logsPath);
      },
    );

    return () => {
      unsubDevices();
      unsubPresets();
      unsubLogs();
    };
  }, [authReady, user]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(`Google 로그인 실패: ${msg}`);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setAuthError(null);
    try {
      await signOut(auth);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(`로그아웃 중 오류가 발생했습니다: ${msg}`);
    }
  }, []);

  const addDevice = useCallback(
    async (newDeviceInput: Omit<DeviceItem, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>) => {
      const id = generateSafeId('dev');
      if (!user) {
        const localItem: DeviceItem = {
          ...newDeviceInput,
          id,
          ownerId: 'local-household',
        };
        setDevices((prev) => [localItem, ...prev]);
        return localItem;
      }

      const path = `users/${user.uid}/devices/${id}`;
      try {
        const sanitized = sanitizeDeviceForFirestore(
          { ...newDeviceInput, id, ownerId: user.uid },
          user.uid,
        );
        await setDoc(doc(db, 'users', user.uid, 'devices', id), {
          ...sanitized,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return { ...newDeviceInput, id, ownerId: user.uid };
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    },
    [user],
  );

  const updateDevice = useCallback(
    async (deviceId: string, updated: DeviceItem) => {
      if (!user) {
        setDevices((prev) => prev.map((d) => (d.id === deviceId ? updated : d)));
        return;
      }

      const path = `users/${user.uid}/devices/${deviceId}`;
      try {
        const sanitized = sanitizeDeviceForFirestore(updated, user.uid);
        // Never overwrite createdAt during update; omit ownerId changes
        delete sanitized.ownerId;
        await updateDoc(doc(db, 'users', user.uid, 'devices', deviceId), {
          ...sanitized,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [user],
  );

  const deleteDevice = useCallback(
    async (deviceId: string) => {
      if (!user) {
        setDevices((prev) => prev.filter((d) => d.id !== deviceId));
        setReplacementLogs((prev) => prev.filter((l) => l.deviceId !== deviceId));
        return;
      }

      const path = `users/${user.uid}/devices/${deviceId}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'devices', deviceId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [user],
  );

  const logReplacement = useCallback(
    async (params: {
      device: DeviceItem;
      replacedAt: string;
      chemistryUsed: BatteryChemistry;
      notes?: string;
    }) => {
      const { device, replacedAt, chemistryUsed, notes } = params;
      const actualDaysLasted = Math.max(1, daysBetween(device.lastReplacedAt, replacedAt));
      const newCalibration = recalibrateFromReplacement({
        previousPredictedDays: device.predictedTotalDays,
        actualDaysLasted,
        currentCalibrationFactor: device.calibrationFactor,
      });

      const recalc = calculateBatteryPrediction({
        category: device.category,
        batteryType: device.batteryType,
        batteryChemistry: chemistryUsed,
        batteryCount: device.batteryCount,
        consumptionProfile: device.consumptionProfile,
        standardLifeDays: device.standardLifeDays,
        dailyHours: device.dailyHours,
        dailyCount: device.dailyCount,
        intensity: device.intensity,
        calibrationFactor: newCalibration,
        unknownFields: device.unknownFields,
        hasReplacementHistory: true,
      });

      const logId = generateSafeId('log');
      const logEntry: ReplacementLog = {
        id: logId,
        ownerId: user ? user.uid : 'local-household',
        deviceId: device.id,
        replacedAt,
        chemistryUsed,
        actualDaysLasted,
        previousPredictedDays: device.predictedTotalDays,
        notes: notes?.trim().slice(0, 200) || undefined,
      };

      const updatedDevice: DeviceItem = {
        ...device,
        batteryChemistry: chemistryUsed,
        lastReplacedAt: replacedAt,
        calibrationFactor: newCalibration,
        predictedTotalDays: recalc.predictedTotalDays,
        estimatedDailyMah: recalc.estimatedDailyMah,
        confidence: recalc.confidence,
      };

      if (!user) {
        setReplacementLogs((prev) => [logEntry, ...prev]);
        setDevices((prev) => prev.map((d) => (d.id === device.id ? updatedDevice : d)));
        return { logEntry, updatedDevice };
      }

      const batchPath = `users/${user.uid}/replacementLogs/${logId}`;
      try {
        const batch = writeBatch(db);
        const logPayload: Record<string, unknown> = {
          ownerId: user.uid,
          deviceId: device.id,
          replacedAt: replacedAt.slice(0, 32),
          chemistryUsed,
          actualDaysLasted,
          previousPredictedDays: device.predictedTotalDays,
          createdAt: serverTimestamp(),
        };
        if (logEntry.notes) {
          logPayload.notes = logEntry.notes;
        }
        batch.set(doc(db, 'users', user.uid, 'replacementLogs', logId), logPayload);

        const devPayload = sanitizeDeviceForFirestore(updatedDevice, user.uid);
        delete devPayload.ownerId;
        batch.update(doc(db, 'users', user.uid, 'devices', device.id), {
          ...devPayload,
          updatedAt: serverTimestamp(),
        });

        await batch.commit();
        return { logEntry, updatedDevice };
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, batchPath);
      }
    },
    [user],
  );

  const addPreset = useCallback(
    async (presetInput: Omit<UsagePreset, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>) => {
      const id = generateSafeId('preset');
      if (!user) {
        const localPreset: UsagePreset = {
          ...presetInput,
          id,
          ownerId: 'local-household',
          isBuiltIn: false,
        };
        setCustomPresets((prev) => [localPreset, ...prev]);
        return localPreset;
      }

      const path = `users/${user.uid}/presets/${id}`;
      try {
        const payload: Record<string, unknown> = {
          ownerId: user.uid,
          name: String(presetInput.name).trim().slice(0, 60),
          dailyHours: Math.max(0, Math.min(24, Number(presetInput.dailyHours) || 0)),
          dailyCount: Math.max(0, Math.min(10000, Number(presetInput.dailyCount) || 0)),
          intensity: presetInput.intensity,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (presetInput.description) {
          payload.description = String(presetInput.description).trim().slice(0, 160);
        }
        if (presetInput.categoryHint) {
          payload.categoryHint = String(presetInput.categoryHint).trim().slice(0, 40);
        }

        await setDoc(doc(db, 'users', user.uid, 'presets', id), payload);
        return { ...presetInput, id, ownerId: user.uid, isBuiltIn: false };
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    },
    [user],
  );

  const deletePreset = useCallback(
    async (presetId: string) => {
      if (!user) {
        setCustomPresets((prev) => prev.filter((p) => p.id !== presetId));
        return;
      }
      const path = `users/${user.uid}/presets/${presetId}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'presets', presetId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [user],
  );

  const allPresets: UsagePreset[] = [
    ...customPresets,
    ...createBuiltinPresets(user ? user.uid : 'local-household'),
  ];

  return {
    user,
    authReady,
    authError,
    isLoadingData,
    devices,
    allPresets,
    customPresets,
    replacementLogs,
    signInWithGoogle,
    signOutUser,
    addDevice,
    updateDevice,
    deleteDevice,
    logReplacement,
    addPreset,
    deletePreset,
  };
}
