'use client';

import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  Eye,
  EyeOff,
  FileAudio,
  FileText,
  Headphones,
  KeyRound,
  LoaderCircle,
  Mic2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  UploadCloud,
  WandSparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import {
  correctStudyTranscript,
  correctionSignature,
  summarySignature,
  type CorrectionCache,
} from '@/lib/study-notes';
import type { ResilientCache } from '@/lib/study-resilient';
import {
  summarizeCompleteStudyNotes as summarizeStudyTranscriptResilient,
  validateCompleteCache as validateRecoveredNotes,
  composeCompleteNotes as recoveryExport,
  hasCompleteStudyNotes,
  canResumeSummaryWithModel,
  canResumeCorrectionWithModel,
} from '@/lib/generic-study';
import {
  CHECKPOINT_KEY,
  encodeCheckpoint,
  decodeCheckpoint,
  type StudyCheckpoint,
} from '@/lib/study-checkpoint';
import {
  MAX_FILE_MB,
  buildMarkdown,
  cleanTranscriptRepetition,
  extractChatContent,
  assertCompleteChatResponse,
  extractErrorMessage,
  extractTranscript,
  formatBytes,
  formatDuration,
  isBudgetExceededMessage,
  isModelLoadingMessage,
  isRetryableStatus,
  retryDelayMs,
  safeBaseName,
  splitTranscript,
  validateAudioFile,
} from '@/lib/iai-workflow';

const StudyMarkdown = lazy(() =>
  import('@/components/study-markdown').then((module) => ({
    default: module.StudyMarkdown,
  })),
);
const IAI_API_BASE = 'https://www.iai.nkust.edu.tw/aihub/v1';
const LOCAL_TEST_API_BASE = 'http://127.0.0.1:4174/v1';
const LOCAL_AUDIO_BRIDGE = '/api/audio';
const OFFICIAL_MODEL_LIST =
  'https://www.iai.nkust.edu.tw/iaibackend/api/admin/models';

type WizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type OutputMode = 'transcript' | 'summary';
type ApiState = 'idle' | 'checking' | 'ok' | 'error';
type BridgeState = 'checking' | 'ready' | 'error';
type Phase =
  | 'idle'
  | 'uploading'
  | 'transcribing'
  | 'waiting'
  | 'correcting'
  | 'summarizing'
  | 'reviewing'
  | 'merging'
  | 'done'
  | 'error'
  | 'cancelled';
type FailedStage = 'transcription' | 'correction' | 'summary' | null;
type ModelOption = {
  alias: string;
  proposedBase: string;
  input: number;
  output: number;
  use: string;
};
type StatusMessage = { title: string; detail: string };
type BridgeEvent = {
  type?: 'progress' | 'result' | 'error';
  stage?: 'preparing' | 'transcribing' | 'waiting';
  percent?: number;
  message?: string;
  text?: string;
  status?: number;
  retryAfter?: string | null;
  payload?: unknown;
  bridge?: Record<string, unknown>;
};
type WakeLockState = 'idle' | 'active' | 'unsupported' | 'error';
type WakeLockHandle = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
};
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockHandle> };
};
type WebMcpContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => Promise<Record<string, unknown>>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

const MODELS: ModelOption[] = [
  {
    alias: 'Nkust',
    proposedBase: 'Nkust',
    input: 0.09,
    output: 0.34,
    use: '高科校內專屬語言模型',
  },
  {
    alias: 'Furen-omni',
    proposedBase: 'nemotron-omni-30b',
    input: 0.1,
    output: 0.2,
    use: '多模態與一般整理',
  },
  {
    alias: 'Furen-std',
    proposedBase: 'nemotron-3-super-120b',
    input: 0.15,
    output: 0.3,
    use: '穩定、均衡的文字整理',
  },
  {
    alias: 'Furen-coder',
    proposedBase: 'nemotron-3-super-120b',
    input: 0.2,
    output: 0.4,
    use: '程式設計與技術課程',
  },
  {
    alias: 'Furen-large',
    proposedBase: 'nemotron-3-super-120b',
    input: 0.2,
    output: 0.4,
    use: '長篇內容與複雜脈絡',
  },
  {
    alias: 'Furen-max',
    proposedBase: 'nvidia-nemotron-3-ultra-550b-a55b',
    input: 0.5,
    output: 1,
    use: '最高階整理與推理',
  },
];
const STEP_LABELS = ['驗證', '錄音', '輸出', '要求', '處理', '結果'];

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function runtimeApiBase() {
  if (
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
    new URLSearchParams(window.location.search).get('testMode') === '1'
  ) {
    return LOCAL_TEST_API_BASE;
  }
  return '/api/iai';
}

async function waitWithCountdown(
  milliseconds: number,
  signal: AbortSignal,
  onTick: (seconds: number) => void,
) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    onTick(Math.max(1, Math.ceil((end - Date.now()) / 1000)));
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        resolve,
        Math.min(1000, end - Date.now()),
      );
      signal.addEventListener(
        'abort',
        () => {
          window.clearTimeout(timeout);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    });
  }
}

function StepBack({
  onClick,
  children = '上一步',
}: {
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button type="button" className="back-link" onClick={onClick}>
      <ArrowLeft size={16} />
      {children}
    </button>
  );
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  return (
    <Suspense fallback={<p>正在載入筆記排版…</p>}>
      <StudyMarkdown markdown={markdown} />
    </Suspense>
  );
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeXhrRef = useRef<XMLHttpRequest | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const correctionCacheRef = useRef<CorrectionCache | null>(null);
  const summaryCacheRef = useRef<ResilientCache | null>(null);
  const rawTranscriptRef = useRef('');
  const wakeLockRef = useRef<WakeLockHandle | null>(null);

  const [step, setStep] = useState<WizardStep>(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [apiState, setApiState] = useState<ApiState>('idle');
  const [apiMessage, setApiMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mode, setMode] = useState<OutputMode>('summary');
  const [model, setModel] = useState('Furen-std');
  const [customPrompt, setCustomPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState<StatusMessage>({
    title: '準備開始',
    detail: '錄音會在本機分段後送往高科 iAI。',
  });
  const [progress, setProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [failedStage, setFailedStage] = useState<FailedStage>(null);
  const [transcript, setTranscript] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [outputFilename, setOutputFilename] = useState('');
  const [copied, setCopied] = useState(false);
  const [isTestMode, setIsTestMode] = useState(false);
  const [bridgeState, setBridgeState] = useState<BridgeState>('checking');
  const [wakeLockState, setWakeLockState] = useState<WakeLockState>('idle');
  const [saveLocally, setSaveLocally] = useState(false);
  const [savedJob, setSavedJob] = useState<StudyCheckpoint | null>(null);
  const [saveWarning, setSaveWarning] = useState('');
  const [partialResult, setPartialResult] = useState(false);
  const [hasCompleteNotes, setHasCompleteNotes] = useState(false);
  const [hasPendingRecovery, setHasPendingRecovery] = useState(false);

  const syncSummaryUiState = () => {
    const cache = summaryCacheRef.current;
    setHasCompleteNotes(hasCompleteStudyNotes(cache));
    setHasPendingRecovery(
      Boolean(
        cache?.recovery?.pending.length ||
          cache?.recovery?.reader?.pending.length,
      ),
    );
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CHECKPOINT_KEY);
      if (saved) setSavedJob(decodeCheckpoint(saved));
    } catch {
      try {
        localStorage.removeItem(CHECKPOINT_KEY);
      } catch {
        /* unavailable storage */
      }
      setSaveWarning('本機復原資料已過期或無法讀取；仍可下載逐字稿與復原檔。');
    }
  }, []);

  const currentCheckpoint = (currentText = transcript): StudyCheckpoint => ({
    version: 1,
    savedAt: Date.now(),
    filename: file?.name ?? '錄音.m4a',
    model,
    mode,
    preference: customPrompt,
    raw: rawTranscriptRef.current,
    transcript:
      currentText ||
      correctionCacheRef.current?.parts.join('\n\n') ||
      rawTranscriptRef.current,
    correction: correctionCacheRef.current,
    summary: summaryCacheRef.current,
  });
  const saveCheckpoint = (currentText = transcript) => {
    syncSummaryUiState();
    if (!saveLocally || !(rawTranscriptRef.current || currentText)) return;
    try {
      const job = currentCheckpoint(currentText);
      localStorage.setItem(CHECKPOINT_KEY, encodeCheckpoint(job));
      setSavedJob(job);
      setSaveWarning('');
    } catch {
      setSaveWarning(
        '瀏覽器未能儲存復原進度（空間不足或隱私模式）；請下載復原檔，不要關閉頁面。',
      );
    }
  };

  const busy = [
    'uploading',
    'transcribing',
    'waiting',
    'correcting',
    'summarizing',
    'reviewing',
    'merging',
  ].includes(phase);
  const goTo = (nextStep: WizardStep) => {
    setDirection(nextStep >= step ? 'forward' : 'back');
    setError('');
    setStep(nextStep);
  };

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const testMode = runtimeApiBase() === LOCAL_TEST_API_BASE;
      setIsTestMode(testMode);
      if (testMode) {
        setBridgeState('ready');
        return;
      }
      void fetch(`${LOCAL_AUDIO_BRIDGE}/health`, {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error('bridge unavailable');
          setBridgeState('ready');
        })
        .catch(() => {
          if (!controller.signal.aborted) setBridgeState('error');
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!busy || startedAt === null) return;
    const update = () =>
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [busy, startedAt]);

  useEffect(() => {
    if (!busy) return;
    const preventAccidentalExit = (event: BeforeUnloadEvent) =>
      event.preventDefault();
    window.addEventListener('beforeunload', preventAccidentalExit);
    return () =>
      window.removeEventListener('beforeunload', preventAccidentalExit);
  }, [busy]);

  useEffect(() => {
    if (!busy) return;
    let disposed = false;
    const navigatorWithWakeLock = navigator as WakeLockNavigator;
    const requestWakeLock = async () => {
      if (document.visibilityState !== 'visible' || wakeLockRef.current) return;
      if (!navigatorWithWakeLock.wakeLock) {
        setWakeLockState('unsupported');
        return;
      }
      try {
        const handle = await navigatorWithWakeLock.wakeLock.request('screen');
        if (disposed) {
          await handle.release();
          return;
        }
        wakeLockRef.current = handle;
        setWakeLockState('active');
        handle.addEventListener('release', () => {
          if (wakeLockRef.current === handle) wakeLockRef.current = null;
          if (!disposed) setWakeLockState('idle');
        });
      } catch {
        if (!disposed) setWakeLockState('error');
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    void requestWakeLock();
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const handle = wakeLockRef.current;
      wakeLockRef.current = null;
      if (handle && !handle.released) void handle.release();
    };
  }, [busy]);

  useEffect(() => {
    const modelContext = (
      document as Document & { modelContext?: WebMcpContext }
    ).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      modelContext.registerTool(
        {
          name: 'configure_recording_output',
          title: '設定錄音輸出方式',
          description:
            '設定輸出逐字稿或學習重點，並選擇用來校正逐字稿與整理重點的高科 iAI 語言模型（Nkust / Furen 系列）；不會讀取或設定 API Key。',
          inputSchema: {
            type: 'object',
            properties: {
              mode: { type: 'string', enum: ['transcript', 'summary'] },
              model: { type: 'string', enum: MODELS.map((item) => item.alias) },
              customPrompt: { type: 'string', maxLength: 4000 },
            },
            required: ['mode'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          async execute(input) {
            if (!input || typeof input !== 'object')
              throw new Error('輸入必須是物件。');
            const values = input as Record<string, unknown>;
            if (values.mode !== 'transcript' && values.mode !== 'summary')
              throw new Error('mode 必須是 transcript 或 summary。');
            if (
              values.model !== undefined &&
              !MODELS.some((item) => item.alias === values.model)
            )
              throw new Error('model 不是可用的高科 iAI 語言模型別名。');
            if (
              values.customPrompt !== undefined &&
              typeof values.customPrompt !== 'string'
            )
              throw new Error('customPrompt 必須是文字。');
            setMode(values.mode);
            if (typeof values.model === 'string') setModel(values.model);
            if (typeof values.customPrompt === 'string')
              setCustomPrompt(values.customPrompt.slice(0, 4000));
            return {
              configured: true,
              mode: values.mode,
              model: typeof values.model === 'string' ? values.model : model,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);
    return () => lifecycle.abort();
  }, [model]);

  const clearResults = () => {
    setPartialResult(false);
    setMarkdown('');
    setOutputFilename('');
    setTranscript('');
    setError('');
    setFailedStage(null);
    correctionCacheRef.current = null;
    summaryCacheRef.current = null;
    syncSummaryUiState();
    rawTranscriptRef.current = '';
    setProgress(0);
    setElapsedSeconds(0);
    setPhase('idle');
  };

  const resetHome = () => {
    activeControllerRef.current?.abort();
    activeXhrRef.current?.abort();
    clearResults();
    setApiKey('');
    setShowKey(false);
    setApiState('idle');
    setApiMessage('');
    setFile(null);
    setMode('summary');
    setModel('Furen-std');
    setCustomPrompt('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setDirection('back');
    setStep(0);
  };

  const chooseFile = (candidate: File | undefined) => {
    if (!candidate || busy) return;
    clearResults();
    const validation = validateAudioFile(candidate);
    if (!validation.ok) {
      setFile(null);
      setError(validation.message);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setFile(candidate);
    setError('');
  };

  const verifyApiKey = async () => {
    if (!apiKey.trim()) {
      setApiState('error');
      setApiMessage('請先輸入 API Key。');
      return;
    }
    setApiState('checking');
    setApiMessage('正在向高科 iAI 驗證…');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${runtimeApiBase()}/models`, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok)
        throw new Error(extractErrorMessage(raw, `HTTP ${response.status}`));
      const payload: unknown = raw ? JSON.parse(raw) : [];
      const payloadData =
        payload && typeof payload === 'object'
          ? (payload as { data?: unknown }).data
          : undefined;
      const items = Array.isArray(payloadData) ? payloadData : payload;
      const ids = Array.isArray(items)
        ? items
            .map((item) =>
              item && typeof item === 'object'
                ? ((item as { id?: unknown; model_name?: unknown }).id ??
                  (item as { model_name?: unknown }).model_name)
                : null,
            )
            .filter(Boolean)
            .map(String)
        : [];
      const missing = ['Asr', ...MODELS.map((item) => item.alias)].filter(
        (item) => !ids.includes(item),
      );
      setApiState('ok');
      setApiMessage(
        missing.length
          ? `驗證成功；模型清單暫未列出 ${missing.join('、')}。`
          : 'API Key 與模型清單驗證成功；實際可用額度會在處理時由 iAI 檢查。',
      );
      window.setTimeout(() => goTo(transcript && failedStage ? 5 : 2), 450);
    } catch (reason) {
      setApiState('error');
      setApiMessage(
        isAbortError(reason)
          ? '驗證逾時，請檢查網路後重試。'
          : reason instanceof Error
            ? reason.message
            : 'API Key 驗證失敗。',
      );
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const handleBridgeProgress = (event: BridgeEvent) => {
    const sourcePercent = Math.max(0, Math.min(100, event.percent ?? 0));
    setProgress((current) =>
      Math.max(current, 12 + Math.round(sourcePercent * 0.47)),
    );
    if (event.stage === 'waiting') setPhase('waiting');
    else if (event.stage === 'transcribing') setPhase('transcribing');
    else setPhase('uploading');
    setStatus({
      title:
        event.stage === 'waiting'
          ? 'IAI 暫時忙碌，準備重試'
          : event.stage === 'transcribing'
            ? 'Asr 正在產生逐字稿'
            : '正在準備錄音',
      detail: event.message ?? '正在等待高科 iAI 回傳實際處理結果。',
    });
  };

  const sendAudioOnce = (
    selectedFile: File,
    key: string,
    signal: AbortSignal,
  ) =>
    new Promise<{ status: number; raw: string; retryAfter: string | null }>(
      (resolve, reject) => {
        const xhr = new XMLHttpRequest();
        activeXhrRef.current = xhr;
        const audioEndpoint = isTestMode
          ? `${runtimeApiBase()}/audio/transcriptions`
          : `${LOCAL_AUDIO_BRIDGE}/v1/audio/transcriptions`;
        let consumedLength = 0;
        let partialLine = '';
        let streamedResult = '';
        let streamedError = '';
        const consumeEvents = (final: boolean) => {
          partialLine += (xhr.responseText ?? '').slice(consumedLength);
          consumedLength = (xhr.responseText ?? '').length;
          const lines = partialLine.split('\n');
          partialLine = final ? '' : (lines.pop() ?? '');
          for (const line of lines) {
            if (!line.trim()) continue;
            let event: BridgeEvent;
            try {
              event = JSON.parse(line) as BridgeEvent;
            } catch {
              continue;
            }
            if (event.type === 'progress') handleBridgeProgress(event);
            if (event.type === 'error')
              streamedError = event.message ?? '本機錄音處理失敗。';
            if (event.type === 'result' && event.text)
              streamedResult = JSON.stringify({
                text: event.text,
                bridge: event.bridge,
              });
          }
        };
        xhr.open('POST', audioEndpoint);
        xhr.setRequestHeader('Authorization', `Bearer ${key}`);
        xhr.responseType = 'text';
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.min(
            100,
            Math.round((event.loaded / event.total) * 100),
          );
          setProgress(3 + Math.round(percent * 0.09));
          setPhase('uploading');
          setStatus({
            title: `正在上傳錄音 ${percent}%`,
            detail: '檔案會先送至本機處理器；請保持此頁開啟。',
          });
        };
        xhr.upload.onload = () => {
          setProgress(12);
          setStatus({
            title: '錄音上傳完成',
            detail: '正在壓縮與分段，接著會逐段送往高科 iAI。',
          });
        };
        xhr.onprogress = () => consumeEvents(false);
        xhr.onload = () => {
          consumeEvents(true);
          if (streamedError) {
            reject(new Error(streamedError));
            return;
          }
          resolve({
            status: xhr.status,
            raw: streamedResult || xhr.responseText || '',
            retryAfter: xhr.getResponseHeader('Retry-After'),
          });
        };
        xhr.onerror = () =>
          reject(
            new Error(
              isTestMode
                ? '上傳後連線中斷。為避免重複計費，系統沒有自動重送；請手動重試。'
                : '無法連線 Ubuntu 錄音處理服務，請稍後再試。',
            ),
          );
        xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', () => xhr.abort(), { once: true });
        const form = new FormData();
        form.append('file', selectedFile);
        form.append('model', 'Asr');
        form.append('response_format', 'json');
        xhr.send(form);
      },
    );

  const transcribeWithRetry = async (
    selectedFile: File,
    key: string,
    signal: AbortSignal,
  ) => {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await sendAudioOnce(selectedFile, key, signal);
      if (response.status >= 200 && response.status < 300) {
        let payload: unknown = response.raw;
        try {
          payload = response.raw ? JSON.parse(response.raw) : '';
        } catch {
          /* plain text */
        }
        const text = cleanTranscriptRepetition(extractTranscript(payload));
        if (!text)
          throw new Error(
            'IAI 已回應，但沒有找到逐字稿文字。請確認錄音內有清楚語音。',
          );
        return text;
      }
      const message = extractErrorMessage(
        response.raw,
        `IAI 回傳 HTTP ${response.status}`,
      );
      if (isBudgetExceededMessage(`${message}\n${response.raw}`)) {
        throw new Error(
          'iAI API 額度已用完（budget_exceeded），不是 Asr 未回應。請到高科 iAI 後台提高或重設額度後再試。',
        );
      }
      const canRetry =
        attempt < maxAttempts - 1 &&
        isRetryableStatus(response.status) &&
        (response.status === 429 ||
          response.status === 503 ||
          response.status === 504 ||
          isModelLoadingMessage(message));
      if (!canRetry) throw new Error(`逐字稿失敗：${message}`);
      const delay = retryDelayMs(response.retryAfter, attempt);
      setPhase('waiting');
      await waitWithCountdown(delay, signal, (seconds) =>
        setStatus({
          title: 'Asr 模型正在準備',
          detail: `${seconds} 秒後自動重試（${attempt + 1}/${maxAttempts - 1}）。`,
        }),
      );
    }
    throw new Error('逐字稿重試次數已用完。');
  };

  const postChatWithRetry = async (
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    signal: AbortSignal,
    taskLabel: '逐字稿校正' | '重點整理',
    maxTokens = 12_288,
  ) => {
    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let response: { status: number; raw: string; retryAfter: string | null };
      try {
        const body = JSON.stringify({
          model,
          temperature: 0.2,
          frequency_penalty: 0.3,
          stream: false,
          max_tokens: maxTokens,
          chat_template_kwargs: { enable_thinking: false },
          messages,
        });
        if (isTestMode) {
          const direct = await fetch(`${runtimeApiBase()}/chat/completions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey.trim()}`,
              'Content-Type': 'application/json',
            },
            signal,
            body,
          });
          response = {
            status: direct.status,
            raw: await direct.text(),
            retryAfter: direct.headers.get('Retry-After'),
          };
        } else {
          const streamed = await fetch(
            `${LOCAL_AUDIO_BRIDGE}/v1/chat/completions`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey.trim()}`,
                'Content-Type': 'application/json',
              },
              signal,
              body,
            },
          );
          if (!streamed.ok || !streamed.body) {
            response = {
              status: streamed.status || 502,
              raw: await streamed.text(),
              retryAfter: streamed.headers.get('Retry-After'),
            };
          } else {
            const reader = streamed.body.getReader();
            const decoder = new TextDecoder();
            let pending = '';
            let resultPayload: unknown;
            let errorEvent: BridgeEvent | undefined;
            const consumeLine = (line: string) => {
              if (!line.trim()) return;
              let event: BridgeEvent;
              try {
                event = JSON.parse(line) as BridgeEvent;
              } catch {
                return;
              }
              if (event.type === 'progress') {
                setStatus((current) => ({
                  ...current,
                  detail:
                    event.message ?? 'iAI 仍在處理；連線正常，請勿關閉此頁面。',
                }));
              } else if (event.type === 'result') {
                resultPayload = event.payload;
              } else if (event.type === 'error') {
                errorEvent = event;
              }
            };
            while (true) {
              const { done, value } = await reader.read();
              pending += decoder.decode(value, { stream: !done });
              const lines = pending.split('\n');
              pending = done ? '' : (lines.pop() ?? '');
              for (const line of lines) consumeLine(line);
              if (done) break;
            }
            if (pending) consumeLine(pending);
            response = errorEvent
              ? {
                  status: errorEvent.status ?? 502,
                  raw: JSON.stringify({
                    error: { message: errorEvent.message ?? 'LLM 處理失敗。' },
                  }),
                  retryAfter: errorEvent.retryAfter ?? null,
                }
              : resultPayload !== undefined
                ? {
                    status: 200,
                    raw: JSON.stringify(resultPayload),
                    retryAfter: null,
                  }
                : {
                    status: 502,
                    raw: JSON.stringify({
                      error: { message: 'LLM 連線結束，但沒有收到結果。' },
                    }),
                    retryAfter: null,
                  };
          }
        }
      } catch (reason) {
        if (isAbortError(reason)) throw reason;
        throw new Error(
          `${taskLabel}過程連線中斷。已取得的逐字稿仍保留，可直接重試 LLM 處理。`,
        );
      }
      const raw = response.raw;
      if (response.status >= 200 && response.status < 300) {
        let payload: unknown;
        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          throw new Error('LLM 回傳格式不是有效的 JSON。');
        }
        const content = extractChatContent(payload);
        try {
          assertCompleteChatResponse(payload);
        } catch (reason) {
          // Notes may retain a visibly PARTIAL response without paying to regenerate it.
          // Transcript correction retains its strict completeness requirement.
          if (
            taskLabel === '重點整理' &&
            (payload as { choices?: { finish_reason?: string }[] })
              ?.choices?.[0]?.finish_reason !== 'content_filter'
          )
            throw Object.assign(reason as Error, { partialContent: content });
          throw reason;
        }
        if (!content)
          throw Object.assign(
            new Error('LLM 已回應，但沒有找到可讀取的整理內容。'),
            { contentUnusable: true },
          );
        return content;
      }
      const message = extractErrorMessage(
        raw,
        `IAI 回傳 HTTP ${response.status}`,
      );
      if (isBudgetExceededMessage(`${message}\n${raw}`)) {
        throw new Error(
          `iAI API 額度已用完（budget_exceeded），不是模型未回應。請到高科 iAI 後台提高或重設額度後，再使用下方按鈕續跑；已完成的逐字稿與分段會保留。`,
        );
      }
      if (
        attempt >= maxAttempts - 1 ||
        !(
          (response.status === 429 || response.status === 503) &&
          !/連線結束/.test(message)
        )
      )
        throw new Error(`${taskLabel}失敗：${message}`);
      const delay = retryDelayMs(response.retryAfter, attempt);
      setPhase('waiting');
      await waitWithCountdown(delay, signal, (seconds) =>
        setStatus({
          title: isModelLoadingMessage(message)
            ? `${model} 正在載入`
            : 'IAI 目前忙碌',
          detail: `${seconds} 秒後自動重試（${attempt + 1}/${maxAttempts - 1}）。`,
        }),
      );
    }
    throw new Error('模型重試次數已用完。');
  };

  const correctTranscript = async (text: string, signal: AbortSignal) => {
    const cleanedText = cleanTranscriptRepetition(text);
    const signature = correctionSignature(cleanedText, model, file?.name);
    if (correctionCacheRef.current?.signature !== signature) {
      if (
        correctionCacheRef.current &&
        canResumeCorrectionWithModel(
          correctionCacheRef.current.signature,
          signature,
        )
      )
        correctionCacheRef.current.signature = signature;
      else correctionCacheRef.current = { signature, parts: [] };
    }
    return correctStudyTranscript(
      cleanedText,
      (messages, maxTokens) =>
        postChatWithRetry(messages, signal, '逐字稿校正', maxTokens),
      correctionCacheRef.current,
      (_stage, current, total) => {
        saveCheckpoint(rawTranscriptRef.current || text);
        setPhase('correcting');
        setProgress(
          60 +
            Math.round(
              ((current - 0.8) / total) * (mode === 'summary' ? 14 : 35),
            ),
        );
        setStatus({
          title: `${model} 正在校正第 ${current}/${total} 段逐字稿`,
          detail:
            '依相鄰語境校正繁體中文與英文術語，保留原始數字、條件與公式。',
        });
      },
      file?.name,
      () => saveCheckpoint(rawTranscriptRef.current || text),
    );
  };

  const summarizeTranscript = async (text: string, signal: AbortSignal) => {
    const rawText = rawTranscriptRef.current || text;
    const signature = summarySignature(
      text,
      rawText,
      model,
      customPrompt,
      file?.name,
    );
    if (summaryCacheRef.current?.signature !== signature) {
      if (
        summaryCacheRef.current &&
        canResumeSummaryWithModel(summaryCacheRef.current.signature, signature)
      )
        summaryCacheRef.current.signature = signature;
      else
        summaryCacheRef.current = {
          signature,
          drafts: [],
          parts: [],
          merges: {},
        };
    }
    return summarizeStudyTranscriptResilient(
      text,
      (messages, maxTokens) =>
        postChatWithRetry(messages, signal, '重點整理', maxTokens),
      summaryCacheRef.current,
      {
        rawText,
        correctedParts: correctionCacheRef.current?.parts,
        terminology: correctionCacheRef.current?.terminology,
        filename: file?.name,
        preference: customPrompt.trim(),
        manualResume: failedStage === 'summary' || partialResult,
        onCheckpoint: () => saveCheckpoint(text),
        onProgress: (stage, current, total) => {
          setPhase(stage);
          setProgress(
            stage === 'merging'
              ? 94
              : 75 +
                  Math.round(
                    ((current - (stage === 'reviewing' ? 0.2 : 0.8)) / total) *
                      17,
                  ),
          );
          setStatus({
            title:
              stage === 'reviewing'
                ? `${model} 正在校核第 ${current}/${total} 段學習重點`
                : stage === 'merging'
                  ? '正在統整與校核完整筆記'
                  : `${model} 正在整理第 ${current}/${total} 段學習重點`,
            detail:
              stage === 'reviewing'
                ? '對照原始轉錄檢查公式、數值、條件與術語，移除來源無法支持的內容。'
                : stage === 'merging'
                  ? '保留各段的重點、解題步驟與限制，去除重複並檢查排版。'
                  : '整理概念、解題步驟與必要比較；已完成的分段會保留。',
          });
        },
      },
    );
  };

  const finishDocument = (
    text: string,
    notes?: string,
    restored?: { filename: string; model: string },
  ) => {
    const sourceName = restored?.filename ?? file?.name;
    const exportModel = restored?.model ?? model;
    if (!sourceName) return;
    const isNotes = notes !== undefined;
    if (isNotes && !hasCompleteStudyNotes(summaryCacheRef.current))
      throw new Error('筆記尚未完整，請續跑未完成部分；已完成進度不會清除。');
    const cleanedText = cleanTranscriptRepetition(text);
    const generatedAt = new Intl.DateTimeFormat('zh-TW', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date());
    const content = buildMarkdown({
      filename: sourceName,
      transcript: cleanedText,
      notes,
      model: exportModel,
      generatedAt,
    });
    setTranscript(cleanedText);
    setMarkdown(content);
    setOutputFilename(
      `${safeBaseName(sourceName)}_${isNotes ? '錄音重點' : '逐字稿'}.md`,
    );
    setProgress(100);
    const incomplete = Boolean(
      notes &&
      summaryCacheRef.current?.recovery &&
      (summaryCacheRef.current.recovery.complete <
        summaryCacheRef.current.recovery.total ||
        summaryCacheRef.current.recovery.reader?.ready === false),
    );
    setPartialResult(incomplete);
    setPhase('done');
    setFailedStage(null);
    setStatus({
      title: incomplete ? '已有內容可以匯出' : 'Markdown 已完成',
      detail: incomplete
        ? '已完成分段可下載，未完成範圍列在匯出檔中；不會重新生成已完成內容。'
        : `已完成繁體中文校正${isNotes ? '與重點整理；續跑時保留前次完成內容' : ''}。`,
    });
    saveCheckpoint(cleanedText);
    setDirection('forward');
    setStep(6);
  };

  const handleFailure = (reason: unknown, stage: FailedStage) => {
    saveCheckpoint();
    setFailedStage(stage);
    if (isAbortError(reason)) {
      setPhase('cancelled');
      setStatus({
        title: '已取消處理',
        detail:
          '已取消等待；已送出 IAI 的請求仍可能完成與計費。三十分鐘內以相同設定續跑，可取回處理器暫存結果。',
      });
      setError('');
      return;
    }
    const message =
      reason instanceof Error ? reason.message : '處理失敗，請稍後再試。';
    setError(message);
    setFailedStage(stage);
    setPhase('error');
    setStatus({
      title:
        stage === 'summary'
          ? '重點整理暫停'
          : stage === 'correction'
            ? '逐字稿校正暫停'
            : '逐字稿未完成',
      detail: message,
    });
  };

  const runWorkflow = async () => {
    if (busy) return;
    setDirection('forward');
    setStep(5);
    setError('');
    setMarkdown('');
    setOutputFilename('');
    setFailedStage(null);
    setProgress(0);
    setElapsedSeconds(0);
    // Cache invalidation is signature-based. Starting again must not erase paid results.
    if (!apiKey.trim() || apiState !== 'ok') {
      handleFailure(
        new Error('API Key 尚未通過驗證，請返回重新驗證。'),
        'transcription',
      );
      return;
    }
    if (!file) {
      handleFailure(
        new Error('請先加入 MP3、M4A 或 WAV 錄音檔。'),
        'transcription',
      );
      return;
    }
    if (!rawTranscriptRef.current && !isTestMode && bridgeState !== 'ready') {
      handleFailure(
        new Error('Ubuntu 錄音處理服務尚未就緒，請稍後再試。'),
        'transcription',
      );
      return;
    }
    const validation = validateAudioFile(file);
    if (!rawTranscriptRef.current && !validation.ok) {
      handleFailure(new Error(validation.message), 'transcription');
      return;
    }
    const controller = new AbortController();
    activeControllerRef.current = controller;
    setStartedAt(Date.now());
    let currentStage: FailedStage = 'transcription';
    try {
      const rawText =
        rawTranscriptRef.current ||
        (await transcribeWithRetry(file, apiKey.trim(), controller.signal));
      setTranscript(rawText);
      rawTranscriptRef.current = rawText;
      saveCheckpoint(rawText);
      setProgress(59);
      currentStage = 'correction';
      const correctedText = await correctTranscript(rawText, controller.signal);
      setTranscript(correctedText);
      saveCheckpoint(correctedText);
      if (mode === 'transcript') {
        finishDocument(correctedText);
        return;
      }
      currentStage = 'summary';
      const notes = await summarizeTranscript(correctedText, controller.signal);
      finishDocument(correctedText, notes);
    } catch (reason) {
      handleFailure(reason, currentStage);
    } finally {
      activeXhrRef.current = null;
      activeControllerRef.current = null;
    }
  };

  const retrySummaryOnly = async () => {
    if (!transcript || busy) return;
    if (!apiKey.trim() || apiState !== 'ok') {
      goTo(1);
      setError('請先重新驗證 API Key，再續跑；已完成內容不會刪除。');
      return;
    }
    setError('');
    setFailedStage(null);
    setElapsedSeconds(0);
    setStartedAt(Date.now());
    const controller = new AbortController();
    activeControllerRef.current = controller;
    try {
      const notes = await summarizeTranscript(transcript, controller.signal);
      finishDocument(transcript, notes);
    } catch (reason) {
      handleFailure(reason, 'summary');
    } finally {
      activeControllerRef.current = null;
    }
  };

  const retryCorrectionOnly = async () => {
    if (!transcript || busy) return;
    if (!apiKey.trim() || apiState !== 'ok') {
      goTo(1);
      setError('請先重新驗證 API Key，再續跑；已完成內容不會刪除。');
      return;
    }
    setError('');
    setFailedStage(null);
    setElapsedSeconds(0);
    setStartedAt(Date.now());
    const controller = new AbortController();
    activeControllerRef.current = controller;
    let currentStage: FailedStage = 'correction';
    try {
      const correctedText = await correctTranscript(
        rawTranscriptRef.current || transcript,
        controller.signal,
      );
      setTranscript(correctedText);
      if (mode === 'transcript') {
        finishDocument(correctedText);
        return;
      }
      currentStage = 'summary';
      const notes = await summarizeTranscript(correctedText, controller.signal);
      finishDocument(correctedText, notes);
    } catch (reason) {
      handleFailure(reason, currentStage);
    } finally {
      activeControllerRef.current = null;
    }
  };

  const downloadMarkdown = () => {
    if (!markdown || !outputFilename) return;
    downloadDocument(markdown, outputFilename);
  };
  const restoreJob = async () => {
    if (!savedJob || busy) return;
    if (savedJob.summary) await validateRecoveredNotes(savedJob.summary);
    setFile(new File([], savedJob.filename));
    setModel(savedJob.model);
    setMode(savedJob.mode);
    setCustomPrompt(savedJob.preference);
    rawTranscriptRef.current = savedJob.raw;
    setTranscript(savedJob.transcript || savedJob.raw);
    correctionCacheRef.current = savedJob.correction;
    summaryCacheRef.current = savedJob.summary;
    syncSummaryUiState();
    const correctionDone =
      savedJob.correction?.parts.length ===
      splitTranscript(cleanTranscriptRepetition(savedJob.raw)).length;
    if (
      correctionDone &&
      (savedJob.mode === 'transcript' ||
        hasCompleteStudyNotes(savedJob.summary))
    ) {
      finishDocument(
        savedJob.transcript,
        savedJob.mode === 'summary'
          ? recoveryExport(savedJob.summary!)
          : undefined,
        savedJob,
      );
      return;
    }
    setFailedStage(correctionDone ? 'summary' : 'correction');
    setPhase('error');
    setError(
      '已恢復進度；先重新驗證 API Key，再續跑未完成內容。原始錄音不需再次上傳。',
    );
    setStatus({
      title: '已恢復上次進度',
      detail: 'API Key 不會儲存在復原資料；已完成分段不會重新付費生成。',
    });
    setStep(5);
  };
  const exportAvailable = () => {
    const notes = summaryCacheRef.current
      ? recoveryExport(summaryCacheRef.current)
      : '';
    if (!notes) return;
    if (busy) {
      downloadDocument(
        buildMarkdown({
          filename: file?.name ?? '錄音.m4a',
          transcript,
          notes,
          model,
          generatedAt: new Date().toLocaleString('zh-TW'),
        }),
        `${safeBaseName(file?.name ?? '錄音')}-已有重點.md`,
      );
      return;
    }
    finishDocument(transcript || rawTranscriptRef.current, notes);
  };
  const downloadDocument = (content: string, name: string) => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  const copyMarkdown = async () => {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const selectedModel =
    MODELS.find((item) => item.alias === model) ?? MODELS[1];

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="learning-orbits" aria-hidden="true">
        <span className="orbit-icon orbit-mic">
          <Mic2 />
        </span>
        <span className="orbit-icon orbit-book">
          <BookOpen />
        </span>
        <span className="orbit-icon orbit-brain">
          <BrainCircuit />
        </span>
        <span className="orbit-icon orbit-spark">
          <Sparkles />
        </span>
      </div>
      <header className="site-header">
        <button
          type="button"
          className="mini-brand"
          onClick={resetHome}
          aria-label="回到首頁"
        >
          <span>
            <Headphones size={19} />
          </span>
          <strong>知音筆記</strong>
        </button>
        <a
          href={IAI_API_BASE}
          target="_blank"
          rel="noreferrer"
          className="iai-endpoint"
        >
          <span className="endpoint-dot" />
          高科 iAI · {IAI_API_BASE}
        </a>
      </header>

      {step > 0 && (
        <nav className="stepper" aria-label="處理步驟">
          {STEP_LABELS.map((label, index) => {
            const number = index + 1;
            const complete = step > number;
            const active = step === number;
            return (
              <div
                className={`stepper-item ${complete ? 'complete' : ''} ${active ? 'active' : ''}`}
                key={label}
              >
                <span>{complete ? <Check size={14} /> : number}</span>
                <small>{label}</small>
              </div>
            );
          })}
        </nav>
      )}

      <section className={`wizard-stage ${step === 0 ? 'home-stage' : ''}`}>
        <div
          className={`wizard-card step-${step} motion-${direction}`}
          key={step}
        >
          {step === 0 && (
            <div className="hero-step">
              <div className="hero-symbol">
                <div className="sound-bars">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <p className="eyebrow">
                <Sparkles size={15} /> 高科 iAI 錄音學習助手
              </p>
              <h1>
                把一堂課，整理成
                <br />
                <em>一份真正好讀的筆記</em>
              </h1>
              <p className="hero-copy">
                上傳錄音，先由 <strong>Asr</strong> 轉錄，再由你選擇的高科 iAI
                模型（Nkust / Furen 系列）校正繁體中文與英文專有名詞，並可完整整理學習重點。
              </p>
              <div className="hero-pills">
                <span>
                  <ShieldCheck size={15} /> API Key 不留存
                </span>
                <span>
                  <FileAudio size={15} /> MP3 · M4A · WAV
                </span>
                <span>
                  <FileText size={15} /> 匯出 Markdown
                </span>
              </div>
              <Button
                className="main-action hero-action"
                onClick={() => goTo(1)}
              >
                開始使用 <ArrowRight size={18} />
              </Button>
              <p className="size-note">
                單一錄音最高 {MAX_FILE_MB} MB · 長錄音處理可能需要數分鐘
              </p>
              {savedJob && (
                <div className="process-actions" style={{ flexWrap: 'wrap' }}>
                  <Button variant="outline" onClick={restoreJob}>
                    <RefreshCw size={17} /> 恢復「{savedJob.filename}
                    」的已完成進度
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      try {
                        localStorage.removeItem(CHECKPOINT_KEY);
                        setSavedJob(null);
                      } catch {
                        setSaveWarning(
                          '無法清除本機資料，請清除本站瀏覽器資料。',
                        );
                      }
                    }}
                  >
                    清除本機復原資料
                  </Button>
                </div>
              )}
              <label
                className="size-note"
                style={{ display: 'block', marginTop: 16 }}
              >
                載入復原檔（不會立即呼叫 IAI）
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={async (event) => {
                    const candidate = event.target.files?.[0];
                    if (!candidate) return;
                    try {
                      if (candidate.size > 4 * 1024 * 1024)
                        throw new Error('復原檔超過 4 MB');
                      setSavedJob(decodeCheckpoint(await candidate.text()));
                      setSaveWarning('復原檔已載入，請按恢復進度。');
                    } catch {
                      setSaveWarning('復原檔無效或已過期，不會呼叫 IAI。');
                    }
                    event.target.value = '';
                  }}
                />
              </label>
              {saveWarning && <p className="size-note">{saveWarning}</p>}
            </div>
          )}

          {step === 1 && (
            <div className="step-content compact-step">
              <StepBack onClick={() => goTo(0)}>返回首頁</StepBack>
              <div className="step-icon key-icon">
                <KeyRound />
              </div>
              <p className="step-kicker">步驟 1 / 6</p>
              <h2>先連接你的高科 iAI</h2>
              <p className="step-lead">
                API Key 只保留在目前頁面記憶體，重新整理或關閉後即消失。
              </p>
              <div className="field-stack">
                <label htmlFor="api-key">高科 iAI API Key</label>
                <div className="secret-field">
                  <Input
                    id="api-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      setApiState('idle');
                      setApiMessage('');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void verifyApiKey();
                    }}
                    placeholder="sk-..."
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((value) => !value)}
                    aria-label={showKey ? '隱藏 API Key' : '顯示 API Key'}
                  >
                    {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {apiMessage && (
                  <output className={`inline-message ${apiState}`}>
                    {apiState === 'checking' ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : apiState === 'ok' ? (
                      <CheckCircle2 size={17} />
                    ) : (
                      <AlertCircle size={17} />
                    )}
                    <span>{apiMessage}</span>
                  </output>
                )}
              </div>
              <Button
                className="main-action"
                onClick={() => void verifyApiKey()}
                disabled={apiState === 'checking'}
              >
                {apiState === 'checking' ? (
                  <>
                    <LoaderCircle className="spin" size={18} /> 驗證中
                  </>
                ) : (
                  <>
                    驗證並繼續 <ArrowRight size={18} />
                  </>
                )}
              </Button>
              <p className="trust-line">
                <ShieldCheck size={14} /> 僅送往畫面上方所示的高科 iAI 網址
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="step-content">
              <StepBack onClick={() => goTo(1)} />
              <div className="step-icon upload-icon">
                <UploadCloud />
              </div>
              <p className="step-kicker">步驟 2 / 6</p>
              <h2>加入這次的錄音</h2>
              <p className="step-lead">
                支援 MP3、M4A、WAV，單一檔案最高 {MAX_FILE_MB} MB。
              </p>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav"
                onChange={(event) => chooseFile(event.target.files?.[0])}
              />
              <button
                type="button"
                className={`drop-zone ${isDragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (event.currentTarget === event.target)
                    setIsDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  chooseFile(event.dataTransfer.files?.[0]);
                }}
              >
                {file ? (
                  <>
                    <span className="file-ready">
                      <FileAudio />
                    </span>
                    <strong>{file.name}</strong>
                    <small>{formatBytes(file.size)} · 點擊可更換</small>
                  </>
                ) : (
                  <>
                    <span className="drop-illustration">
                      <UploadCloud />
                    </span>
                    <strong>拖曳錄音到這裡</strong>
                    <small>或點擊選擇檔案</small>
                    <span className="limit-chip">最大 {MAX_FILE_MB} MB</span>
                  </>
                )}
              </button>
              {error && (
                <div className="error-banner">
                  <AlertCircle size={18} />
                  <span>{error}</span>
                </div>
              )}
              {bridgeState === 'error' && !isTestMode && (
                <div className="error-banner">
                  <AlertCircle size={18} />
                  <span>Ubuntu 錄音處理服務目前無法連線，請稍後再試。</span>
                </div>
              )}
              <Button
                className="main-action"
                disabled={!file || bridgeState !== 'ready'}
                onClick={() => goTo(3)}
              >
                上傳並繼續 <ArrowRight size={18} />
              </Button>
            </div>
          )}

          {step === 3 && (
            <div className="step-content wide-step">
              <StepBack onClick={() => goTo(2)} />
              <p className="step-kicker">步驟 3 / 6</p>
              <h2>這次想得到什麼？</h2>
              <p className="step-lead">
                Asr 產生初稿後，逐字稿與學習重點都會使用你選擇的高科 iAI 語言模型
                模型校正錯字。
              </p>
              <RadioGroup
                className="output-options"
                value={mode}
                onValueChange={(value) => setMode(value as OutputMode)}
              >
                <label
                  className={`output-choice ${mode === 'transcript' ? 'selected' : ''}`}
                  htmlFor="transcript-only"
                >
                  <RadioGroupItem id="transcript-only" value="transcript" />
                  <span className="choice-icon">
                    <FileText />
                  </span>
                  <span>
                    <strong>輸出校正逐字稿</strong>
                    <small>由所選 LLM 修正錯字，保留完整內容。</small>
                  </span>
                  <Check className="choice-check" />
                </label>
                <label
                  className={`output-choice ${mode === 'summary' ? 'selected' : ''}`}
                  htmlFor="summary-mode"
                >
                  <RadioGroupItem id="summary-mode" value="summary" />
                  <span className="choice-icon summary">
                    <WandSparkles />
                  </span>
                  <span>
                    <strong>整理成學習重點</strong>
                    <small>先校正逐字稿，再完整、詳細整理所有重點。</small>
                  </span>
                  <Check className="choice-check" />
                </label>
              </RadioGroup>
              <div className="model-reveal open">
                <div>
                  <div className="model-panel">
                    <div className="model-panel-head">
                      <span>選擇逐字稿校正與重點整理模型</span>
                      <a
                        href={OFFICIAL_MODEL_LIST}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看 iAI 模型清單
                      </a>
                    </div>
                    <RadioGroup
                      className="model-grid"
                      value={model}
                      onValueChange={setModel}
                    >
                      {MODELS.map((item) => (
                        <label
                          className={`model-choice ${model === item.alias ? 'selected' : ''}`}
                          htmlFor={`model-${item.alias}`}
                          key={item.alias}
                        >
                          <RadioGroupItem
                            id={`model-${item.alias}`}
                            value={item.alias}
                          />
                          <span className="model-top">
                            <strong>{item.alias}</strong>
                            {item.alias === 'Furen-std' && <em>建議</em>}
                          </span>
                          <code>{item.proposedBase}</code>
                          <small>{item.use}</small>
                          <span className="pricing">
                            輸入 ${item.input} · 輸出 ${item.output} / 1M tokens
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                    <small>
                      續跑時更換模型，只補未完成工作；已完成的逐字稿與重點保留。修改錄音或整理要求會使相關結果重新生成。
                    </small>
                  </div>
                </div>
              </div>
              <Button className="main-action" onClick={() => goTo(4)}>
                下一步 <ArrowRight size={18} />
              </Button>
            </div>
          )}

          {step === 4 && (
            <div className="step-content">
              <StepBack onClick={() => goTo(3)} />
              <div className="step-icon prompt-icon">
                <Sparkles />
              </div>
              <p className="step-kicker">步驟 4 / 6</p>
              <h2>還有特別要求嗎？</h2>
              <p className="step-lead">
                可選填。例如指定筆記結構、特別保留公式，或用高中生能理解的方式說明。
              </p>
              <div className="field-stack prompt-field">
                <label htmlFor="custom-prompt">
                  額外提示詞 <span>選填</span>
                </label>
                <Textarea
                  id="custom-prompt"
                  value={customPrompt}
                  maxLength={4000}
                  onChange={(event) => setCustomPrompt(event.target.value)}
                  placeholder="例如：請依照章節整理，保留所有公式，並列出容易考的題型…"
                />
                <small>{customPrompt.length} / 4000</small>
              </div>
              <div className="ready-summary">
                <span>
                  <FileAudio size={17} /> {file?.name}
                </span>
                <span>
                  <FileText size={17} />{' '}
                  {mode === 'summary'
                    ? `Asr → ${selectedModel.alias} 校正與整理`
                    : `Asr → ${selectedModel.alias} 校正逐字稿`}
                </span>
              </div>
              <label
                className="size-note"
                style={{ display: 'block', marginBottom: 16 }}
              >
                <input
                  type="checkbox"
                  checked={saveLocally}
                  onChange={(event) => {
                    setSaveLocally(event.target.checked);
                    if (!event.target.checked) {
                      try {
                        localStorage.removeItem(CHECKPOINT_KEY);
                        setSavedJob(null);
                      } catch {
                        setSaveWarning(
                          '無法清除本機資料，請在瀏覽器設定清除本站資料。',
                        );
                      }
                    }
                  }}
                />{' '}
                在此瀏覽器儲存復原進度（七天；包含逐字稿，不含 API
                Key／錄音）。共用裝置請勿勾選。
              </label>
              {saveWarning && <p className="size-note">{saveWarning}</p>}
              <Button
                className="main-action"
                onClick={() => void runWorkflow()}
              >
                <UploadCloud size={18} />{' '}
                {mode === 'summary'
                  ? '上傳、校正並整理'
                  : '上傳並產生校正逐字稿'}
              </Button>
              <p className="size-note">
                開始後請保持頁面開啟；30 MB 長錄音上傳與 IAI
                模型回傳都需要時間。
              </p>
            </div>
          )}

          {step === 5 && (
            <div className="step-content processing-step">
              <p className="step-kicker">步驟 5 / 6</p>
              <div className={`processing-visual phase-${phase}`}>
                <div className="processing-ring">
                  <BrainCircuit />
                </div>
                <div className="mini-wave" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <div className="live-label">
                <span /> 依 IAI 實際回傳更新
              </div>
              <h2 className="bouncing-status" aria-live="polite">
                {status.title}
                <i />
                <i />
                <i />
              </h2>
              <p className="step-lead processing-detail">{status.detail}</p>
              {busy && (
                <div className={`keep-awake keep-awake-${wakeLockState}`}>
                  <strong>請勿關閉此頁面</strong>
                  <span>
                    {wakeLockState === 'active'
                      ? '已要求手機保持螢幕開啟；請讓瀏覽器留在前景。'
                      : wakeLockState === 'unsupported' ||
                          wakeLockState === 'error'
                        ? '此瀏覽器無法自動保持螢幕開啟，請暫時關閉自動鎖定並讓此頁保持前景。'
                        : '正在要求瀏覽器保持螢幕開啟，處理完成後會自動解除。'}
                  </span>
                </div>
              )}
              <div className="progress-block">
                <div className="progress-meta">
                  <span>{Math.min(100, progress)}%</span>
                  <span>已等待 {formatDuration(elapsedSeconds)}</span>
                </div>
                <div className="lively-progress">
                  <span style={{ width: `${Math.min(100, progress)}%` }}>
                    <i />
                  </span>
                </div>
              </div>
              <div className="phase-track">
                {[
                  ['uploading', '上傳'],
                  ['transcribing', 'Asr 轉錄'],
                  [
                    'correcting',
                    mode === 'summary' ? 'LLM 校正／整理' : 'LLM 校正',
                  ],
                  ['done', '完成'],
                ].map(([phaseName, label], index) => {
                  const rank: Record<string, number> = {
                    uploading: 0,
                    transcribing: 1,
                    waiting: transcript ? 2 : 1,
                    correcting: 2,
                    summarizing: 2,
                    reviewing: 2,
                    merging: 2,
                    done: 3,
                  };
                  const currentRank = rank[phase] ?? -1;
                  return (
                    <span
                      className={
                        currentRank > index
                          ? 'complete'
                          : currentRank === index
                            ? 'active'
                            : ''
                      }
                      key={phaseName}
                    >
                      {currentRank > index ? <Check size={13} /> : index + 1}
                      <small>{label}</small>
                    </span>
                  );
                })}
              </div>
              {phase === 'error' && (
                <div className="process-error">
                  <AlertCircle />
                  <div>
                    <strong>
                      處理暫停；已完成進度保留，補齊後才匯出完整筆記
                    </strong>
                    <p>{error}</p>
                  </div>
                </div>
              )}
              {phase === 'error' || phase === 'cancelled' ? (
                <div className="process-actions">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPhase('idle');
                      goTo(4);
                    }}
                  >
                    <ArrowLeft size={17} /> 返回設定
                  </Button>
                  {failedStage === 'summary' && transcript ? (
                    <Button
                      className="main-action compact"
                      onClick={() => void retrySummaryOnly()}
                    >
                      <RefreshCw size={17} /> 續跑未完成重點（保留已完成段落）
                    </Button>
                  ) : failedStage === 'correction' && transcript ? (
                    <Button
                      className="main-action compact"
                      onClick={() => void retryCorrectionOnly()}
                    >
                      <RefreshCw size={17} /> 只重試 LLM 校正
                    </Button>
                  ) : (
                    <Button
                      className="main-action compact"
                      onClick={() => void runWorkflow()}
                    >
                      <RefreshCw size={17} /> 重新嘗試
                    </Button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="cancel-button"
                  onClick={() => {
                    activeControllerRef.current?.abort();
                    activeXhrRef.current?.abort();
                  }}
                >
                  <Square size={13} /> 取消處理
                </button>
              )}
              {transcript && (
                <div className="process-actions" style={{ flexWrap: 'wrap' }}>
                  {hasCompleteNotes && (
                    <Button variant="outline" onClick={exportAvailable}>
                      <Download size={17} /> 開啟完整筆記（不消耗 Token）
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() =>
                      downloadDocument(
                        buildMarkdown({
                          filename: file?.name ?? '錄音.m4a',
                          transcript,
                          model,
                          generatedAt: new Date().toLocaleString('zh-TW'),
                        }),
                        `${safeBaseName(file?.name ?? '錄音')}-逐字稿.md`,
                      )
                    }
                  >
                    <FileText size={17} /> 另存逐字稿
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      try {
                        downloadDocument(
                          encodeCheckpoint(currentCheckpoint()),
                          `${safeBaseName(file?.name ?? '錄音')}-復原.json`,
                        );
                      } catch {
                        setSaveWarning('復原檔過大，請先下載逐字稿。');
                      }
                    }}
                  >
                    <Download size={17} /> 下載復原檔（不含 API Key）
                  </Button>
                </div>
              )}
              {saveWarning && <p className="size-note">{saveWarning}</p>}
            </div>
          )}

          {step === 6 && (
            <div className="result-step">
              <div className="result-heading">
                <div className="success-mark">
                  <Check />
                </div>
                <div>
                  <p className="step-kicker">
                    步驟 6 / 6 · {partialResult ? '部分結果可匯出' : '已生成'}
                  </p>
                  <h2>
                    {partialResult
                      ? '已有重點可下載，未完成範圍已標示'
                      : '你的筆記準備好了'}
                  </h2>
                  <p>{outputFilename}</p>
                </div>
              </div>
              <div className="result-actions">
                <Button variant="outline" onClick={() => void copyMarkdown()}>
                  {copied ? <Check size={17} /> : <Clipboard size={17} />}
                  {copied ? '已複製' : '複製'}
                </Button>
                <Button className="download-action" onClick={downloadMarkdown}>
                  <Download size={17} /> 下載 .md
                </Button>
                {mode === 'summary' && file && transcript && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      downloadDocument(
                        buildMarkdown({
                          filename: file.name,
                          transcript,
                          model,
                          generatedAt: new Date().toLocaleString('zh-TW'),
                        }),
                        `${safeBaseName(file.name)}-逐字稿.md`,
                      )
                    }
                  >
                    <FileText size={17} /> 另存逐字稿
                  </Button>
                )}
              </div>
              <MarkdownPreview markdown={markdown} />
              {partialResult && (
                <p className="size-note">
                  已完成的內容會保留；請按補齊，只處理尚未完成的分段。補齊會有新的
                  LLM 費用，但不重新轉錄，也不重新生成已完成內容。
                </p>
              )}
              {partialResult && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setPhase('idle');
                    goTo(3);
                  }}
                >
                  保留逐字稿並調整模型
                </Button>
              )}
              {partialResult && hasPendingRecovery && (
                  <Button
                    variant="outline"
                    onClick={() => void retrySummaryOnly()}
                  >
                    <RefreshCw size={17} /> 補齊未完成段落（保留已完成內容）
                  </Button>
                )}
              <button
                type="button"
                className="restart-link"
                onClick={resetHome}
              >
                <RotateCcw size={16} /> 重新開始
              </button>
            </div>
          )}
        </div>
      </section>
      <footer>高科 iAI · Asr 語音轉錄 · Nkust / Furen 逐字稿校正與學習重點整理</footer>
    </main>
  );
}
