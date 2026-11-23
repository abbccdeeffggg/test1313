import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MODEL_NAME = 'gemini-4-hydrogen';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY가 설정되어 있지 않습니다. Settings > Secrets 패널을 확인해 주세요.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const IDENTIFICATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    needsConfirmation: {
      type: Type.BOOLEAN,
      description: 'True if product model or battery specs are ambiguous and user should confirm.',
    },
    uncertaintyReason: {
      type: Type.STRING,
      description: 'Short Korean explanation when needsConfirmation is true.',
    },
    candidates: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: 'Korean product display name' },
          manufacturer: { type: Type.STRING },
          modelNumber: { type: Type.STRING },
          category: {
            type: Type.STRING,
            description: 'One of: mouse, clock, lighting, keyboard, remote, lock, sensor, appliance, other',
          },
          batteryType: {
            type: Type.STRING,
            description: 'One of: AA, AAA, C, D, 9V, CR2032, CR2025, CR2016, OTHER',
          },
          batteryChemistry: {
            type: Type.STRING,
            description: 'One of: alkaline, lithium, nimh, zinc_carbon',
          },
          batteryCount: { type: Type.INTEGER },
          consumptionProfile: {
            type: Type.STRING,
            description: 'One of: constant_low, active_duty, event_peak',
          },
          standardLifeDays: {
            type: Type.NUMBER,
            description: 'Manufacturer rated battery life in days (0 if unknown)',
          },
          recommendedDailyHours: { type: Type.NUMBER },
          recommendedDailyCount: { type: Type.NUMBER },
          recommendedIntensity: {
            type: Type.STRING,
            description: 'One of: low, medium, high',
          },
          specSourceNote: {
            type: Type.STRING,
            description: 'Short Korean summary of manufacturer spec or basis',
          },
          confidenceScore: {
            type: Type.NUMBER,
            description: '0.0 to 1.0 confidence score',
          },
        },
        required: [
          'name',
          'manufacturer',
          'modelNumber',
          'category',
          'batteryType',
          'batteryChemistry',
          'batteryCount',
          'consumptionProfile',
          'recommendedDailyHours',
          'recommendedDailyCount',
          'recommendedIntensity',
          'specSourceNote',
          'confidenceScore',
        ],
      },
    },
  },
  required: ['needsConfirmation', 'candidates'],
};

const VALID_CATEGORIES = new Set([
  'mouse',
  'clock',
  'lighting',
  'keyboard',
  'remote',
  'lock',
  'sensor',
  'appliance',
  'other',
]);
const VALID_BATTERIES = new Set(['AA', 'AAA', 'C', 'D', '9V', 'CR2032', 'CR2025', 'CR2016', 'OTHER']);
const VALID_CHEMISTRIES = new Set(['alkaline', 'lithium', 'nimh', 'zinc_carbon']);
const VALID_PROFILES = new Set(['constant_low', 'active_duty', 'event_peak']);
const VALID_INTENSITIES = new Set(['low', 'medium', 'high']);

function normalizeIdentificationPayload(raw: Record<string, unknown>) {
  const candidatesRaw = Array.isArray(raw.candidates) ? raw.candidates : [];
  const candidates = candidatesRaw.slice(0, 4).map((item) => {
    const c = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const cat = String(c.category || 'other');
    const bat = String(c.batteryType || 'AA').toUpperCase();
    const chem = String(c.batteryChemistry || 'alkaline');
    const prof = String(c.consumptionProfile || 'active_duty');
    const inten = String(c.recommendedIntensity || 'medium');
    const stdDays = Number(c.standardLifeDays);
    return {
      name: String(c.name || '미확인 전자제품').slice(0, 80),
      manufacturer: String(c.manufacturer || '미확인').slice(0, 80),
      modelNumber: String(c.modelNumber || '').slice(0, 80),
      category: VALID_CATEGORIES.has(cat) ? cat : 'other',
      batteryType: VALID_BATTERIES.has(bat) ? bat : 'AA',
      batteryChemistry: VALID_CHEMISTRIES.has(chem) ? chem : 'alkaline',
      batteryCount: Math.max(1, Math.min(24, Math.round(Number(c.batteryCount) || 1))),
      consumptionProfile: VALID_PROFILES.has(prof) ? prof : 'active_duty',
      standardLifeDays: Number.isFinite(stdDays) && stdDays > 0 ? Math.min(3650, Math.round(stdDays)) : null,
      recommendedDailyHours: Math.max(0, Math.min(24, Number(c.recommendedDailyHours) || 2)),
      recommendedDailyCount: Math.max(0, Math.min(1000, Number(c.recommendedDailyCount) || 10)),
      recommendedIntensity: VALID_INTENSITIES.has(inten) ? inten : 'medium',
      specSourceNote: String(c.specSourceNote || '제품군 평균 사양 기준').slice(0, 240),
      confidenceScore: Math.max(0, Math.min(1, Number(c.confidenceScore) || 0.6)),
    };
  });

  return {
    needsConfirmation: Boolean(raw.needsConfirmation) || candidates.length > 1 || candidates.length === 0,
    uncertaintyReason: raw.uncertaintyReason ? String(raw.uncertaintyReason).slice(0, 200) : undefined,
    candidates,
  };
}

function getErrorStatusAndMessage(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('GEMINI_API_KEY')) {
    return { status: 500, message: msg };
  }
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return { status: 429, message: 'AI 요청 한도가 초과되었습니다. 잠시 후 다시 시도해 주세요.' };
  }
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')) {
    return { status: 403, message: 'Gemini API 키 권한을 확인해 주세요 (Settings > Secrets).' };
  }
  return { status: 500, message: `AI 분석 요청 중 오류가 발생했습니다: ${msg}` };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/ai/identify-search', async (req: Request, res: Response) => {
    try {
      const query = String(req.body?.query || '').trim();
      if (!query || query.length > 120) {
        res.status(400).json({ error: '검색어를 1~120자 이내로 입력해 주세요.' });
        return;
      }

      const ai = getAiClient();

      // Step 1: Search Grounding to retrieve verified manufacturer battery specs
      const groundedResp = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: `사용자가 가정용 배터리 전자제품을 등록하려고 검색했습니다: "${query}"
제조사 공식 사양이나 신뢰할 수 있는 제품 스펙을 검색해서 다음 정보를 정리해 주세요:
1. 제품명, 제조사, 정확한 모델명(모호하면 가능한 2~3개 후보 제시)
2. 사용하는 교체형 건전지 규격(AA, AAA, C, D, 9V, CR2032, CR2025, CR2016 등), 개수, 권장 화학 종류
3. 제조사가 제시한 배터리 사용 시간(일수 환산 가능 시) 및 소비 특성(상시 저전력 / 사용 시간 비례 / 작동 횟수·고출력)
4. 확실하지 않거나 충전식 내장 제품일 가능성이 있으면 임의로 단정하지 말고 확인이 필요함을 명시하세요.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const groundedText = groundedResp.text ?? '';
      const chunks = groundedResp.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const sources = chunks
        .map((ch) => ch.web)
        .filter((w): w is { uri: string; title: string } => Boolean(w?.uri))
        .slice(0, 4)
        .map((w) => ({
          title: String(w.title || '참고 자료').slice(0, 80),
          uri: String(w.uri),
        }));

      // Step 2: Structure the verified findings strictly into schema JSON
      const structuredResp = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: `다음 검색 결과를 AA+ 배터리 수명 예측용 JSON 구조로 변환하세요.
검색어: "${query}"
수집된 사양 요약:
${groundedText}

규칙:
- 확실하지 않은 모델이거나 여러 변형 모델이 있으면 needsConfirmation=true로 두고 candidates에 최대 3개 후보를 담으세요.
- standardLifeDays는 공식 수치를 알 수 없으면 0으로 두세요(임의 날조 금지).
- category는 mouse, clock, lighting, keyboard, remote, lock, sensor, appliance, other 중 하나여야 합니다.
- batteryType은 AA, AAA, C, D, 9V, CR2032, CR2025, CR2016, OTHER 중 하나여야 합니다.
- consumptionProfile은 constant_low(벽시계·온습도계), active_duty(마우스·키보드), event_peak(조명·도어락·리모컨) 중 하나여야 합니다.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: IDENTIFICATION_SCHEMA,
        },
      });

      const parsed = JSON.parse((structuredResp.text ?? '{}').trim()) as Record<string, unknown>;
      const normalized = normalizeIdentificationPayload(parsed);
      res.json({ ...normalized, sources });
    } catch (err) {
      const { status, message } = getErrorStatusAndMessage(err);
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/ai/identify-photo', async (req: Request, res: Response) => {
    try {
      const imageBase64 = String(req.body?.imageBase64 || '').trim();
      const mimeType = String(req.body?.mimeType || 'image/jpeg').trim();
      const hint = String(req.body?.hint || '').trim().slice(0, 100);

      if (!imageBase64 || imageBase64.length > 10_000_000) {
        res.status(400).json({ error: '유효한 제품 이미지 데이터를 전송해 주세요.' });
        return;
      }

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
            {
              text: `사진 속 가정용 전자제품(또는 제품 라벨/배터리실)을 분석해 주세요.${hint ? ` 사용자 힌트: "${hint}"` : ''}
제품 종류, 제조사, 모델명을 식별하고 배터리 규격(AA, AAA, C, D, 9V, CR2032 등), 개수, 소비 특성을 JSON으로 정리하세요.
사진만으로 정확한 모델명이나 배터리 개수가 불확실하면 절대 임의로 단정하지 말고 needsConfirmation=true와 uncertaintyReason에 확인이 필요한 항목을 한국어로 적어주세요.`,
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: IDENTIFICATION_SCHEMA,
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
      const normalized = normalizeIdentificationPayload(parsed);
      res.json({ ...normalized, sources: [] });
    } catch (err) {
      const { status, message } = getErrorStatusAndMessage(err);
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/ai/recommend-usage', async (req: Request, res: Response) => {
    try {
      const deviceName = String(req.body?.deviceName || '').trim().slice(0, 80);
      const category = String(req.body?.category || 'other').trim().slice(0, 40);
      const batteryType = String(req.body?.batteryType || 'AA').trim().slice(0, 20);
      const unknownFields = Array.isArray(req.body?.unknownFields) ? req.body.unknownFields : [];

      if (!deviceName) {
        res.status(400).json({ error: '제품명이 필요합니다.' });
        return;
      }

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: `사용자가 "${deviceName}" (분류: ${category}, 배터리: ${batteryType})을 등록하면서 다음 항목에 대해 "잘 모르겠음"을 선택했습니다: ${unknownFields.join(', ') || '전반적 사용 패턴'}.
일반 가정 환경에서의 현실적인 하루 평균 사용 시간(dailyHours, 0~24), 하루 사용 횟수(dailyCount), 사용 강도(intensity: low/medium/high) 추천값과 짧은 한국어 추천 근거(rationale)를 반환하세요.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              dailyHours: { type: Type.NUMBER },
              dailyCount: { type: Type.NUMBER },
              intensity: {
                type: Type.STRING,
                description: 'One of: low, medium, high',
              },
              rationale: {
                type: Type.STRING,
                description: 'Concise 1-2 sentence Korean explanation for the recommended defaults',
              },
            },
            required: ['dailyHours', 'dailyCount', 'intensity', 'rationale'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
      const inten = String(parsed.intensity || 'medium');
      res.json({
        dailyHours: Math.max(0, Math.min(24, Number(parsed.dailyHours) || 2)),
        dailyCount: Math.max(0, Math.min(1000, Number(parsed.dailyCount) || 10)),
        intensity: VALID_INTENSITIES.has(inten) ? inten : 'medium',
        rationale: String(parsed.rationale || '일반 가정 평균 사용 패턴 기준 추천값입니다.').slice(0, 220),
      });
    } catch (err) {
      const { status, message } = getErrorStatusAndMessage(err);
      res.status(status).json({ error: message });
    }
  });

  app.get('/aa-plus.zip', (_req: Request, res: Response) => {
    const zipPath = path.resolve(__dirname, 'aa-plus.zip');
    if (fs.existsSync(zipPath)) {
      res.download(zipPath, 'aa-plus.zip');
    } else {
      res.status(404).json({ error: 'aa-plus.zip 파일을 찾을 수 없습니다.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AA+ server running at http://0.0.0.0:${PORT}`);
  });
}

void startServer();
