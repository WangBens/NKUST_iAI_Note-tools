import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import {
  summarizeDirectStudyNotes,
  DIRECT_NOTES_VERSION,
  MAX_DIRECT_TRANSCRIPT_CHARS,
} from '../lib/direct-study.ts';
import {
  hasCompleteStudyNotes,
  composeCompleteNotes,
} from '../lib/generic-study.ts';
import {
  buildMarkdown,
  assertNotesMath,
  assertReadableNotes,
} from '../lib/iai-workflow.ts';

const SAMPLE_LECTURES = [
  {
    name: '嵌入式系統（旗標、8051 中斷與 STM32 Datasheet）',
    filename: '2026-11-19嵌入式1.m4a',
    transcript: [
      '今天我們講嵌入式系統的旗標 Flag，它就是暫存器裡面的單一位元，用來表示硬體狀態，例如溢位或進位。旗標分為軟體清除與硬體清除兩種方式。',
      '標準的 8051 有六個中斷來源、五個中斷向量與兩種優先權等級。中斷向量就是 CPU 被中斷觸發時跳去抓中斷服務常式 ISR 的記憶體入口位置。',
      '另外補充電力線傳輸 Powerline Communication，透過一百一、兩百多伏特的既有電力線傳資料，但容易受冷氣或馬達干擾；以及工廠自動化常用的可程式邏輯控制器 PLC。',
      '開源硬體像 Linux、Arduino、RISC-V 的精神是把電路圖、PCB layout 與模擬結果全部公開，能當場 Demo 驗證才是真工程。',
      '最後查詢 STM32F103 的 Datasheet 與方塊圖 Block Diagram 時，重點是看記憶體、時脈、工作電壓與 GPIO、Timer、UART 等週邊資源，實務開發週邊驅動比 CPU 內部架構更重要。',
    ].join('\n'),
    modelReply: `<think>讓我先分析這份逐字稿...</think>
## 這堂課在講什麼

本堂課從微控制器的旗標機制出發，依序介紹 8051 中斷結構、電力線通訊與 PLC，接著探討開源硬體的實證驗證精神，最後說明如何透過 STM32F103 Datasheet 查詢硬體規格與週邊資源。

**核心主線：掌握旗標與中斷的底層運作原理，並以可驗證的開源思維與週邊驅動能力作為嵌入式系統開發的核心。**

### 建議閱讀順序

1. 先理解旗標的設定、軟體清除與硬體清除差異。
2. 掌握 8051 六個中斷來源、五個中斷向量與兩種優先權等級。
3. 了解開源硬體驗證原則與 Datasheet 查詢重點。

### 核心主軸

- **旗標 Flag**：暫存器中的單一位元，用以表示運算或硬體狀態。
- **8051 中斷架構**：6 個中斷來源、5 個中斷向量、2 種優先權等級。
- **工程驗證原則**：設計資源公開且能當場 Demo 重現。

## 核心專有名詞對照表

| 中文 | 英文 | 白話說明 |
| --- | --- | --- |
| 旗標 | Flag | 暫存器中用來指示硬體狀態的單一位元 |
| 中斷向量 | Interrupt Vector | CPU 響應中斷時跳轉執行 ISR 的記憶體入口位址 |
| 可程式邏輯控制器 | Programmable Logic Controller (PLC) | 工業自動化常用的可程式控制系統 |
| 阿坪公司（假設名稱） | Aping Corp (phonetic guess) | 無法查證實體 |

## 旗標與 8051 中斷架構

旗標 Flag 是微控制器暫存器中的單一位元，用來即時反映溢位或進位等狀態。程式可透過軟體清除，或由硬體依條件自動復位。

- **6 個中斷來源、5 個中斷向量**：標準 8051 的中斷事件分派架構。
- **2 種優先權等級**：決定多個中斷同時發生時的先後順序。
- **電力線通訊**：利用既有 110V 或 200V 電力線傳輸資料（50/60Hz 交流電）。

## STM32F103 Datasheet 查詢與週邊驅動

查詢 STM32F103C8T6 的 Datasheet 時，應透過方塊圖 Block Diagram 了解核心與週邊配置。

- **Flash 記憶體**：64KB~128KB（存放程式碼）。
- **SRAM**：20KB（存放變數與堆疊）。
- **工作電壓與頻率**：2.0V~3.6V，最高 72MHz。
- **老師特別提醒**：實務開發重心在於 GPIO、Timer、UART 等週邊驅動，而非僅研究 CPU 內部架構。

## 總整理表

| 主題 | 內容 | 使用時機 |
| --- | --- | --- |
| 旗標 Flag | 單一位元表示硬體狀態，分軟硬體清除 | 判斷運算結果或週邊事件時 |
| 8051 中斷架構 | 6 來源、5 向量、2 優先權等級 | 設計即時硬體事件響應時 |
| Datasheet 查詢 | 檢視記憶體、時脈、電壓與週邊方塊圖 | 晶片選型與系統整合開發時 |

## 常見失分點與迷思

1. **將中斷向量誤認為數學幾何向量。** 中斷向量是指 CPU 跳轉執行 ISR 的記憶體入口位址。
2. **只專注於 CPU 內部架構而忽略週邊 I/O。** 實務開發中大部分工作集中在 GPIO、Timer 與通訊介面設定。

## 老師可能會考的考題

### 觀念題

**題目：** 請說明標準 8051 的中斷架構組成與中斷向量的意義。
- **作答要點：** 包含 6 個中斷來源、5 個中斷向量與 2 種優先權等級；中斷向量代表 CPU 跳轉執行 ISR 的記憶體位置。

**題目：** 請列出 STM32F103C8T6 的關鍵規格（Flash、SRAM、工作電壓、最高頻率）。
- **作答要點：** Flash 64KB~128KB、SRAM 20KB、工作電壓 2.0V~3.6V、最高頻率 72MHz。

## 考前自我檢查

- 我能區分旗標的軟體清除與硬體清除機制。
- 我能說出 8051 的中斷來源、向量與優先權結構。
- 我能說明開源硬體為何強調公開資料與現場 Demo。
- 我能透過 Datasheet 方塊圖查詢微控制器的記憶體與週邊配置。`,
  },
  {
    name: '工程數學（一階正合微分方程）',
    filename: '2026-09-15_工程數學.m4a',
    transcript: [
      '這節工程數學講一階正合微分方程 Exact Differential Equation，標準形式寫作 M(x,y)dx + N(x,y)dy = 0。',
      '如果在開單連通區域 D 上 M 與 N 具有連續一階偏導數，那這個方程為正合的充分必要條件就是 ∂M/∂y = ∂N/∂x。',
      '老師特別提醒，考試很常考先檢驗正合條件，再對 M 對 x 積分求勢函數 f(x,y)，記得積分常數要寫成 y 的函數 g(y)，最後對 y 偏微分比對 N 求出 g(y)。',
      '例題：解 (2xy + 3)dx + (x^2 - 1)dy = 0。檢查 ∂M/∂y = 2x，∂N/∂x = 2x，兩者相等所以是正合方程，積分得 f(x,y) = x^2 y + 3x - y = C。',
    ].join('\n'),
    modelReply: `## 這堂課在講什麼

本堂課介紹一階正合微分方程的標準形式、判別準則以及透過勢函數求解的完整步驟，並以具體例題示範檢驗與積分流程。

**核心主線：先驗證偏導數相等的正合條件，再透過偏積分與待定函數求出隱式通解 $f(x,y)=C$。**

### 建議閱讀順序

1. 熟記正合微分方程的標準式與判別條件。
2. 掌握偏積分搭配待定函數 $g(y)$ 的求解步驟。
3. 跟著課堂例題完整演練一次。

### 核心主軸

$$
M(x,y)\,dx + N(x,y)\,dy = 0
$$

$$
\\frac{\\partial M}{\\partial y} = \\frac{\\partial N}{\\partial x}
$$

## 核心專有名詞對照表

| 中文 | 英文 | 白話說明 |
| --- | --- | --- |
| 正合微分方程 | Exact Differential Equation | 左式恰好為某個雙變數勢函數全微分的微分方程 |
| 勢函數 | Potential Function | 滿足 $df = M\\,dx + N\\,dy$ 的雙變數函數 $f(x,y)$ |

## 正合條件與求解步驟

在開單連通區域 $D$ 上，若 $M(x,y)$ 與 $N(x,y)$ 具有連續一階偏導數，則方程為正合的充要條件為 $\\frac{\\partial M}{\\partial y} = \\frac{\\partial N}{\\partial x}$。

- **步驟一**：計算 $\\frac{\\partial M}{\\partial y}$ 與 $\\frac{\\partial N}{\\partial x}$ 確認相等。
- **步驟二**：將 $M(x,y)$ 對 $x$ 偏積分，並加上僅與 $y$ 有關的函數 $g(y)$。
- **步驟三**：對結果取 $y$ 偏導並令其等於 $N(x,y)$，解出 $g(y)$。
- **老師特別提醒**：對 $x$ 偏積分後的積分常數必須寫成 $g(y)$，不可只寫常數 $C$。

### 課堂例題

求解 $(2xy + 3)\\,dx + (x^2 - 1)\\,dy = 0$：

$$
\\begin{aligned}
\\frac{\\partial M}{\\partial y} &= 2x, \\quad \\frac{\\partial N}{\\partial x} = 2x \\\\
f(x,y) &= \\int (2xy + 3)\\,dx = x^2 y + 3x + g(y) \\\\
\\frac{\\partial f}{\\partial y} &= x^2 + g'(y) = x^2 - 1 \\implies g(y) = -y \\\\
x^2 y + 3x - y &= C
\\end{aligned}
$$

## 總整理表

| 主題 | 內容 | 使用時機 |
| --- | --- | --- |
| 正合判別式 | $\\frac{\\partial M}{\\partial y} = \\frac{\\partial N}{\\partial x}$ | 判斷是否可直接用勢函數求解時 |
| 偏積分求勢函數 | $f(x,y) = \\int M\\,dx + g(y)$ | 確認為正合方程後求解通解時 |

## 常見失分點與迷思

1. **偏積分常數誤寫為純常數 $C$。** 對 $x$ 積分時 $y$ 視為常數，因此必須加上 $g(y)$ 而非純常數。

## 老師可能會考的考題

### 計算/實作題

**題目：** 檢驗 $(2xy + 3)\\,dx + (x^2 - 1)\\,dy = 0$ 是否為正合微分方程並求通解。
- **作答要點：** 先證 $\\frac{\\partial M}{\\partial y} = \\frac{\\partial N}{\\partial x} = 2x$，再積分求得 $x^2 y + 3x - y = C$。

## 考前自我檢查

- 我能正確寫出正合微分方程的判別條件。
- 我能完整執行偏積分並求出待定函數 $g(y)$。`,
  },
];

test('single-shot direct whole-transcript mode produces one cohesive zero-hallucination handout in 1 call and caches resume', async () => {
  for (const sample of SAMPLE_LECTURES) {
    const cache = { signature: sample.filename, drafts: [], parts: [], merges: {} };
    let calls = 0;
    let receivedMaxTokens = 0;
    const chat = async (messages, maxTokens) => {
      calls++;
      receivedMaxTokens = maxTokens ?? 0;
      assert.equal(messages.length, 2);
      assert.match(messages[0].content, /嚴格只用提供的逐字稿資料/);
      assert.ok(messages[1].content.includes(sample.transcript));
      return sample.modelReply;
    };

    const notes = await summarizeDirectStudyNotes(sample.transcript, chat, cache, {
      rawText: sample.transcript,
      filename: sample.filename,
    });
    assert.equal(calls, 1, `Expected exactly 1 LLM call for ${sample.name}`);
    assert.equal(receivedMaxTokens, 16_384);
    assert.equal(cache.finalNotes?.key, DIRECT_NOTES_VERSION);
    assert.equal(hasCompleteStudyNotes(cache), true);
    assert.equal(composeCompleteNotes(cache), notes);

    // Second call with same cache consumes 0 LLM calls
    const resumed = await summarizeDirectStudyNotes(sample.transcript, chat, cache, {
      rawText: sample.transcript,
    });
    assert.equal(calls, 1);
    assert.equal(resumed, notes);

    const md = buildMarkdown({
      filename: sample.filename,
      transcript: sample.transcript,
      notes,
      model: 'Furen-std',
      generatedAt: '2026-11-22',
    });
    assertReadableNotes(md);
    await assertNotesMath(md);

    // Exactly ONE `## 這堂課在講什麼` and NO <think> leak
    assert.equal((md.match(/^## 這堂課在講什麼$/gm) ?? []).length, 1);
    assert.doesNotMatch(md, /<think>|<\/think>/);

    if (sample.filename.includes('嵌入式')) {
      // Hallucinated specs & hypothetical entities stripped
      assert.doesNotMatch(
        md,
        /64KB|128KB|20KB|72MHz|2\.0V|3\.6V|50\/60Hz|C8T6|阿坪公司|Aping Corp|phonetic guess/,
      );
      // Grounded facts preserved
      assert.match(md, /8051/);
      assert.match(md, /110V/);
      assert.match(md, /200V/);
      assert.match(md, /STM32F103/);
    } else {
      assert.match(md, /\\frac\{\\partial M\}\{\\partial y\}/);
      assert.match(md, /x\^2 y \+ 3x - y/);
    }
  }
});

test('local bridge enforces enable_thinking: false by default on /v1/chat/completions', async () => {
  let capturedBody = null;
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      capturedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: '## 這堂課在講什麼\n\n測試回應。' },
            },
          ],
        }),
      );
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;
  const bridgePort = 43950 + Math.floor(Math.random() * 500);
  const bridge = spawn(process.execPath, ['local/iai-bridge.mjs'], {
    env: {
      ...process.env,
      IAI_BRIDGE_PORT: String(bridgePort),
      IAI_CHAT_URL: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('bridge start timeout')), 5000);
      bridge.stdout.on('data', (chunk) => {
        if (chunk.toString('utf8').includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const res = await fetch(`http://127.0.0.1:${bridgePort}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'Furen-std',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /測試回應/);
    assert.deepEqual(capturedBody?.chat_template_kwargs, {
      enable_thinking: false,
    });
  } finally {
    bridge.kill();
    upstream.close();
  }
});

test('extraordinarily long transcripts (> 60,000 chars) split into large parts plus 1 final merge call', async () => {
  const unit =
    '這是一段模擬長課堂的逐字稿內容，講解線性代數的矩陣特徵值與特徵向量定義 Av = λv。\n';
  const hugeTranscript = unit.repeat(
    Math.ceil((MAX_DIRECT_TRANSCRIPT_CHARS + 5000) / unit.length),
  );
  const cache = { signature: 'huge', drafts: [], parts: [], merges: {} };
  let calls = 0;
  const chat = async (messages) => {
    calls++;
    return `## 這堂課在講什麼\n\n本段說明矩陣特徵值 $Av = \\lambda v$（呼叫 ${calls}）。`;
  };
  const notes = await summarizeDirectStudyNotes(hugeTranscript, chat, cache);
  assert.equal(calls, 3); // 2 large parts + 1 final merge
  assert.match(notes, /呼叫 3/);
  assert.equal(hasCompleteStudyNotes(cache), true);
});

test('direct mode separates <system_rules> and <lecture_transcript> and safely recovers malformed LaTeX without pausing export', async () => {
  const transcript =
    '這堂工程數學課講一階正合微分方程 M(x,y)dx + N(x,y)dy = 0，滿足 ∂M/∂y = ∂N/∂x 時可求勢函數 f(x,y) = C。';
  const cache = { signature: 'latex-recovery', drafts: [], parts: [], merges: {} };
  const brokenLatexReply = [
    '## 這堂課在講什麼',
    '本堂課說明正合微分方程的判別與求解。',
    '### 核心主軸',
    '- 合法公式：$\\frac{\\partial M}{\\partial y} = \\frac{\\partial N}{\\partial x}$',
    '- 破損空格反斜線公式：$\\ frac{a}{b}$',
    '- 未閉合大括號公式：$\\frac{1}{2$',
    '',
    '## 正合條件與推導',
    '$$',
    '\\begin{aligned}',
    'M(x,y)\\,dx + N(x,y)\\,dy &= 0 \\\\',
    'f(x,y) &= C',
    '\\end{aligned}',
    '$$',
    '',
    '$$',
    '\\unknownBrokenMacro{123',
    '$$',
  ].join('\n');

  let seenSystem = '';
  let seenUser = '';
  const notes = await summarizeDirectStudyNotes(
    transcript,
    async (messages) => {
      seenSystem = messages[0].content;
      seenUser = messages[1].content;
      return brokenLatexReply;
    },
    cache,
  );

  // Verify strict separation between rules and transcript
  assert.match(seenSystem, /^<system_rules>/);
  assert.match(seenSystem, /<\/system_rules>$/);
  assert.match(seenUser, /<lecture_transcript>/);
  assert.match(seenUser, /<\/lecture_transcript>/);

  // Verify valid LaTeX is preserved AND malformed LaTeX is safely downgraded without throwing
  const md = buildMarkdown({
    filename: '工程數學.m4a',
    transcript,
    notes,
    model: 'Furen-std',
    generatedAt: '2026-11-24',
  });
  assertReadableNotes(md);
  await assertNotesMath(md);
  assert.match(md, /\\frac\{\\partial M\}\{\\partial y\}/);
  assert.match(md, /\\begin\{aligned\}/);
});

