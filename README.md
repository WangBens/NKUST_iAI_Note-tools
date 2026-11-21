# 高科 iAI 錄音重點 DEMO

這是一個在本機運作的 DEMO。使用者輸入自己的高科 iAI API Key，加入最高 30 MB 的 MP3、M4A 或 WAV 後，可輸出純逐字稿，或再由 Furen 系列 LLM 整理重點，最後下載 Markdown。因高科 iAI 目前會拒絕較大的單一請求，程式會先在本機把錄音轉成 10 分鐘的小段，再依序送往 `Asr`。

## 快速啟動

1. 雙擊 `啟動DEMO.bat`。
2. 第一次執行會安裝必要套件，完成後瀏覽器會開啟 `http://localhost:3000/`。
3. 依照畫面的六步驟嚮導，先驗證 API Key，再選擇錄音、輸出方式與模型。
4. 完成後可在結果頁預覽、複製或下載 Markdown。

上傳與模型產生都可能需要數分鐘。處理期間請保持頁面開啟；畫面會顯示上傳百分比、本機轉碼、IAI 分段回傳、LLM 整理與累計等待時間，也可主動取消。

建議一律使用 `啟動DEMO.bat`。若要手動啟動，請開兩個 PowerShell 視窗，在第一個執行：

```powershell
pnpm install
pnpm run bridge
```

第二個執行：

```powershell
pnpm run dev
```

## API 與資料安全

- API Base URL：`https://www.iai.nkust.edu.tw/aihub/v1`
- 逐字稿：`POST /audio/transcriptions`，傳送模型別名 `Asr`
- 重點整理：`POST /chat/completions`，傳送使用者選擇的 Furen 別名
- API Key 只存在頁面與本機處理程序的暫時記憶體，不使用 localStorage、cookie、資料庫或檔案儲存；重新整理或處理結束後即釋放。
- 錄音會在系統暫存目錄轉碼為單聲道 16 kHz、32 kbps MP3 小段，再送往高科 iAI。原始檔不會被修改，暫存輸入與分段在完成、失敗或取消後都會刪除。
- DEMO 接受單檔最高 `30 × 1024 × 1024` bytes（30 MiB，畫面標示 30 MB）；剛好 30 MB 可加入，超過 1 byte 即會在送出前攔截。
- 2026-09-09 實測直接上傳 14.9 MB M4A 時，高科 iAI 的 nginx 回覆 `413 Request Entity Too Large`；改由本機分成 4 段後，4 個 `Asr` 請求均回覆成功。

## 長時間處理與失敗恢復

- 上傳使用 XHR 顯示瀏覽器交付本機處理器的百分比；本機處理器再以 NDJSON 逐筆回傳轉碼、分段送出、IAI 分段完成與重試事件。畫面進度以已觀察到的事件為準，不假裝能讀取 IAI 內部百分比。
- 本機處理器對每個小段依序呼叫 IAI；`429`、`503`、`504` 會依 `Retry-After` 有限次重試，不會把整份錄音重新上傳。
- 伺服器回覆 `408`、`425`、`429`、`500`、`502`、`503`、`504` 或明示模型載入中時，依 `Retry-After` 或退避時間做有限次自動重試。
- 網路連線直接中斷時不會無條件重送，避免同一請求可能重複計費。
- 長逐字稿會以約 48,000 字元分段整理；成功的分段暫存在頁面記憶體。若 LLM 失敗，可保留逐字稿並只重試整理。
- 處理中可按「取消處理」；檔案與設定會保留，方便重新開始。
- API Key 驗證有 20 秒逾時保護；不同常見 JSON 回應格式與純文字逐字稿回應皆有容錯解析。

## 逐字稿重複清理

- 每一段 `Asr` 回傳後，先偵測連續四次以上的單字、詞組或句子循環；一般口語中兩到三次的重複會保留。
- 合併 10 分鐘分段時，會比對前一段結尾與下一段開頭，移除完全相同的邊界重疊。
- 送入 LLM 前與組裝 Markdown 時各再清理一次，避免異常重複進入摘要或匯出檔。
- 無法解碼的 Unicode replacement character 會移除；正常段落、標點與短口語重複仍保留。

## 測試

```powershell
pnpm run test
pnpm run lint
pnpm run build
```

測試指令會自動啟動隔離的模擬 iAI 與音訊橋接器，驗證 ffmpeg、multipart 上傳、進度串流與重複清理。若要手動測試畫面，也可另啟動模擬 iAI：

```powershell
pnpm run mock
pnpm run dev
```

再開啟 `http://localhost:3000/?testMode=1`。測試模式固定只連線到 `127.0.0.1:4174`，不會把檔案或測試 Key 傳到高科伺服器。測試用 Key 為 `test-valid-key`。詳細結果請看 `TEST_REPORT.md`。

## 建置

```powershell
pnpm run build
```

模型核對結果請看 `MODEL_VERIFICATION.md`。
