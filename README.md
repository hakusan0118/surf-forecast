# Taiwan Surf Forecast

手機優先的台灣沿海衝浪預報頁面。

資料來源：中央氣象署

顯示地點（北到南）浪點

每天顯示 00:00 ~ 21：00
- 風速（kt）
- 蒲福風級
- 風向
- 浪高（m）
- 浪向
- 週期（s）

## GitHub 設定

### 1. 加入 CWA API Key

Repository → Settings → Secrets and variables → Actions → New repository secret

Name:

`CWA_API_KEY`

Value:

貼上你的 CWA API 授權碼。

### 2. 手動測試更新

Repository → Actions → Update Surf Forecast → Run workflow

成功後 `data/surf_forecast.json` 會被更新。

### 3. 開啟 GitHub Pages

Repository → Settings → Pages

Source 選：

`Deploy from a branch`

Branch：

`main`

Folder：

`/ (root)`

儲存後，網站網址通常是：

`https://<你的帳號>.github.io/surf-forecast/`

## 自動更新

GitHub Actions 每 3 小時執行一次。排程使用 UTC，但因為是每三小時固定跑一次，對台灣時區仍維持每三小時更新節奏。
