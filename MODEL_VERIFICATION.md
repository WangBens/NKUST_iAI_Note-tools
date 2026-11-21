# 高科 iAI 模型與計費核對

核對日期：2026-09-08（Asia/Taipei）

官方公開模型資料：<https://www.iai.nkust.edu.tw/iaibackend/api/admin/models>

## 可確認資料

高科 iAI 公開模型清單可確認以下 API 別名與官方顯示計費。單位在官網介面寫成 `/tk`，未另外公開幣別或額度換算方式，因此 DEMO 不自行改寫成「元」或「每千 tokens」。

| API 別名 | 類別 | 輸入計費 | 輸出計費 |
| --- | --- | ---: | ---: |
| `Asr` | 語音處理 | 1.0/tk | 1.0/tk |
| `Furen-omni` | LLM | 0.1/tk | 0.2/tk |
| `Furen-std` | LLM | 0.15/tk | 0.3/tk |
| `Furen-large` | LLM | 0.2/tk | 0.4/tk |
| `Furen-max` | LLM | 0.5/tk | 1.0/tk |

`Asr` 的確是高科 iAI 公開列出的語音處理模型別名。不過公開欄位只寫語音識別功能，沒有出現 `Whisper`，因此目前只能確認「呼叫時使用 Asr」，不能以公開證據確認底層一定是 Whisper。

## 尚不能由高科 iAI 公開資料確認的對應

| 高科 iAI 別名 | 提供的底層對應 | 核對結論 |
| --- | --- | --- |
| `Furen-omni` | `nemotron-omni-30b` | NVIDIA 公開模型家族中有 Nemotron 3 Nano Omni 30B，但高科 iAI 公開清單未提供底層欄位，無法確認此別名對應。 |
| `Furen-std` | `gemma-4-31b` | Google 公開有 Gemma 4 31B，但高科 iAI 公開清單未提供底層欄位，無法確認此別名對應。 |
| `Furen-large` | `nemotron-3-super-120b` | NVIDIA 公開有 Nemotron 3 Super 120B，但高科 iAI 公開清單未提供底層欄位，無法確認此別名對應。 |
| `Furen-max` | `nvidia-ultra-550b` | 未找到可核對的 NVIDIA 官方公開模型名稱；可能是校內部署名、尚未公開名稱或拼字差異，需向高科 iAI 管理端確認。 |

外部官方模型資料：

- NVIDIA Nemotron 3 Nano Omni：<https://docs.nvidia.com/nemo/automodel/latest/model-coverage/omni/nemotron-omni>
- Google DeepMind Gemma 4：<https://deepmind.google/models/gemma/gemma-4/>
- NVIDIA Nemotron 3 Super：<https://developer.nvidia.com/blog/introducing-nemotron-3-super-an-open-hybrid-mamba-transformer-moe-for-agentic-reasoning/>

DEMO 只會把 `Asr` 或 Furen 別名送進高科 iAI API；畫面中的底層名稱只作核對註記，不會影響呼叫內容。
