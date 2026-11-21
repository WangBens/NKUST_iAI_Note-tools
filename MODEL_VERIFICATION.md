# 高科 iAI 模型與計費標準核對

核對日期：2026-11-21（Asia/Taipei）

官方公開模型資料：<https://www.iai.nkust.edu.tw/iaibackend/api/admin/models>

---

## 高科 iAI 平台可用模型與計費標準

以下清單依據高科 iAI 平台「可用模型與計費標準」頁面最新公告核對（單位為每 1M tokens）：

| 模型別名 | 實際模型 | 類型 | 輸入計費 (Prompt) | 輸出計費 (Completion) | 本工具支援 |
| --- | --- | --- | ---: | ---: | :---: |
| `Asr` | `whisper` | 語音處理 (ASR & TTS) | 1/1M | 1/1M | ✅ 語音轉錄 |
| `Nkust` | `Nkust` | 大型語言模型 (LLM) | 0.09/1M | 0.34/1M | ✅ 逐字稿校正與筆記整理 |
| `Furen-omni` | `nemotron-omni-30b` | 大型語言模型 (LLM) | 0.1/1M | 0.2/1M | ✅ 逐字稿校正與筆記整理 |
| `Furen-std` | `nemotron-3-super-120b` | 大型語言模型 (LLM) | 0.15/1M | 0.3/1M | ✅ 逐字稿校正與筆記整理（預設推薦） |
| `Furen-coder` | `nemotron-3-super-120b` | 大型語言模型 (LLM) | 0.2/1M | 0.4/1M | ✅ 逐字稿校正與筆記整理 |
| `Furen-large` | `nemotron-3-super-120b` | 大型語言模型 (LLM) | 0.2/1M | 0.4/1M | ✅ 逐字稿校正與筆記整理 |
| `Furen-max` | `nvidia-nemotron-3-ultra-550b-a55b` | 大型語言模型 (LLM) | 0.5/1M | 1/1M | ✅ 逐字稿校正與筆記整理 |
| `Speaker` | `s2-pro` | 語音處理 (ASR & TTS) | 1/1M | 1/1M | —（語音合成用） |
| `Embedding` | `bge-m3-embedding` | 向量資料處理 (Embedding) | 0.003/1M | 0.01/1M | —（向量檢索用） |
| `Furen-reranker` | `reranker` | 重排序模型 | 0.000001/1M | 0.000003/1M | —（檢索重排用） |
| `Pic-large` | `flux2-klein` | 圖像生成 (生圖) | 1/1M | 1/1M | —（圖像生成用） |
| `Pic-small` | `z-image` | 圖像生成 (生圖) | 1/1M | 1/1M | —（圖像生成用） |

---

## 呼叫說明

- **語音轉錄階段**：固定呼叫高科 iAI 平台之 `Asr`（實際模型 `whisper`），由本機 `ffmpeg` 自動分段轉碼後逐段送出。
- **逐字稿校正與重點整理階段**：使用者可於介面步驟 3 自由選擇 `Nkust`、`Furen-omni`、`Furen-std`、`Furen-coder`、`Furen-large` 或 `Furen-max`。
- 本工具僅傳送官方別名至高科 iAI API；畫面顯示之實際模型名稱與計費資訊皆同步對應高科 iAI 官方公告。
