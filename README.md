# 西北打卡系統（GitHub Pages + Firebase）

以低成本架構（前端靜態頁 + Firebase）打造的打卡系統。包含：
- 登入頁（參照 `https://nw-com.github.io/nw-check-in/` 的視覺設計）
- 行動版主頁佈局（10% 頁首 / 10% 頁中上 / 70% 內容 / 10% 頁尾）
- Google 登入（Firebase Auth）
- 打卡示例（Firestore 紀錄、含定位）

## 部署目標
- GitHub Pages（前端靜態檔部署）
- Firebase（Auth + Firestore）

## 快速開始
1. 建立 Firebase 專案：
   - 進入 Firebase Console 新增專案。
   - 建立 Web 應用並取得 **Firebase SDK 設定**。
2. 啟用 Google 登入：
   - Authentication -> Sign-in method -> 啟用 Google。
   - Authorized domains 加入你的 Pages 網域，例如：`yourname.github.io`。
3. 建立 Firestore：
   - 建立資料庫（Production 模式）。
   - 你可以先不設規則，測試後再收緊。
4. 填入前端設定：
   - 編輯 `app.js`，在 `FIREBASE_CONFIG` 物件中填入你的設定：
     ```js
     export const FIREBASE_CONFIG = {
       apiKey: "...",
       authDomain: "<PROJECT_ID>.firebaseapp.com",
       projectId: "<PROJECT_ID>",
       storageBucket: "<PROJECT_ID>.appspot.com",
       messagingSenderId: "...",
       appId: "...",
     };
     ```
   - （選填）若要使用 Google Maps，請另外申請 Maps API Key 並於 `app.js` 設定。

## 角色與權限
角色由高至低：
- 系統管理員、管理層、高階主管、初階主管、行政、一般（總幹事、秘書、清潔、機電）、勤務（保全）

範例資料結構：
- `users/{uid}`：`{ role: "一般", name: "王小明", createdAt: <serverTimestamp> }`
- `checkins/{autoId}`：`{ uid, name, role, lat, lng, createdAt }`

你可以將角色控制邏輯放在前端（顯示/隱藏）或 Firestore 規則中做更嚴謹的限制。

## Firestore 安全規則（範例）
以下為示意，請視需求調整：
```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    match /checkins/{docId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null; // 可再限制角色
    }
  }
}
```

## 本機預覽
若已安裝 Node.js，可在專案根目錄執行：
```bash
npx serve
```
或：
```bash
npx http-server .
```
若你的環境有 Python：
```bash
python -m http.server 5500
```

### Firebase 授權網域設定（登入錯誤修正）
若登入時於瀏覽器主控台看見 `identitytoolkit.googleapis.com` 或 `net::ERR_ABORTED` 相關錯誤，通常是 Firebase Authentication 的「Authorized domains」未包含你的本機預覽網域。

請至 Firebase Console → Authentication → Settings → Authorized domains，加入：
- `localhost`
- `127.0.0.1`
- 視需要加入帶連接埠的網域，例如：`localhost:8000`、`127.0.0.1:5500`

另外請確認 `app.js` 裡的 Firebase 設定：
- `authDomain` 通常為 `<PROJECT_ID>.firebaseapp.com`
- `storageBucket` 通常為 `<PROJECT_ID>.appspot.com`

完成設定後重新整理頁面再試。

## GitHub Pages 部署
1. 建立 GitHub 倉庫並推送此目錄內容。
2. 進入 Repository Settings -> Pages，選擇 `main` 分支與根目錄。
3. 等待 Pages 佈署完成，並在 Firebase 的 Authorized domains 加入 Pages 網域。

## 設計備註
- 登入頁視覺參照原站，結構一致：系統標題、圖示、Google 登入按鈕。
- 主頁採固定列布局以利行動直屏瀏覽：
  - 頁首（10vh）：左側為圖形 + 系統名稱、右側為使用者姓名與圓形照片。
  - 頁中上（10vh）：狀態/身份顯示。
  - 頁中（70vh）：分頁內容（首頁 / 打卡 / 設定）。
  - 頁尾（10vh）：分頁按鈕（無邊框）。

## 常見問題
- 看見「請完成最後的設定步驟」：代表你尚未於 `app.js` 填入 Firebase 設定，請依指示補齊。
- Google 登入跳出視窗被攔截：請允許彈出視窗，或改用 redirect 登入流程。

## 登入方式（Email/密碼，不用 Google）
- 已改為使用 Email/密碼登入，登入頁新增表單與「初始化管理員」按鈕。
- 你可直接輸入預設：`admin@nw-checkin.local` / `Admin2026!` 登入；若尚未建立，按「初始化管理員」即可建立帳號並賦予「系統管理員」角色。
- 初始化後，請到 Firebase Console（Authentication）重設管理員密碼，並保留 Firestore `users/{uid}.role = 系統管理員`。

## 管理員初始化與重設
1. 開啟登入頁，輸入 Email 與密碼（或使用預設）。
2. 點選「初始化管理員」，系統會建立 Firebase 帳號並於 Firestore 寫入 `users/{uid}` 文件：
   - 欄位：`{ role: "系統管理員", name: <email>, createdAt: <serverTimestamp> }`
3. 自動登入完成後，你可以在「設定」分頁或直接於 Console 調整其他使用者角色。
4. 若不再需要預設帳密提示，可在 `index.html` 移除登入卡片中的提示文字。