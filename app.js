// app.js
// 單頁應用（SPA）控制：登入與主頁顯示、Firebase Auth、分頁切換、打卡範例

// ===== 1) 設定區：請填入您的 Firebase Web 應用設定 =====
// 取得方式：Firebase Console -> 專案設定 -> 您的應用 -> Firebase SDK snippet
window.FIREBASE_CONFIG = window.FIREBASE_CONFIG || {
  apiKey: "AIzaSyDdetnrACoNTSV3ZqFBPOSfnZzRtmk5fk8",
  authDomain: "nw-checkin.firebaseapp.com",
  projectId: "nw-checkin",
  storageBucket: "nw-checkin.appspot.com",
  messagingSenderId: "520938520545",
  appId: "1:520938520545:web:fb32a42eb1504aab041ca0",
  measurementId: "G-G6M6NGBC03",
};

// Google Maps API Key（來自使用者提供）
const GOOGLE_MAPS_API_KEY = "AIzaSyAzhLdWtycJgfz8UsXWlji63DkXpA4kmyY";

// 若您需要使用 Google Maps，請在此填入 API 金鑰（選填，用於定位或地圖顯示）
// export const GOOGLE_MAPS_API_KEY = "YOUR_GOOGLE_MAPS_API_KEY";

// 角色階層（由高至低），請依需求調整
// 改用全域變數以避免重複宣告衝突
window.Roles = window.Roles || [
  "系統管理員",
  "管理層",
  "高階主管",
  "初階主管",
  "行政",
  "總幹事",
  "秘書",
  "清潔",
  "機電",
  "保全",
];

// ===== 2) DOM 參考 =====
const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const setupWarning = document.getElementById("setup-warning");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const emailSignInBtn = document.getElementById("emailSignIn");
const applyAccountBtn = document.getElementById("applyAccountBtn");
const togglePasswordBtn = document.getElementById("togglePassword");
const togglePasswordIcon = document.getElementById("togglePasswordIcon");

const userNameEl = document.getElementById("userName");
const userPhotoEl = document.getElementById("userPhoto");
const subTabsEl = document.getElementById("subTabs");
const homeHero = document.getElementById("homeHero");
const homeHeroPhoto = document.getElementById("homeHeroPhoto");
// 移除 hero-crop：不再需要 F 行底部裁切顯示
// 首頁：A/B/C/D/E 堆疊容器
const homeHeaderStack = document.getElementById("homeHeaderStack");
// 首頁：地圖覆蓋層
const homeMapOverlay = document.getElementById("homeMapOverlay");
const homeMapImg = document.getElementById("homeMapImg");
// 首頁：日期、時間、農曆
const homeTimeEl = document.getElementById("homeTime");
const homeDateEl = document.getElementById("homeDate");
// 首頁 D 區塊：登入者姓名（顯示於地圖之上、文字之下）
const homeHeaderNameEl = document.getElementById("homeHeaderName");
// 舊版農曆元素（首頁已不再顯示），保留為相容但不再更新
const homeLunarEl = document.getElementById("homeLunar");
let homeClockTimer = null;
let lastCoords = null;
let geoRefreshTimer = null;
// 首頁：頁中 F–K（狀態與操作）
const homeMidStack = document.getElementById("homeMidStack");
const homeStatusEl = document.getElementById("homeStatus");
const btnStart = document.getElementById("btnStart");
const btnEnd = document.getElementById("btnEnd");
const btnOut = document.getElementById("btnOut");
const btnArrive = document.getElementById("btnArrive");
const btnReturn = document.getElementById("btnReturn");
const btnLeave = document.getElementById("btnLeave");
const btnLeaveRequest = document.getElementById("btnLeaveRequest");
const btnMakeup = document.getElementById("btnMakeup");

try {
  const origErr = console.error;
  console.error = function (...args) {
    const text = args.map((a) => {
      if (typeof a === 'string') return a;
      if (a && a.stack) return String(a.stack);
      if (a && a.message) return String(a.message);
      return '';
    }).join(' ');
    if (
      text.includes('Firestore/Listen/channel') ||
      text.includes('documents:runQuery') ||
      text.includes('documents:batchGet') ||
      text.includes('documents:commit') ||
      text.includes('@firebase/firestore') ||
      text.includes('RPC_ERROR') ||
      text.includes('ERR_ABORTED') ||
      text.includes('ERR_CONNECTION_RESET')
    ) return;
    return origErr.apply(console, args);
  };
} catch {}

let isLoadingCheckins = false;
let firebaseInitialized = false;
let authListenerAttached = false;

function updateHomeMap() {
  if (!homeMapImg || !lastCoords) return;
  const { latitude, longitude } = lastCoords;
  const lat = Number(latitude).toFixed(6);
  const lon = Number(longitude).toFixed(6);
  // 使用 Google 靜態地圖（目前位置）並疊加於頁首紅色區塊
  const size = "1200x600"; // 大尺寸以便縮放覆蓋 40vh
  const zoom = 15;
  const marker = `markers=color:red|${lat},${lon}`;
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=${zoom}&size=${size}&maptype=roadmap&${marker}&key=${GOOGLE_MAPS_API_KEY}`;
  homeMapImg.src = url;
}

function two(n) { return n < 10 ? "0" + n : "" + n; }
async function initNetworkTime() {
  appState.timeOffsetMs = 0;
  appState.networkTimeOk = true;
}
async function ensureNetworkTime() {
  if (appState.networkTimeOk === true) return true;
  appState.timeOffsetMs = 0;
  appState.networkTimeOk = true;
  return true;
}
function networkNowMs() { return Date.now() + (appState.timeOffsetMs || 0); }
function nowInTZ(tz) {
  const base = new Date(networkNowMs());
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const parts = fmt.formatToParts(base);
  const pick = (t) => parts.find((p) => p.type === t)?.value || '0';
  const y = Number(pick('year'));
  const m = Number(pick('month')) - 1;
  const d = Number(pick('day'));
  const hh = Number(pick('hour'));
  const mm = Number(pick('minute'));
  const ss = Number(pick('second'));
  return new Date(y, m, d, hh, mm, ss);
}
function getTwHolidaySetForYear(y) {
  try {
    const raw = localStorage.getItem('twNationalHolidays');
    const cfg = raw ? JSON.parse(raw) : {};
    const arr = (cfg && cfg[y]) || null;
    if (Array.isArray(arr) && arr.length) return new Set(arr);
  } catch {}
  const mmdd = (m, d) => `${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const base = [mmdd(1,1), mmdd(2,28), mmdd(4,4), mmdd(4,5), mmdd(5,1), mmdd(10,10)];
  return new Set(base.map((s) => `${y}-${s}`));
}
function isTWNationalHoliday(date) {
  const y = date.getFullYear();
  const m = date.getMonth()+1;
  const d = date.getDate();
  const key = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const set = getTwHolidaySetForYear(y);
  return set.has(key);
}
function defaultRosterStatusForDate(date) {
  const wd = date.getDay();
  const weekendOrFri = (wd === 0 || wd === 6 || wd === 5);
  return (weekendOrFri || isTWNationalHoliday(date)) ? '休假日' : '上班日';
}
function formatDateYYYYMMDD(d) {
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}
function formatYmdTZ(d, tz) {
  try {
    const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(d);
  } catch {
    const dd = nowInTZ(tz);
    return dd.getFullYear() + '-' + two(dd.getMonth() + 1) + '-' + two(dd.getDate());
  }
}
function formatDateTimeTZ(d, tz) {
  try {
    const ymd = formatYmdTZ(d, tz);
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
    return `${ymd} ${t}`;
  } catch {
    const dd = nowInTZ(tz);
    return `${formatDateYYYYMMDD(dd)} ${two(dd.getHours())}:${two(dd.getMinutes())}:${two(dd.getSeconds())}`;
  }
}
function formatYmTZ(d, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(d).split('-');
    return `${parts[0]}-${parts[1]}`;
  } catch {
    const dd = nowInTZ(tz);
    return `${dd.getFullYear()}-${two(dd.getMonth() + 1)}`;
  }
}
function formatDatetimeLocalTZ(d, tz) {
  try {
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    return `${date}T${time}`;
  } catch {
    const dd = nowInTZ(tz);
    return `${formatDateYYYYMMDD(dd)}T${two(dd.getHours())}:${two(dd.getMinutes())}`;
  }
}
// 近似判斷當日是否為 24 節氣（本地時區），若符合顯示節氣名稱
function getApproxSolarTerm(date) {
  const md = two(date.getMonth() + 1) + '-' + two(date.getDate());
  const terms = {
    '01-05': '小寒', '01-06': '小寒',
    '01-20': '大寒', '01-21': '大寒',
    '02-03': '立春', '02-04': '立春', '02-05': '立春',
    '02-18': '雨水', '02-19': '雨水', '02-20': '雨水',
    '03-05': '驚蟄', '03-06': '驚蟄',
    '03-20': '春分', '03-21': '春分',
    '04-04': '清明', '04-05': '清明',
    '04-19': '穀雨', '04-20': '穀雨',
    '05-05': '立夏', '05-06': '立夏', '05-07': '立夏',
    '05-20': '小滿', '05-21': '小滿', '05-22': '小滿',
    '06-05': '芒種', '06-06': '芒種',
    '06-21': '夏至', '06-22': '夏至',
    '07-06': '小暑', '07-07': '小暑', '07-08': '小暑',
    '07-22': '大暑', '07-23': '大暑', '07-24': '大暑',
    '08-07': '立秋', '08-08': '立秋', '08-09': '立秋',
    '08-22': '處暑', '08-23': '處暑', '08-24': '處暑',
    '09-07': '白露', '09-08': '白露', '09-09': '白露',
    '09-22': '秋分', '09-23': '秋分', '09-24': '秋分',
    '10-08': '寒露', '10-09': '寒露',
    '10-23': '霜降', '10-24': '霜降',
    '11-07': '立冬', '11-08': '立冬',
    '11-22': '小雪', '11-23': '小雪',
    '12-06': '大雪', '12-07': '大雪', '12-08': '大雪',
    '12-21': '冬至', '12-22': '冬至', '12-23': '冬至'
  };
  return terms[md] || '';
}
function getLunarString(d) {
  // 優先使用 Intl 中文曆（指定台灣時區），部分行動裝置會因時區差造成隔天偏移
  try {
    const fmt = new Intl.DateTimeFormat('zh-TW-u-ca-chinese', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric' });
    const lunar = fmt.format(d);
    const term = getApproxSolarTerm(d);
    return term ? `農曆 ${lunar}（${term}）` : `農曆 ${lunar}`;
  } catch (e) {
    // 後備：顯示簡短文字，避免手機不支援時顯示錯誤內容
    return '農曆（裝置不支援）';
  }
}
function updateHomeClockOnce() {
  const now = nowInTZ('Asia/Taipei');
  if (homeTimeEl) homeTimeEl.textContent = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
  if (homeDateEl) homeDateEl.textContent = `${formatDateYYYYMMDD(now)} (${weekdayZH(now)})`;
}
async function startHomeClock() {
  try { await ensureNetworkTime(); } catch {}
  stopHomeClock();
  updateHomeClockOnce();
  homeClockTimer = setInterval(updateHomeClockOnce, 1000);
}
function stopHomeClock() {
  if (homeClockTimer) { clearInterval(homeClockTimer); homeClockTimer = null; }
}

// 週幾（中）
function weekdayZH(d) {
  const days = "日一二三四五六";
  return days[d.getDay()] || "";
}

function renderHomeStatusText(str) {
  const el = homeStatusEl;
  if (!el) return;
  const s = String(str || "").trim();
  const parts = s.split(/\s+/);
  if (parts.length >= 2) {
    const flag = parts.pop();
    const status = parts.pop();
    const before = parts.join(" ");
    const flagCls = (() => { const f = String(flag||''); return f.startsWith('異常') ? 'bad' : (f === '正常' ? 'good' : ''); })();
    const baseStatus = String(status).split('-')[0];
    const statusCls = (() => {
      switch (baseStatus) {
        case "上班": return "work";
        case "下班": return "off";
        case "外出": return "out";
        case "抵達": return "arrive";
        case "離開": return "leave";
        case "返回": return "return";
        default: return "";
      }
    })();
    const m = before.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})(?:\s+(.+))?$/);
    const dateText = m ? m[1] : before;
    const locText = m ? (m[2] || "") : "";
    const nameText = (homeHeaderNameEl?.textContent || '').replace(/^歡迎~\s*/, '') || '';
    el.style.textAlign = "center";
    const reasonPart = (() => { const s1 = String(status||''); const i = s1.indexOf('-'); return i >= 0 ? s1.slice(i+1) : ''; })();
    const flagText = (() => {
      if ((baseStatus === '外出' || baseStatus === '抵達' || baseStatus === '離開') && reasonPart) {
        const rules = Array.isArray(appState.pointsRules) ? appState.pointsRules : [];
        const r = rules.find((x) => String(x.reason||'') === String(reasonPart));
        const abnormal = r && String(r.status||'') === '異常';
        return abnormal ? `異常-${reasonPart}` : '正常';
      }
      return flag;
    })();
    const flagCls2 = (() => { const f = String(flagText||''); return f.startsWith('異常') ? 'bad' : (f === '正常' ? 'good' : ''); })();
    el.innerHTML = `<div>${dateText}</div><div>${nameText ? `${nameText} ` : ''}${locText ? `<span class="status-label ${statusCls}">${locText}</span> ` : ""}<span class="status-label ${statusCls}">${status}</span> <span class="status-flag ${flagCls2}">${flagText}</span></div>`;
  } else {
    el.textContent = s;
  }
}

function getTodayRosterStatusForUser(uid) {
  try {
    const u = String(uid || appState.currentUserId || '').trim();
    if (!u) return '';
    const now = nowInTZ('Asia/Taipei');
    const ymd = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const plans = appState.rosterPlans || {};
  const plan = (plans[u] || {})[ymd] || null;
  if (plan && plan.status) return String(plan.status);
  return defaultRosterStatusForDate(now);
} catch { return ''; }
}

function renderHomeRosterLabel() {
  try {
    const fRow = document.querySelector('.row-f');
    if (!fRow) return;
    const status = getTodayRosterStatusForUser(appState.currentUserId);
    if (!status) { fRow.textContent = ''; fRow.classList.add('hidden'); return; }
    fRow.classList.remove('hidden');
    fRow.style.display = 'grid';
    fRow.style.placeItems = 'end center';
    const cls = status === '值班日' ? 'arrive' : (status === '休假日' ? 'off' : 'work');
    fRow.innerHTML = `<div class="status-text" style="text-align:center;"><span class="status-label ${cls}">${status}</span></div>`;
  } catch {}
}

// 每 30 秒定位更新（僅首頁且頁籤可見時）
  function startGeoRefresh() {
    stopGeoRefresh();
    geoRefreshTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          lastCoords = pos.coords;
          updateHomeMap();
        }, (err) => {
          // 忽略錯誤，保持上一筆座標
        }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 15000 });
      }
    }, 30000);
  }
function stopGeoRefresh() {
  if (geoRefreshTimer) { clearInterval(geoRefreshTimer); geoRefreshTimer = null; }
}

function loadRosterPlansFromStorage() {
  try {
    const v = localStorage.getItem('rosterPlans');
    const obj = v ? JSON.parse(v) : {};
    if (obj && typeof obj === 'object') appState.rosterPlans = obj;
  } catch {}
}
function saveRosterPlansToStorage() {
  try {
    const obj = appState.rosterPlans || {};
    localStorage.setItem('rosterPlans', JSON.stringify(obj));
  } catch {}
}
var activeMainTab = "home";
window.addEventListener('load', () => {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && activeMainTab === 'home') startGeoRefresh(); else stopGeoRefresh();
  });
});

const homeSection = document.getElementById("homeSection");
const checkinSection = document.getElementById("checkinSection");
const settingsSection = document.getElementById("settingsSection");
const leaderSection = document.getElementById("leaderSection");
const manageSection = document.getElementById("manageSection");
const featureSection = document.getElementById("featureSection");
const personnelSection = document.getElementById("personnelSection");
const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));

// 初始化外部分頁按鈕標籤（從 localStorage 載入）
try {
  const lab = getExternalTabLabel ? getExternalTabLabel() : '社區';
  const el = document.querySelector('.tab-btn[data-tab="external"] .tab-label');
  if (el) el.textContent = lab || '社區';
} catch {}

const locationInfo = document.getElementById("locationInfo");
const checkinBtn = document.getElementById("checkinBtn");
const checkinResult = document.getElementById("checkinResult");
const checkinSubTitle = document.getElementById("checkinSubTitle");
const settingsSubTitle = document.getElementById("settingsSubTitle");
try { settingsSubTitle?.remove(); } catch {}
try { const h = settingsSection?.querySelector('h3'); h?.remove(); } catch {}
const leaderSubTitle = document.getElementById("leaderSubTitle");
const manageSubTitle = document.getElementById("manageSubTitle");
const featureSubTitle = document.getElementById("featureSubTitle");
const settingsContent = document.getElementById("settingsContent");
const modalRoot = document.getElementById("modalRoot");

// ===== 2.1) 互動增強：按鈕按下（滑鼠/觸控）效果 =====
function attachPressInteractions(el) {
  if (!el) return;
  const add = () => {
    // 避免 disabled 元素進入 pressed 狀態
    if (el.disabled) return;
    el.classList.add("pressed");
  };
  const remove = () => {
    el.classList.remove("pressed");
  };
  el.addEventListener("mousedown", add);
  el.addEventListener("mouseup", remove);
  el.addEventListener("mouseleave", remove);
  el.addEventListener("touchstart", add, { passive: true });
  el.addEventListener("touchend", remove);
  el.addEventListener("touchcancel", remove);
}

// 對現有按鈕立即掛載互動效果
[...document.querySelectorAll(".btn, .tab-btn")].forEach(attachPressInteractions);
attachPressInteractions(document.getElementById("checkinBtn"));
attachPressInteractions(document.getElementById("emailSignIn"));
attachPressInteractions(document.getElementById("applyAccountBtn"));
attachPressInteractions(togglePasswordBtn);
attachPressInteractions(btnLeaveRequest);
try { if (btnLeaveRequest) btnLeaveRequest.className = 'btn btn-grey'; } catch {}
attachPressInteractions(btnMakeup);

// 顯示/隱藏密碼
if (togglePasswordBtn) {
  togglePasswordBtn.addEventListener("click", () => {
    if (!passwordInput) return;
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    // 切換圖示（簡化：加/去斜線）
    if (togglePasswordIcon) {
      togglePasswordIcon.innerHTML = show
        ? '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>'
        : '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/><line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" stroke-width="2"/>';
    }
  });
}

// ===== 2.2) 設定分頁資料狀態與彈窗工具 =====
  const appState = {
    companies: [
      { id: id(), name: "台北公司", coords: "25.041,121.532", radiusMeters: 100 },
      { id: id(), name: "桃園公司", coords: "24.993,121.301", radiusMeters: 100 },
    ],
  regions: [
    { id: id(), name: "台北" },
    { id: id(), name: "新北" },
    { id: id(), name: "桃園" },
  ],
  licenses: [],
  communities: [],
  accounts: [],
  pendingAccounts: [],
  pointsRules: [],
  currentUserId: null,
  currentUserRole: null,
  currentUserEmail: null,
  leaderCompanyFilter: null,
  badgesPrev: {},
};

function id() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function openModal({ title, fields, initial = {}, submitText = "儲存", onSubmit, message, afterRender, refreshOnSubmit = true }) {
  if (!modalRoot) return;
  modalRoot.classList.remove("hidden");
  const modal = document.createElement("div");
  modal.className = "modal";
  const prev = modalRoot.lastElementChild;
  if (prev) prev.style.display = "none";

  const header = document.createElement("div");
  header.className = "modal-header";
  const hTitle = document.createElement("div");
  hTitle.className = "modal-title";
  hTitle.textContent = title;
  header.appendChild(hTitle);
  const btnClose = document.createElement("button");
  btnClose.className = "btn modal-close";
  btnClose.setAttribute("aria-label", "關閉");
  btnClose.textContent = "×";
  btnClose.style.borderRadius = "0";
  btnClose.style.width = "36px";
  btnClose.style.height = "36px";
  btnClose.style.display = "flex";
  btnClose.style.alignItems = "center";
  btnClose.style.justifyContent = "center";
  btnClose.style.padding = "0";
  btnClose.style.background = "transparent";
  btnClose.style.border = "none";
  btnClose.style.color = "#000";
  btnClose.style.fontSize = "20px";
  attachPressInteractions(btnClose);
  btnClose.addEventListener("click", () => closeModal());
  header.appendChild(btnClose);

  const body = document.createElement("div");
  body.className = "modal-body";
  // 可選的訊息段落（用於刪除確認等情境）
  if (message) {
    const msg = document.createElement("div");
    msg.className = "modal-message";
    msg.textContent = message;
    msg.style.marginBottom = "12px";
    msg.style.color = "#b00020";
    body.appendChild(msg);
  }

  const inputs = [];
  fields.forEach((f) => {
    const row = document.createElement("div");
    row.className = "form-row";
    const label = document.createElement("label");
    label.className = "label";
    label.textContent = f.label;
    label.setAttribute("lang", "zh-Hant");
    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      input.className = "input";
      input.setAttribute("lang", "zh-Hant");
      input.style.webkitAppearance = "";
      input.style.mozAppearance = "";
      input.style.appearance = "";
      input.style.pointerEvents = "auto";
      (f.options || []).forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        input.appendChild(o);
      });
      input.value = initial[f.key] ?? (f.options?.[0]?.value ?? "");
      if (f.readonly) input.disabled = true;
    } else if (f.type === "multiselect") {
      input = document.createElement("div");
      const baseOptions = (f.options || []).slice();
      const total = baseOptions.length;
      const initialVals = Array.isArray(initial[f.key]) ? initial[f.key] : [];
      let selectAllChk = null;
      if (f.key === "serviceCommunities") {
        const selectAllWrap = document.createElement("label");
        selectAllWrap.style.display = "flex";
        selectAllWrap.style.alignItems = "center";
        selectAllWrap.style.gap = "6px";
        selectAllChk = document.createElement("input");
        selectAllChk.type = "checkbox";
        selectAllChk.dataset.selectAll = "true";
        selectAllChk.checked = total > 0 && initialVals.length === total;
        if (f.readonly) selectAllChk.disabled = true;
        selectAllWrap.appendChild(selectAllChk);
        selectAllWrap.appendChild(document.createTextNode("全部勾選"));
        input.appendChild(selectAllWrap);

        const addAlphaGroup = (prefix, text) => {
          const wrap = document.createElement("label");
          wrap.style.display = "flex";
          wrap.style.alignItems = "center";
          wrap.style.gap = "6px";
          const chk = document.createElement("input");
          chk.type = "checkbox";
          chk.dataset.selectAll = "true";
          chk.dataset.prefix = prefix;
          if (f.readonly) chk.disabled = true;
          wrap.appendChild(chk);
          wrap.appendChild(document.createTextNode(text));
          input.appendChild(wrap);
          chk.addEventListener("change", (e) => {
            const boxes = Array.from(input.querySelectorAll('input[type=checkbox]')).filter((c) => c.dataset.selectAll !== "true");
            boxes.filter((c) => (c.dataset.codePrefix || "") === prefix).forEach((c) => { c.checked = e.target.checked; });
            if (selectAllChk) {
              const allChecked = boxes.length > 0 && boxes.every((c) => c.checked);
              selectAllChk.checked = allChecked;
            }
          });
        };
        addAlphaGroup("A", "A開頭全部");
        addAlphaGroup("B", "B開頭全部");
        addAlphaGroup("C", "C開頭全部");
      }
      const renderOptions = (() => {
        if (f.key === "serviceCommunities") {
          return baseOptions.slice().sort((a, b) => {
            const ca = String(a.code || "");
            const cb = String(b.code || "");
            const pa = ca.match(/^([A-Za-z])(\d{1,3})$/);
            const pb = cb.match(/^([A-Za-z])(\d{1,3})$/);
            if (pa && pb) {
              const la = pa[1].toUpperCase();
              const lb = pb[1].toUpperCase();
              if (la !== lb) return la.localeCompare(lb, "en");
              const na = parseInt(pa[2], 10) || 0;
              const nb = parseInt(pb[2], 10) || 0;
              return na - nb;
            }
            if (pa && !pb) return -1;
            if (!pa && pb) return 1;
            return String(a.label || "").localeCompare(String(b.label || ""), "zh-Hant");
          });
        }
        return baseOptions;
      })();
      renderOptions.forEach((opt) => {
        const wrap = document.createElement("label");
        wrap.style.display = "flex";
        wrap.style.alignItems = "center";
        wrap.style.gap = "6px";
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.value = opt.value;
        chk.checked = initialVals.includes(opt.value);
        if (opt.code) { chk.dataset.codePrefix = String(opt.code).trim().charAt(0).toUpperCase(); }
        if (f.readonly) chk.disabled = true;
        if (selectAllChk) {
          chk.addEventListener("change", () => {
            const boxes = Array.from(input.querySelectorAll('input[type=checkbox]')).filter((c) => c.dataset.selectAll !== "true");
            const allChecked = boxes.length > 0 && boxes.every((c) => c.checked);
            selectAllChk.checked = allChecked;
          });
        }
        wrap.appendChild(chk);
        const lbl = opt.code ? `${opt.code} - ${opt.label}` : opt.label;
        wrap.appendChild(document.createTextNode(lbl));
        input.appendChild(wrap);
      });
      if (selectAllChk) {
        selectAllChk.addEventListener("change", (e) => {
          const boxes = Array.from(input.querySelectorAll('input[type=checkbox]')).filter((c) => c.dataset.selectAll !== "true");
          boxes.forEach((c) => { c.checked = e.target.checked; });
        });
      }
      input.dataset.multikey = f.key;
    } else {
      input = document.createElement("input");
      input.className = "input";
      input.type = f.type || "text";
      input.placeholder = f.placeholder || "";
      input.setAttribute("lang", "zh-Hant");
      if (f.step != null) input.step = String(f.step);
      if (f.min != null) input.min = String(f.min);
      if (f.max != null) input.max = String(f.max);
      if (f.placeholder) input.setAttribute("title", f.placeholder);
      if (initial && initial[f.key] != null && f.type !== "file") input.value = initial[f.key];
      if (f.readonly) input.disabled = true;
    }
    input.dataset.key = f.key;
    row.appendChild(label);
    row.appendChild(input);
    // 檔案欄位預覽：初始值與即時選取預覽
    if (f.type === "file") {
      input.setAttribute("title", "選擇檔案");
      if (f.accept) input.setAttribute("accept", f.accept);
      if (f.capture) input.setAttribute("capture", f.capture);
      let preview = null;
      if (initial && initial[f.key]) {
        preview = document.createElement("img");
        preview.src = initial[f.key];
        preview.alt = f.label;
        preview.style.width = "60px";
        preview.style.height = "60px";
        preview.style.borderRadius = "50%";
        preview.style.objectFit = "cover";
        preview.style.marginTop = "6px";
        row.appendChild(preview);
      }
      if (f.readonly) input.disabled = true;
      // 即時預覽：使用者選擇檔案後，顯示預覽圖片
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (file) {
          const url = await fileToDataUrl(file);
          if (!preview) {
            preview = document.createElement("img");
            preview.alt = f.label;
            preview.style.width = "60px";
            preview.style.height = "60px";
            preview.style.borderRadius = "50%";
            preview.style.objectFit = "cover";
            preview.style.marginTop = "6px";
            row.appendChild(preview);
          }
          preview.src = url;
        } else {
          // 沒選檔案時，回退到初始預覽或清除
          if (preview) {
            if (initial && initial[f.key]) preview.src = initial[f.key]; else preview.remove();
          }
        }
      });
    }
    body.appendChild(row);
    inputs.push(input);
  });

  let footer = null;
  if (submitText) {
    footer = document.createElement("div");
    footer.className = "modal-footer";
    footer.style.display = "grid";
    footer.style.gridTemplateColumns = "1fr";
    footer.style.gap = "8px";
    const btnSubmit = document.createElement("button");
    btnSubmit.className = "btn btn-darkgrey";
    btnSubmit.textContent = submitText;
    btnSubmit.style.display = "";
    btnSubmit.style.alignItems = "";
    btnSubmit.style.justifyContent = "";
    btnSubmit.style.padding = "";
    btnSubmit.style.width = "";
    attachPressInteractions(btnSubmit);
    btnSubmit.addEventListener("click", async () => {
      const data = {};
      for (const el of inputs) {
        const key = el.dataset.key;
        if (el.tagName === "DIV" && el.dataset.multikey) {
          const vals = Array.from(el.querySelectorAll("input[type=checkbox]:checked:not([data-select-all='true'])")).map((c) => c.value);
          data[key] = vals;
        } else if (el.type === "file") {
          const file = el.files?.[0];
          if (file) {
            data[key] = await fileToDataUrl(file);
            data[`${key}Name`] = file.name;
          } else {
            data[key] = initial[key] ?? null;
          }
        } else if (el.type === "number") {
          data[key] = el.value ? Number(el.value) : null;
        } else {
          data[key] = el.value;
        }
      }
      const ok = await onSubmit?.(data);
      if (ok !== false) {
        closeModal();
        if (refreshOnSubmit && activeMainTab === "settings" && activeSubTab) {
          renderSettingsContent(activeSubTab);
        }
      }
    });
    footer.appendChild(btnSubmit);
  }

  modal.appendChild(header);
  modal.appendChild(body);
  if (footer) modal.appendChild(footer);
  modalRoot.appendChild(modal);

  // 允許外部在渲染完成後插入額外 UI 或事件（例如地圖編輯按鈕）
  if (typeof afterRender === "function") {
    try { afterRender({ modal, header, body, footer, inputs }); } catch (e) { console.error("afterRender error", e); }
  }
}

function closeModal() {
  if (!modalRoot) return;
  const last = modalRoot.lastElementChild;
  if (last) modalRoot.removeChild(last);
  const prev = modalRoot.lastElementChild;
  if (prev) {
    prev.style.display = "";
  } else {
    modalRoot.classList.add("hidden");
    modalRoot.innerHTML = "";
  }
}

async function withRetry(fn, times = 3, delay = 500) {
  let lastErr = null;
  for (let i = 0; i < times; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      const s = String(e && e.message ? e.message : e);
      if (i < times - 1 && (s.includes('ERR_ABORTED') || s.includes('AbortError') || s.includes('NetworkError') || s.includes('Timeout'))) {
        await new Promise((r) => setTimeout(r, delay * Math.pow(2, i)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

function getDeviceId() {
  try {
    const key = "deviceId";
    let idv = localStorage.getItem(key);
    if (!idv) {
      idv = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(key, idv);
    }
    return idv;
  } catch {
    return null;
  }
}
function enqueuePendingCheckin(payload) {
  try {
    const key = "pendingCheckins";
    const v = localStorage.getItem(key);
    const arr = v ? JSON.parse(v) : [];
    arr.push(payload);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}
async function flushPendingCheckins() {
  try {
    await ensureFirebase();
    if (!db || !fns.addDoc || !fns.collection) return;
    const key = "pendingCheckins";
    const v = localStorage.getItem(key);
    const arr = v ? JSON.parse(v) : [];
    if (!Array.isArray(arr) || !arr.length) return;
    const failures = [];
    for (const p of arr) {
      try {
        await withRetry(() => fns.addDoc(fns.collection(db, "checkins"), p));
      } catch {
        failures.push(p);
      }
    }
    if (failures.length) {
      localStorage.setItem(key, JSON.stringify(failures));
    } else {
      localStorage.removeItem(key);
    }
  } catch {}
}

function enqueuePendingLeave(payload) {
  try {
    const key = "pendingLeaves";
    const v = localStorage.getItem(key);
    const arr = v ? JSON.parse(v) : [];
    arr.push(payload);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}
async function flushPendingLeaves() {
  try {
    await ensureFirebase();
    if (!db || !fns.addDoc || !fns.collection) return;
    const key = "pendingLeaves";
    const v = localStorage.getItem(key);
    const arr = v ? JSON.parse(v) : [];
    if (!Array.isArray(arr) || !arr.length) return;
    const failures = [];
    for (const p of arr) {
      try {
        await withRetry(() => fns.addDoc(fns.collection(db, "leaveRequests"), p));
      } catch {
        failures.push(p);
      }
    }
    if (failures.length) {
      localStorage.setItem(key, JSON.stringify(failures));
    } else {
      localStorage.removeItem(key);
    }
  } catch {}
}

function enqueuePendingAccount(payload) {
  try {
    const key = "pendingAccountsQueue";
    const v = localStorage.getItem(key);
    const arr = v ? JSON.parse(v) : [];
    arr.push(payload);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}

async function flushPendingAccounts() {
  try {
    await ensureFirebase();
    if (!db || !fns.addDoc || !fns.collection) return;
    const key = "pendingAccountsQueue";
    const v = localStorage.getItem(key);
    const arr = v ? JSON.parse(v) : [];
    if (!Array.isArray(arr) || !arr.length) return;
    const failures = [];
    for (const p of arr) {
      try {
        await withRetry(() => fns.addDoc(fns.collection(db, "pendingAccounts"), p));
      } catch {
        failures.push(p);
      }
    }
    if (failures.length) {
      localStorage.setItem(key, JSON.stringify(failures));
    } else {
      localStorage.removeItem(key);
    }
  } catch {}
}
function getDeviceNameById(id) {
  try {
    if (!id) return "未知裝置";
    const my = getDeviceId();
    if (my && id === my) return "本機";
    return "未知裝置";
  } catch {
    return "未知裝置";
  }
}

function getLocalDeviceModel() {
  try {
    const ua = navigator.userAgent || "";
    const plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    let model = "";
    if (/Android/i.test(ua)) {
      const m = ua.match(/Android\s+[\d.]+;\s*([^)]+)\)/i);
      model = m ? m[1].trim() : "Android 裝置";
    } else if (/iPhone|iPad|iPod/i.test(ua)) {
      if (/iPhone/i.test(ua)) model = "iPhone"; else if (/iPad/i.test(ua)) model = "iPad"; else model = "iOS 裝置";
    } else if (/Windows/i.test(ua)) {
      model = "Windows PC";
    } else if (/Macintosh/i.test(ua)) {
      model = "Mac";
    } else {
      model = plat || "未知裝置";
    }
    return model;
  } catch { return "未知裝置"; }
}

function getDeviceModelById(id) {
  try {
    const my = getDeviceId();
    if (id && my && id === my) return getLocalDeviceModel();
    return "未知裝置";
  } catch { return "未知裝置"; }
}

function setDeviceModelCache(id, model) {
  try {
    if (!id || !model) return;
    localStorage.setItem(`deviceModel:${id}`, String(model));
  } catch {}
}
function getDeviceModelCache(id) {
  try {
    if (!id) return "";
    return localStorage.getItem(`deviceModel:${id}`) || "";
  } catch { return ""; }
}

async function initDeviceProfile() {
  try {
    const id = getDeviceId();
    if (!id) return;
    setDeviceModelCache(id, getLocalDeviceModel());
  } catch {}
}

function setLastCheckin(uid, payload) {
  try {
    if (!uid) return;
    const key = `lastCheckin:${uid}`;
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {}
}

function getLastCheckin(uid) {
  try {
    if (!uid) return null;
    const key = `lastCheckin:${uid}`;
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

function setCurrentOutTrip(uid, payload) {
  try {
    if (!uid) return;
    const key = `currentOutTrip:${uid}`;
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {}
}

function getCurrentOutTrip(uid) {
  try {
    if (!uid) return null;
    const key = `currentOutTrip:${uid}`;
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

async function getIdToken() {
  try {
    const u = auth?.currentUser;
    if (!u) return null;
    const t = await u.getIdToken?.();
    return t || null;
  } catch { return null; }
}

async function fetchLastCheckinViaRest(uid) {
  try {
    const projectId = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.projectId) || null;
    if (!projectId || !uid) return null;
    const token = await getIdToken();
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: "checkins" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "uid" },
            op: "EQUAL",
            value: { stringValue: uid },
          },
        },
        orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
        limit: 1,
      },
    };
    const res = await withRetry(() => Promise.race([
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 7000)),
    ]));
    if (!res || !res.ok) return null;
    const arr = await res.json().catch(() => []);
    if (!Array.isArray(arr) || !arr.length) return null;
    const doc = arr.find((x) => x && x.document && x.document.fields)?.document;
    if (!doc || !doc.fields) return null;
    const f = doc.fields;
    const ts = f.createdAt?.timestampValue || f.createdAt?.stringValue || null;
    const dt = ts ? new Date(ts) : new Date();
    const status = f.status?.stringValue || "";
    const locationName = f.locationName?.stringValue || "";
    const inRadius = f.inRadius?.booleanValue === true;
    const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}:${String(dt.getSeconds()).padStart(2,'0')}`;
    const summary = `${dateStr} ${locationName} ${status} ${inRadius ? '正常' : '異常'}`.trim();
    return { summary, status };
  } catch {
    return null;
  }
}

async function createPendingAccountViaRest(payload) {
  const projectId = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.projectId) || null;
  if (!projectId) throw new Error("缺少 projectId");
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/pendingAccounts`;
  const toFields = (p) => {
    const f = {};
    if (p.photoUrl != null) f.photoUrl = { stringValue: String(p.photoUrl) };
    if (p.name != null) f.name = { stringValue: String(p.name) };
    if (p.title != null) f.title = { stringValue: String(p.title) };
    if (p.email != null) f.email = { stringValue: String(p.email) };
    if (p.phone != null) f.phone = { stringValue: String(p.phone) };
    if (Array.isArray(p.licenses)) f.licenses = { arrayValue: { values: p.licenses.map((x) => ({ stringValue: String(x) })) } };
    if (p.role != null) f.role = { stringValue: String(p.role) };
    if (p.companyId != null) f.companyId = { stringValue: String(p.companyId) };
    if (Array.isArray(p.serviceCommunities)) f.serviceCommunities = { arrayValue: { values: p.serviceCommunities.map((x) => ({ stringValue: String(x) })) } };
    if (p.status != null) f.status = { stringValue: String(p.status) };
    const ts = new Date().toISOString();
    f.createdAt = { timestampValue: ts };
    return f;
  };
  const body = { fields: toFields(payload) };
  const token = await getIdToken();
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || "建立待審核帳號失敗";
    throw new Error(msg);
  }
  const name = String(data.name || "");
  const id = name.split("/").pop() || "";
  return { id };
}

// 首頁：打卡項目選擇彈窗（僅「上班」「外出」可點，其餘灰色不可動作）
function openCheckinTypeSelector() {
  return new Promise((resolve) => {
    openModal({
      title: "選擇打卡項目",
      fields: [],
      submitText: "取消",
      refreshOnSubmit: false,
      onSubmit: () => false,
      afterRender: ({ body, header, footer }) => {
        const footerEl = modalRoot?.querySelector('.modal-footer');
        if (footerEl) footerEl.remove();
        const wrap = document.createElement("div");
        wrap.style.display = "grid";
        wrap.style.gridTemplateColumns = "1fr 1fr";
        wrap.style.gap = "8px";
        wrap.style.marginTop = "8px";
        const mapKeyToLabel = (k) => {
          switch (k) {
            case 'work': return '上班';
            case 'off': return '下班';
            case 'out': return '外出';
            case 'arrive': return '抵達';
            case 'leave': return '離開';
            case 'return': return '返回';
            default: return '上班';
          }
        };
        const userId = appState.currentUserId || auth?.currentUser?.uid || null;
        const last = userId ? getLastCheckin(userId) : null;
        const today = nowInTZ('Asia/Taipei');
        const todayYmd = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        const lastYmd = (() => {
          try {
            const s = String(last?.summary || '').trim();
            const tok = s.split(' ')[0] || '';
            if (/^\d{4}-\d{2}-\d{2}$/.test(tok)) return tok;
            return '';
          } catch { return ''; }
        })();
        const cur = (lastYmd && lastYmd === todayYmd) ? (last?.key || null) : null;
        const base = [
          { key: "work", label: "上班" },
          { key: "off", label: "下班" },
          { key: "out", label: "外出" },
          { key: "arrive", label: "抵達" },
          { key: "leave", label: "離開" },
          { key: "return", label: "返回" },
        ];
        const decide = (key) => {
          const EN = { green: 'btn btn-green', red: 'btn btn-red', blue: 'btn btn-blue', teal: 'btn btn-teal' };
          const DIS = 'btn btn-grey';
          const enabled = (cls) => ({ enabled: true, cls });
          const disabled = () => ({ enabled: false, cls: DIS });
          const by = (k) => {
            switch (cur) {
              case 'work':
                return {
                  work: disabled(),
                  off: enabled(EN.red),
                  out: enabled(EN.blue),
                  arrive: disabled(),
                  leave: disabled(),
                  return: disabled(),
                }[k];
              case 'off':
                return {
                  work: enabled(EN.green),
                  off: disabled(),
                  out: enabled(EN.blue),
                  arrive: disabled(),
                  leave: disabled(),
                  return: disabled(),
                }[k];
              case 'out':
                return {
                  work: disabled(),
                  off: disabled(),
                  out: disabled(),
                  arrive: enabled(EN.blue),
                  leave: disabled(),
                  return: disabled(),
                }[k];
              case 'arrive':
                return {
                  work: disabled(),
                  off: disabled(),
                  out: disabled(),
                  arrive: disabled(),
                  leave: enabled(EN.blue),
                  return: disabled(),
                }[k];
              case 'leave':
                return {
                  work: disabled(),
                  off: enabled(EN.red),
                  out: enabled(EN.blue),
                  arrive: disabled(),
                  leave: disabled(),
                  return: enabled(EN.teal),
                }[k];
              case 'return':
                return {
                  work: disabled(),
                  off: enabled(EN.red),
                  out: enabled(EN.blue),
                  arrive: disabled(),
                  leave: disabled(),
                  return: disabled(),
                }[k];
              default:
                return {
                  work: enabled(EN.green),
                  off: disabled(),
                  out: enabled(EN.blue),
                  arrive: disabled(),
                  leave: disabled(),
                  return: disabled(),
                }[k];
            }
          };
          return by(key);
        };
        const items = base.map((it) => {
          const st = decide(it.key);
          return { key: it.key, label: it.label, cls: st.cls, enabled: st.enabled };
        });
        items.forEach((it) => {
          const b = document.createElement("button");
          b.className = it.cls;
          b.textContent = it.label;
          b.style.height = "";
          b.style.fontSize = "";
          b.style.borderRadius = "";
          b.style.display = "";
          b.style.alignItems = "";
          b.style.justifyContent = "";
          b.style.padding = "";
          attachPressInteractions(b);
          if (!it.enabled) {
            b.disabled = true;
            b.title = "無動作";
          } else {
            b.addEventListener("click", () => { resolve(it.key); closeModal(); });
          }
          wrap.appendChild(b);
        });
        body.appendChild(wrap);
        const x = header?.querySelector?.('.modal-close');
        x?.addEventListener('click', () => { resolve(null); });
      },
    });
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function optionList(items, labelKey = "name") {
  const arr = Array.isArray(items) ? items.slice() : [];
  arr.sort((a, b) => {
    const ao = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
    const bo = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    const an = String(a[labelKey] || "");
    const bn = String(b[labelKey] || "");
    return an.localeCompare(bn, "zh-Hant");
  });
  return arr.map((it) => ({ value: it.id, label: it[labelKey], code: it.code }));
}

function compareCommunityByCode(a, b) {
  const ca = String(a.code || "");
  const cb = String(b.code || "");
  const pa = ca.match(/^([A-Za-z])([0-9]{1,3})$/);
  const pb = cb.match(/^([A-Za-z])([0-9]{1,3})$/);
  if (pa && pb) {
    const la = pa[1].toUpperCase();
    const lb = pb[1].toUpperCase();
    if (la !== lb) return la.localeCompare(lb, "en");
    const na = parseInt(pa[2], 10) || 0;
    const nb = parseInt(pb[2], 10) || 0;
    return na - nb;
  }
  if (pa && !pb) return -1;
  if (!pa && pb) return 1;
  return ca.localeCompare(cb, "en");
}
function getRoles() {
  if (typeof window !== "undefined" && window.Roles && Array.isArray(window.Roles)) return window.Roles;
  return ["系統管理員", "管理層", "高階主管", "初階主管", "行政", "總幹事", "秘書", "清潔", "機電", "保全"];
}

// Google Maps：載入與地理編碼工具
async function ensureGoogleMaps() {
  if (window.google && window.google.maps) return window.google.maps;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return window.google.maps;
}

function regionIdFromAddressComponents(components = []) {
  const names = components.map((c) => c.long_name);
  const lookup = [];
  components.forEach((c) => {
    const t = (c.types || [])[0];
    if (["locality", "administrative_area_level_3", "administrative_area_level_2", "administrative_area_level_1"].includes(t)) {
      lookup.push(c.long_name);
    }
  });
  const candidates = [...lookup, ...names].filter(Boolean);
  for (const r of appState.regions) {
    if (candidates.some((n) => (n || "").includes(r.name))) return r.id;
  }
  return null;
}

async function geocodeAddress(address) {
  const maps = await ensureGoogleMaps();
  const geocoder = new maps.Geocoder();
  return new Promise((resolve, reject) => {
    geocoder.geocode({ address }, (results, status) => {
      if (status === "OK" && results?.[0]) resolve(results[0]); else reject(new Error(`Geocode failed: ${status}`));
    });
  });
}

async function reverseGeocode(lat, lng) {
  const maps = await ensureGoogleMaps();
  const geocoder = new maps.Geocoder();
  return new Promise((resolve, reject) => {
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === "OK" && results?.[0]) resolve(results[0]); else reject(new Error(`Reverse geocode failed: ${status}`));
    });
  });
}

function openMapPicker({ initialAddress = "", initialCoords = "", initialRadius = 100 }) {
  return new Promise(async (resolve) => {
    await ensureGoogleMaps();
    const start = (() => {
      if (initialCoords) {
        const [latStr, lngStr] = String(initialCoords).split(",").map((s) => s.trim());
        const lat = parseFloat(latStr); const lng = parseFloat(lngStr);
        if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
      }
      return { lat: 25.041, lng: 121.532 };
    })();
    const fields = [
      { key: "address", label: "地址", type: "text", placeholder: "輸入地址以定位" },
      { key: "coords", label: "定位座標", type: "text", placeholder: "lat,lng" },
      { key: "radiusMeters", label: "有效打卡範圍半徑(公尺)", type: "number", placeholder: "100" },
    ];
    const initial = { address: initialAddress, coords: `${start.lat},${start.lng}`, radiusMeters: initialRadius };
  openModal({
    title: "地圖編輯",
    fields,
    initial,
    submitText: "套用",
    onSubmit: async (data) => resolve(data),
    refreshOnSubmit: false,
    afterRender: async ({ body }) => {
      const maps = await ensureGoogleMaps();
      const mapBox = document.createElement("div");
      mapBox.style.width = "100%";
      mapBox.style.height = "320px";
        mapBox.style.marginTop = "8px";
        body.appendChild(mapBox);
        const map = new maps.Map(mapBox, { center: start, zoom: 16 });
        const marker = new maps.Marker({ position: start, map, draggable: true });
        let circle = new maps.Circle({ strokeColor: "#4285F4", strokeOpacity: 0.8, strokeWeight: 2, fillColor: "#4285F4", fillOpacity: 0.15, map, center: start, radius: initial.radiusMeters || 100 });
        const addrInput = body.querySelector('[data-key="address"]');
        const coordsInput = body.querySelector('[data-key="coords"]');
        const radiusInput = body.querySelector('[data-key="radiusMeters"]');
        const updateFromLatLng = async (lat, lng) => {
          coordsInput.value = `${lat.toFixed(6)},${lng.toFixed(6)}`;
          marker.setPosition({ lat, lng });
          circle.setCenter({ lat, lng });
          try { const res = await reverseGeocode(lat, lng); addrInput.value = res.formatted_address || addrInput.value; } catch {}
        };
        marker.addListener("dragend", (ev) => { const p = ev.latLng; updateFromLatLng(p.lat(), p.lng()); });
        radiusInput.addEventListener("input", () => { const r = Number(radiusInput.value) || 100; circle.setRadius(r); });
        addrInput.addEventListener("change", async () => {
          const v = addrInput.value?.trim(); if (!v) return;
          try {
            const res = await geocodeAddress(v);
            const loc = res.geometry.location; const pos = { lat: loc.lat(), lng: loc.lng() };
            map.setCenter(pos); marker.setPosition(pos); circle.setCenter(pos);
            coordsInput.value = `${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}`;
          } catch {}
        });
      },
    });
  });
}

// 打卡用地圖檢視（不可編輯地址/座標/半徑，顯示目前位置與公司/社區位置與範圍）
function openCheckinMapViewer({ targetName = "", targetCoords = "", targetRadius = 100 }) {
  return new Promise(async (resolve) => {
    await ensureGoogleMaps();
    let currentLat = null, currentLng = null;
    const parseCoords = (str) => {
      const [la, ln] = String(str || "").split(",").map((s) => s.trim());
      const lat = parseFloat(la); const lng = parseFloat(ln);
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
      return null;
    };
    const target = parseCoords(targetCoords);

    openModal({
      title: "打卡定位",
      fields: [],
      submitText: "確認",
      // 確認後不觸發設定頁重新渲染，避免流程被中斷
      refreshOnSubmit: false,
      onSubmit: async () => {
        const isNum = (v) => typeof v === 'number' && !isNaN(v);
        const toRad = (deg) => deg * Math.PI / 180;
        let inRadius = false;
        if (target && isNum(currentLat) && isNum(currentLng) && isNum(target.lat) && isNum(target.lng)) {
          const R = 6371000;
          const dLat = toRad(target.lat - currentLat);
          const dLng = toRad(target.lng - currentLng);
          const a = Math.sin(dLat/2)**2 + Math.cos(toRad(currentLat)) * Math.cos(toRad(target.lat)) * Math.sin(dLng/2)**2;
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          const distance = R * c;
          inRadius = distance <= (Number(targetRadius) || 100);
        }
        resolve({ lat: currentLat, lng: currentLng, inRadius });
        return true;
      },
      afterRender: async ({ body, footer }) => {
        const maps = await ensureGoogleMaps();
        const btnRelocate = document.createElement("button");
        btnRelocate.className = "btn btn-green";
        btnRelocate.textContent = "重新定位";
        btnRelocate.style.borderRadius = "0";
        btnRelocate.style.display = "flex";
        btnRelocate.style.alignItems = "center";
        btnRelocate.style.justifyContent = "center";
        btnRelocate.style.padding = "0";
        btnRelocate.style.width = "100%";
        try {
          const submitBtn = footer?.querySelector('.btn');
          if (submitBtn) {
            const h = submitBtn.offsetHeight;
            if (h && h > 0) btnRelocate.style.height = `${h}px`;
            const cs = window.getComputedStyle(submitBtn);
            if (cs?.fontSize) btnRelocate.style.fontSize = cs.fontSize;
            if (cs?.lineHeight) btnRelocate.style.lineHeight = cs.lineHeight;
          }
        } catch {}
        attachPressInteractions(btnRelocate);
        body.appendChild(btnRelocate);
        const mapBox = document.createElement("div");
        mapBox.style.width = "100%";
        mapBox.style.height = "360px";
        mapBox.style.marginTop = "8px";
        body.appendChild(mapBox);

        const info = document.createElement("div");
        info.className = "muted";
        info.style.marginTop = "8px";
        info.textContent = "定位中…";
        body.appendChild(info);

        let map = null;
        let currentMarker = null;
        const defaultIconSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 24 24'>\n  <circle cx='12' cy='12' r='10' fill='white' />\n  <circle cx='12' cy='12' r='8' fill='#1E90FF' />\n</svg>`;
        const defaultIcon = { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(defaultIconSvg)}`, scaledSize: new maps.Size(48, 48), anchor: new maps.Point(24, 24) };
        const makeAvatarIcon = async () => {
          try {
            const src = (homeHeroPhoto && homeHeroPhoto.src) || (userPhotoEl && userPhotoEl.src) || null;
            if (!src) return null;
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = src;
            await new Promise((r) => { img.onload = r; img.onerror = r; });
            const size = 48;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.save();
            ctx.beginPath(); ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
            const iw = img.naturalWidth || size; const ih = img.naturalHeight || size; const ratio = iw / ih; const desired = 1;
            let sx = 0, sy = 0, sw = iw, sh = ih;
            if (ratio > desired) { sw = ih * desired; sx = (iw - sw) / 2; } else if (ratio < desired) { sh = iw / desired; sy = (ih - sh) / 2; }
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
            ctx.restore();
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(size/2, size/2, size/2 - 1.5, 0, Math.PI * 2); ctx.stroke();
            const url = canvas.toDataURL('image/png');
            return { url, scaledSize: new maps.Size(size, size), anchor: new maps.Point(size/2, size/2) };
          } catch {
            return null;
          }
        };
        const iconPromise = makeAvatarIcon();

        const initMap = (center) => {
          map = new maps.Map(mapBox, { center, zoom: 18 });
          if (target) {
            new maps.Circle({ strokeColor: "#4285F4", strokeOpacity: 0.8, strokeWeight: 2, fillColor: "#4285F4", fillOpacity: 0.15, map, center: target, radius: Number(targetRadius) || 100 });
          }
        };

        const updateCurrent = async (lat, lng) => {
          currentLat = lat; currentLng = lng;
          info.textContent = `目前位置：${lat.toFixed(6)}, ${lng.toFixed(6)}`;
          if (!map) initMap({ lat, lng }); else { map.setCenter({ lat, lng }); map.setZoom(18); }
          if (!currentMarker) {
            const icon = (await iconPromise) || defaultIcon;
            currentMarker = new maps.Marker({ position: { lat, lng }, map, draggable: false, title: "目前位置", icon, zIndex: 1000 });
          } else {
            currentMarker.setPosition({ lat, lng });
          }
        };

        // 先嘗試取得目前位置，成功後以目前位置為地圖初始中心；失敗才以設定位置為中心
        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            (pos) => { updateCurrent(pos.coords.latitude, pos.coords.longitude); },
            (err) => { if (target) { updateCurrent(target.lat, target.lng); } else { initMap(target); info.textContent = `定位失敗：${err?.message || '已顯示打卡範圍'}`; } },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
          );
        } else {
          if (target) { initMap(target); updateCurrent(target.lat, target.lng); } else { initMap(target); info.textContent = "此裝置不支援定位"; }
        }

        btnRelocate.addEventListener("click", () => {
          if ("geolocation" in navigator) {
            info.textContent = "定位中…";
            navigator.geolocation.getCurrentPosition(
              (pos) => { updateCurrent(pos.coords.latitude, pos.coords.longitude); },
              (err) => { info.textContent = `定位失敗：${err?.message || err}`; },
              { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
            );
          }
        });
      },
    });
    const cancelBtn = modalRoot?.querySelector('.modal-footer .btn:not(.btn-primary)');
    cancelBtn?.addEventListener('click', () => resolve(null));
    const xBtn = modalRoot?.querySelector('.modal-header .modal-close');
    xBtn?.addEventListener('click', () => resolve(null));
  });
}

function companyStats(companyId) {
  const communityCount = appState.communities.filter((c) => c.companyId === companyId).length;
  const accountsInCompany = appState.accounts.filter((a) => {
    const ids = Array.isArray(a.companyIds) ? a.companyIds : (a.companyId ? [a.companyId] : []);
    return ids.includes(companyId);
  });
  const leaderRoles = new Set(["高階主管", "初階主管", "行政"]);
  const staffRoles = new Set(["總幹事", "秘書", "清潔", "機電", "保全"]);
  const leaderCount = accountsInCompany.filter((a) => leaderRoles.has(a.role)).length;
  const staffCount = accountsInCompany.filter((a) => staffRoles.has(a.role)).length;
  return { communityCount, leaderCount, staffCount };
}

// 簡易刪除確認彈窗
function confirmAction({ title = "確認刪除", text = "確定要刪除？此動作無法復原。", confirmText = "刪除" } = {}) {
  return new Promise((resolve) => {
    openModal({ title, fields: [], submitText: confirmText, message: text, onSubmit: () => { resolve(true); } });
    const cancelBtn = modalRoot?.querySelector('.modal-footer .btn:not(.btn-primary)');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { resolve(false); });
  });
}

// 載入 XLSX（SheetJS）
async function ensureXLSX() {
  if (window.XLSX) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("載入 XLSX 失敗"));
    document.head.appendChild(s);
  });
}

async function parseXLSXFile(file) {
  await ensureXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  return rows;
}

async function exportCommunitiesToXLSX() {
  await ensureXLSX();
  const data = appState.communities.map((c) => {
    const companyName = appState.companies.find((co) => co.id === c.companyId)?.name || "";
    const regionName = appState.regions.find((r) => r.id === c.regionId)?.name || "";
    return {
      公司: companyName,
      社區編號: c.code || "",
      社區名稱: c.name || "",
      地址: c.address || "",
      區域: regionName,
      定位座標: c.coords || "",
      "有效打卡範圍半徑(公尺)": c.radiusMeters ?? "",
    };
  });
  const ws = XLSX.utils.json_to_sheet(data, { skipHeader: false });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "communities");
  XLSX.writeFile(wb, "communities.xlsx");
}

async function importCommunitiesFromXLSX(file) {
  const rows = await parseXLSXFile(file);
  let success = 0, failed = 0;
  for (const r of rows) {
    try {
      const companyName = r["公司"] || "";
      const regionName = r["區域"] || "";
      const companyId = appState.companies.find((co) => (co.name || "") === companyName)?.id || null;
      const regionId = appState.regions.find((rg) => (rg.name || "") === regionName)?.id || null;
      const payload = {
        code: r["社區編號"] || "",
        name: r["社區名稱"] || "",
        address: r["地址"] || "",
        companyId,
        regionId,
        coords: r["定位座標"] || "",
        radiusMeters: r["有效打卡範圍半徑(公尺)"] !== "" ? Number(r["有效打卡範圍半徑(公尺)"]) : null,
        createdAt: fns?.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString(),
      };
      let idNew = null;
      if (db && fns?.addDoc && fns?.collection) {
        const docRef = await withRetry(() => fns.addDoc(fns.collection(db, "communities"), payload));
        idNew = docRef.id;
      } else {
        idNew = id();
      }
      appState.communities.push({ id: idNew, ...payload });
      success++;
    } catch (err) {
      console.warn("匯入社區失敗", err);
      failed++;
    }
  }
  alert(`社區匯入完成：成功 ${success} 筆，失敗 ${failed} 筆`);
  renderSettingsContent("社區");
}

async function exportAccountsToXLSX() {
  await ensureXLSX();
  const data = appState.accounts.map((a) => {
    const companyName = appState.companies.find((c) => c.id === a.companyId)?.name || "";
    const service = Array.isArray(a.serviceCommunities) ? a.serviceCommunities.map((id) => appState.communities.find((x) => x.id === id)?.name || id).join("、") : "";
    const lic = Array.isArray(a.licenses) ? a.licenses.map((x) => appState.licenses.find((l) => l.id === x)?.name || x).join("、") : "";
    return {
      中文姓名: a.name || "",
      職稱: a.title || "",
      電子郵件: a.email || "",
      手機號碼: a.phone || "",
      角色: a.role || "",
      公司: companyName,
      服務社區: service,
      狀況: a.status || "",
      相關證照: lic,
      緊急聯絡人: a.emergencyName || "",
      緊急聯絡人關係: a.emergencyRelation || "",
      緊急聯絡人手機號碼: a.emergencyPhone || "",
      血型: a.bloodType || "",
      出生年月日: a.birthdate || "",
    };
  });
  const ws = XLSX.utils.json_to_sheet(data, { skipHeader: false });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "accounts");
  XLSX.writeFile(wb, "accounts.xlsx");
}

async function importAccountsFromXLSX(file) {
  const rows = await parseXLSXFile(file);
  let success = 0, failed = 0;
  const splitNames = (s) => (s || "").split(/[、,]/).map((x) => x.trim()).filter(Boolean);
  for (const r of rows) {
    try {
      const companyName = r["公司"] || "";
      const companyId = appState.companies.find((co) => (co.name || "") === companyName)?.id || null;
      const serviceNames = splitNames(r["服務社區"] || "");
      const serviceIds = serviceNames.map((nm) => appState.communities.find((x) => (x.name || "") === nm)?.id).filter(Boolean);
      const licNames = splitNames(r["相關證照"] || "");
      const licIds = licNames.map((nm) => appState.licenses.find((l) => (l.name || "") === nm)?.id).filter(Boolean);
      const email = r["電子郵件"] || "";
      const payload = {
        photoUrl: "",
        name: r["中文姓名"] || "",
        title: r["職稱"] || "",
        email,
        phone: r["手機號碼"] || "",
        emergencyName: r["緊急聯絡人"] || "",
        emergencyRelation: r["緊急聯絡人關係"] || "",
        emergencyPhone: r["緊急聯絡人手機號碼"] || "",
        bloodType: r["血型"] || "",
        birthdate: r["出生年月日"] || "",
        licenses: licIds,
        role: r["角色"] || "一般",
        companyId,
        companyIds: companyId ? [companyId] : [],
        serviceCommunities: serviceIds,
        status: r["狀況"] || "在職",
        updatedAt: fns?.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString(),
      };
      // 以 Email 去重：存在則更新，否則新增
      let targetId = appState.accounts.find((a) => a.email && email && a.email.toLowerCase() === email.toLowerCase())?.id || null;
      if (db && fns?.setDoc && fns?.doc && targetId) {
        await withRetry(() => fns.setDoc(fns.doc(db, "users", targetId), payload, { merge: true }));
        const idx = appState.accounts.findIndex((a) => a.id === targetId);
        if (idx >= 0) appState.accounts[idx] = { ...appState.accounts[idx], ...payload };
      } else {
        if (db && fns?.addDoc && fns?.collection) {
          const docRef = await withRetry(() => fns.addDoc(fns.collection(db, "users"), payload));
          targetId = docRef.id;
        } else {
          targetId = id();
        }
        appState.accounts.push({ id: targetId, ...payload });
      }
      success++;
    } catch (err) {
      console.warn("匯入帳號失敗", err);
      failed++;
    }
  }
  alert(`帳號匯入完成：成功 ${success} 筆，失敗 ${failed} 筆`);
  renderSettingsContent("帳號");
}

// 登入頁面「帳號申請」
  if (applyAccountBtn) {
    applyAccountBtn.addEventListener("click", () => {
      openModal({
        title: "帳號申請",
        submitText: "送出申請",
        fields: [
          { key: "photoUrl", label: "大頭照", type: "file" },
          { key: "name", label: "中文姓名", type: "text" },
          { key: "title", label: "職稱", type: "text" },
          { key: "email", label: "電子郵件", type: "email" },
          { key: "phone", label: "手機號碼", type: "text" },
          { key: "password", label: "預設密碼", type: "text" },
          { key: "passwordConfirm", label: "確認密碼", type: "text" },
          { key: "emergencyName", label: "緊急聯絡人", type: "text" },
          { key: "emergencyRelation", label: "緊急聯絡人關係", type: "text" },
          { key: "emergencyPhone", label: "緊急聯絡人手機號碼", type: "text" },
          { key: "bloodType", label: "血型", type: "select", options: ["A","B","O","AB"].map((x)=>({value:x,label:x})) },
          { key: "birthdate", label: "出生年月日", type: "date" },
          { key: "licenses", label: "相關證照", type: "multiselect", options: optionList(appState.licenses) },
          { key: "companyIds", label: "公司", type: "multiselect", options: optionList(appState.companies) },
          ],
        onSubmit: async (d) => {
          try {
            await ensureFirebase();
            if (!auth?.currentUser && fns.signInAnonymously) {
              try { await fns.signInAnonymously(auth); } catch {}
            }
            let photoUrlStr = "";
            try {
              const f = d.photoUrl;
              if (f && typeof File !== 'undefined' && f instanceof File) {
                photoUrlStr = await new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result || ''));
                  reader.onerror = () => resolve('');
                  reader.readAsDataURL(f);
                });
              } else if (typeof f === 'string') {
                photoUrlStr = f;
              } else {
                photoUrlStr = '';
              }
            } catch { photoUrlStr = ''; }
            // 密碼僅用於顯示，不寫入 Firestore
            const pendingPayload = {
              photoUrl: photoUrlStr || "",
              name: d.name || "",
              title: d.title || "",
              email: (d.email || "").trim(),
              phone: (d.phone || "").trim(),
              licenses: Array.isArray(d.licenses) ? d.licenses : [],
              role: "一般",
              companyId: (Array.isArray(d.companyIds) && d.companyIds.length) ? d.companyIds[0] : null,
              serviceCommunities: [],
              status: "待審核",
            };
            if (db && fns.addDoc && fns.collection && fns.serverTimestamp) {
              const normEmail = pendingPayload.email.toLowerCase();
              const normPhone = pendingPayload.phone;
              // 先檢查重複（users 與 pendingAccounts 皆檢查）
              if (normEmail) {
                try {
                  const qU = fns.query(fns.collection(db, "users"), fns.where("email", "==", normEmail), fns.limit(1));
                  const qP = fns.query(fns.collection(db, "pendingAccounts"), fns.where("email", "==", normEmail), fns.limit(1));
                  const [sU, sP] = await Promise.all([withRetry(() => fns.getDocs(qU)), withRetry(() => fns.getDocs(qP))]);
                  if (!sU.empty || !sP.empty) { alert("電子郵件已申請過"); return false; }
                } catch {}
              }
              if (normPhone) {
                try {
                  const qU2 = fns.query(fns.collection(db, "users"), fns.where("phone", "==", normPhone), fns.limit(1));
                  const qP2 = fns.query(fns.collection(db, "pendingAccounts"), fns.where("phone", "==", normPhone), fns.limit(1));
                  const [sU2, sP2] = await Promise.all([withRetry(() => fns.getDocs(qU2)), withRetry(() => fns.getDocs(qP2))]);
                  if (!sU2.empty || !sP2.empty) { alert("手機號碼已申請過"); return false; }
                } catch {}
              }
              const fsPayload = {
                photoUrl: pendingPayload.photoUrl,
                name: pendingPayload.name,
                title: pendingPayload.title,
                email: normEmail,
                phone: pendingPayload.phone,
                licenses: pendingPayload.licenses,
                role: pendingPayload.role,
                companyId: pendingPayload.companyId,
                serviceCommunities: pendingPayload.serviceCommunities,
                pagePermissions: [],
                status: pendingPayload.status,
                createdAt: fns.serverTimestamp(),
              };
              let newId = null;
              try {
                const ref = await withRetry(() => fns.addDoc(fns.collection(db, "pendingAccounts"), fsPayload));
                newId = ref.id;
              } catch (e) {
                try {
                  const r = await createPendingAccountViaRest(fsPayload);
                  newId = r.id;
                } catch (e2) {
                  throw e2;
                }
              }
              appState.pendingAccounts.push({ id: newId, ...pendingPayload, password: d.password || "", passwordConfirm: d.passwordConfirm || "" });
              renderSettingsContent("帳號");
              alert("已送出申請");
              return true;
            } else {
              throw new Error("Firestore 未初始化，無法提交到雲端");
            }
        } catch (err) {
          alert(`提交帳號申請失敗：${err?.message || err}`);
          return false;
        }
        },
    });
  });
}

// 顯示個人資訊彈窗（含登出）
function showProfileModal(user, role) {
  const initial = {
    photoUrl: user.photoURL || "",
    name: user.displayName || "",
    email: user.email || "",
    role: role || "一般",
    title: "",
    phone: "",
  };
  openModal({
    title: `個人資訊(${role})`,
    submitText: "關閉",
    initial,
    fields: [
      { key: "title", label: "職稱", type: "text", readonly: true },
      { key: "photoUrl", label: "大頭照", type: "file", readonly: true },
      { key: "name", label: "姓名", type: "text", readonly: true },
      { key: "email", label: "電子郵件", type: "email", readonly: true },
      { key: "phone", label: "手機號碼", type: "text", readonly: true },
      { key: "monthlyPoints", label: "本月計點", type: "text", readonly: true },
      { key: "notifications", label: "通知", type: "text", readonly: true },
    ],
    onSubmit: async () => true,
    afterRender: async ({ header, body, footer, inputs }) => {
      try {
        // 表單行改為預設對齊，移除水平置中；隱藏所有標籤
        body.style.textAlign = "";
        Array.from(body.querySelectorAll(".form-row")).forEach((row) => {
          row.style.display = "";
          row.style.flexDirection = "";
          row.style.alignItems = "";
          const lab = row.querySelector('.label'); if (lab) lab.style.display = 'none';
        });

        // 移除預設主按鈕（關閉）
        const btnSubmit = footer.querySelector(".btn") || footer.querySelector(".btn-primary");
        if (btnSubmit) btnSubmit.remove();

        // 以 Firestore 使用者文件覆蓋照片與基本資訊
        if (db && fns.doc && fns.getDoc && user?.uid) {
          const ref = fns.doc(db, "users", user.uid);
          const snap = await fns.getDoc(ref);
          if (snap.exists()) {
            const d = snap.data() || {};
            // 照片預覽與點擊重新上傳
            {
              const photo = d.photoUrl || initial.photoUrl;
              const input = body.querySelector('[data-key="photoUrl"]');
              const row = input?.parentElement;
              if (row) {
                let preview = row.querySelector("img");
                if (!preview) {
                  preview = document.createElement("img");
                  preview.style.width = "120px";
                  preview.style.height = "120px";
                  preview.style.borderRadius = "50%";
                  preview.style.objectFit = "cover";
                  preview.style.margin = "12px auto 0";
                  preview.style.cursor = "default";
                  row.appendChild(preview);
                }
                if (photo) preview.src = photo;
                // 大頭照旁顯示編輯小圖示
                const editBtn = document.createElement('button');
                editBtn.className = 'btn btn-darkgrey';
                editBtn.type = 'button';
                editBtn.style.marginTop = '8px';
                editBtn.style.display = 'inline-flex';
                editBtn.style.alignItems = 'center';
                editBtn.style.gap = '6px';
                editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 20h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M14 4l6 6-9 9H5v-6l9-9Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>編輯照片`;
                attachPressInteractions(editBtn);
                row.appendChild(editBtn);
                if (input) {
                  input.style.display = "none";
                  input.disabled = false;
                  const triggerSelect = () => { try { input.click(); } catch {} };
                  preview.style.cursor = 'pointer';
                  preview.addEventListener("click", triggerSelect);
                  editBtn.addEventListener('click', triggerSelect);
                  input.addEventListener('change', () => {
                    try {
                      const f = input.files?.[0];
                      if (!f) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const dataUrl = String(reader.result || '');
                        if (!dataUrl) return;
                        preview.src = dataUrl;
                        // 變更後詢問是否儲存
                        openModal({
                          title: '確認儲存新照片',
                          fields: [],
                          submitText: '儲存',
                          refreshOnSubmit: false,
                          onSubmit: async () => {
                            try {
                              await ensureFirebase();
                              if (!db || !fns.setDoc || !fns.doc) throw new Error('Firestore 未初始化');
                              if (!user?.uid) throw new Error('使用者未登入');
                              const payload = { photoUrl: dataUrl };
                              if (typeof fns.serverTimestamp === 'function') payload.updatedAt = fns.serverTimestamp();
                              await withRetry(() => fns.setDoc(fns.doc(db, 'users', user.uid), payload, { merge: true }));
                              if (userPhotoEl) userPhotoEl.src = dataUrl;
                              if (homeHeroPhoto) homeHeroPhoto.src = dataUrl;
                              try { const src = homeHeroPhoto?.src || ''; if (homeHeroCrop) { homeHeroCrop.style.backgroundImage = src ? `url(${src})` : ''; } } catch {}
                              alert('已儲存新照片');
                              return true;
                            } catch (e) {
                              alert('儲存失敗：' + (e?.message || e));
                              return false;
                            }
                          }
                        });
                      };
                      reader.readAsDataURL(f);
                    } catch {}
                  });
                }
              }
            }
            // 姓名、Email、角色 顯示
            const nameInput = body.querySelector('[data-key="name"]');
            const emailInput = body.querySelector('[data-key="email"]');
            const titleInput = body.querySelector('[data-key="title"]');
            const phoneInput = body.querySelector('[data-key="phone"]');
            const monthlyInput = body.querySelector('[data-key="monthlyPoints"]');
            const notifInput = body.querySelector('[data-key="notifications"]');
            if (nameInput) nameInput.value = d.name || user.displayName || nameInput.value || "";
            if (emailInput) emailInput.value = d.email || user.email || emailInput.value || "";
            if (phoneInput) phoneInput.value = d.phone || phoneInput.value || "";
            if (titleInput) titleInput.value = d.title || titleInput.value || "";

            // 計算本月計點（含未打卡扣點 -1）
            if (monthlyInput) {
              try {
                await ensureFirebase();
                let rules2 = appState.pointsRules || [];
                if (!rules2 || !rules2.length) {
                  try {
                    const rref = fns.collection(db, 'pointsRules');
                    const rsnap = await withRetry(() => fns.getDocs(rref));
                    const list2 = [];
                    rsnap.forEach((doc) => { const d2 = doc.data() || {}; list2.push({ id: doc.id, ...d2 }); });
                    rules2 = list2;
                    appState.pointsRules = list2;
                  } catch {}
                }
                const ref2 = fns.collection(db, 'checkins');
                const q2 = fns.query(ref2, fns.where('uid', '==', user.uid));
                const snap2 = await withRetry(() => fns.getDocs(q2));
                const tzNow2 = nowInTZ('Asia/Taipei');
                const y2 = tzNow2.getFullYear();
                const m2 = tzNow2.getMonth();
                const start2 = new Date(y2, m2, 1);
                const end2 = new Date(y2, m2 + 1, 1);
                const calc2 = (rec) => {
                  const flag = (rec.inRadius === true) ? '正常' : '異常';
                  const st = String(rec.status || '').trim();
                  const base = st.split('-')[0];
                  const reason = base || st;
                  const found = rules2.find((r) => String(r.reason||'') === reason && String(r.status||'') === flag) || null;
                  return found ? Number(found.points || 0) : 0;
                };
                let total2 = 0;
                const daySet = new Set();
                snap2.forEach((doc) => {
                  const d2 = doc.data() || {};
                  let created2 = d2.createdAt;
                  let dt2 = null;
                  if (created2 && typeof created2.toDate === 'function') dt2 = created2.toDate(); else if (typeof created2 === 'string') dt2 = new Date(created2);
                  if (!dt2) dt2 = new Date();
                  if (dt2 >= start2 && dt2 < end2) {
                    total2 += calc2(d2);
                    const dKey = `${dt2.getFullYear()}-${String(dt2.getMonth()+1).padStart(2,'0')}-${String(dt2.getDate()).padStart(2,'0')}`;
                    daySet.add(dKey);
                  }
                });
                const daysTillToday = tzNow2.getDate();
                const monthKey = `${y2}-${String(m2+1).padStart(2,'0')}-`;
                let missingCount = 0;
                for (let dd = 1; dd <= daysTillToday; dd++) {
                  const k = monthKey + String(dd).padStart(2,'0');
                  if (!daySet.has(k)) missingCount++;
                }
                total2 += (-1) * missingCount;
                monthlyInput.value = String(total2);
              } catch {}
            }

            // 通知顯示（若有 users 欄位）
            try {
              if (notifInput) {
                const v = d.notifications ?? d.notificationsEnabled;
                if (typeof v === "boolean") notifInput.value = v ? "已開啟" : "未開啟";
                else if (typeof v === "string") notifInput.value = v;
                else notifInput.value = "未設定";
              }
            } catch {}
          }
        }

        // 保持所有欄位不可編輯（唯獨照片可更換），並套用輸入外觀
        inputs.forEach((el) => {
          const k = el.dataset.key;
          if (k === 'photoUrl') { el.disabled = false; return; }
          el.disabled = true;
          el.style.textAlign = 'center';
          el.style.border = 'none';
          try { el.style.backgroundImage = 'none'; el.style.paddingLeft = '0'; } catch {}
        });
        // 顯示抬頭並水平置中整個視窗
        body.style.textAlign = 'center';
        Array.from(body.querySelectorAll('.form-row')).forEach((row) => {
          const lab = row.querySelector('.label'); if (lab) lab.style.display = '';
          row.style.display = 'flex';
          row.style.flexDirection = 'column';
          row.style.alignItems = 'center';
        });
        // 刪除電子郵件與手機號碼顯示
        const emailInput = body.querySelector('[data-key="email"]');
        if (emailInput?.parentElement) emailInput.parentElement.remove();
        const phoneInput = body.querySelector('[data-key="phone"]');
        if (phoneInput?.parentElement) phoneInput.parentElement.remove();
        // 職稱僅顯示文字，不提供下拉選項
        // 「儲存」按鈕字體與「登出」一致
        // （已移除主按鈕）
      } catch {}

      // 在視窗最下方（footer）加入登出按鈕
      try {
        const btnLogout = document.createElement("button");
        btnLogout.className = "btn btn-grey";
        btnLogout.textContent = "登出";
        attachPressInteractions(btnLogout);
        btnLogout.addEventListener("click", async () => {
          try {
            if (typeof fns.signOut === "function" && auth) {
              await fns.signOut(auth);
              closeModal();
            } else {
              throw new Error("Auth 未初始化或 signOut 不可用");
            }
          } catch (e) {
            alert("登出失敗：" + (e?.message || e));
          }
        });
        footer.appendChild(btnLogout);
      } catch {}
    },
  });
}

function renderSettingsContent(label) {
  if (!settingsContent) return;
  if (label === "一般") {
    renderSettingsGeneral();
  } else if (label === "社區") {
    renderSettingsCommunities();
  } else if (label === "外部") {
    renderSettingsExternal();
  } else if (label === "帳號") {
    renderSettingsAccounts();
  } else if (label === "角色") {
    renderSettingsRoles();
  } else if (label === "規則") {
    renderSettingsRules();
  } else if (label === "推播") {
    renderSettingsNotifications();
  } else {
    settingsContent.innerHTML = "";
  }
}

function getExternalTabLabel() {
  try {
    const raw = localStorage.getItem('externalTabLabel') || '';
    const v = String(raw || '').trim();
    return v || '社區';
  } catch { return '社區'; }
}
function setExternalTabLabel(label) {
  try { localStorage.setItem('externalTabLabel', String(label||'')); } catch {}
  try {
    const btn = document.querySelector('.tab-btn[data-tab="external"] .tab-label');
    if (btn) btn.textContent = String(label||'') || '社區';
  } catch {}
}

function renderSettingsExternal() {
  const companies = Array.isArray(appState.companies) ? appState.companies : [];
  const label = getExternalTabLabel();
  settingsContent.innerHTML = `
    <div class="block" id="block-external">
      <div class="block-header"><span class="block-title">外部連結設定</span></div>
      <div class="form-row"><label class="label">分頁按鈕名稱</label><input id="externalTabLabelInput" class="input" type="text" value="${label}" /></div>
      <div class="table-wrapper">
        <table class="table" aria-label="外部連結">
          <thead><tr><th>公司</th><th>外部連結網址</th><th>操作</th></tr></thead>
          <tbody>
            ${companies.map((c)=>`<tr data-id="${c.id}"><td>${c.name||c.id}</td><td><input class="input" type="url" value="${String(c.externalUrl||'')}" placeholder="https://..." /></td><td class="cell-actions"><button class="btn" data-act="save">儲存</button></td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="block-actions"><button id="btnSaveExternalLabel" class="btn">儲存名稱</button></div>
    </div>`;
  const btnSaveLabel = document.getElementById('btnSaveExternalLabel');
  attachPressInteractions(btnSaveLabel);
  btnSaveLabel?.addEventListener('click', () => {
    const inp = document.getElementById('externalTabLabelInput');
    const v = inp && 'value' in inp ? String(inp.value||'') : '';
    setExternalTabLabel(v || '社區');
    alert('已儲存分頁按鈕名稱');
  });
  const table = settingsContent.querySelector('#block-external table');
  table?.addEventListener('click', async (e) => {
    const t = e.target; if (!(t instanceof HTMLElement)) return;
    const act = t.dataset.act || ''; if (!act) return;
    const tr = t.closest('tr'); const cid = tr?.getAttribute('data-id') || '';
    const input = tr?.querySelector('input'); const url = input ? String(input.value||'').trim() : '';
    try {
      await ensureFirebase();
      if (cid && db && fns.setDoc && fns.doc) {
        await withRetry(() => fns.setDoc(fns.doc(db, 'companies', cid), { externalUrl: url, updatedAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString() }, { merge: true }));
      }
      const idx = companies.findIndex((c) => String(c.id||'') === String(cid));
      if (idx >= 0) companies[idx] = { ...companies[idx], externalUrl: url };
      alert('已儲存外部連結網址');
    } catch (err) { alert(`儲存失敗：${err?.message || err}`); }
  });
}

function renderSettingsGeneral() {
  const companiesHtml = `
    <div class="block" id="block-companies">
      <div class="block-header">
        <span class="block-title">公司列表</span>
        <div class="block-actions"><button id="btnAddCompany" class="btn">新增</button></div>
      </div>
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>名稱</th><th>社區數</th><th>幹部數</th><th>人員數</th><th>定位座標</th><th>打卡半徑(公尺)</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${appState.companies.map((co) => {
              const s = companyStats(co.id);
              return `<tr data-id="${co.id}">
                <td>${co.name}</td>
                <td>${s.communityCount}</td>
                <td>${s.leaderCount}</td>
                <td>${s.staffCount}</td>
                <td>${co.coords || ""}</td>
                <td>${co.radiusMeters ?? ""}</td>
                <td class="cell-actions">
                  <button class="btn btn-sm" data-act="edit">編輯</button>
                  <button class="btn btn-sm" data-act="del">刪除</button>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

  const regionsHtml = `
    <div class="block" id="block-regions">
      <div class="block-header">
        <span class="block-title">區域</span>
        <div class="block-actions"><button id="btnAddRegion" class="btn">新增</button></div>
      </div>
      <div class="table-wrapper">
        <table class="table">
          <thead><tr><th>名稱</th><th>操作</th></tr></thead>
          <tbody>
            ${appState.regions.map((r) => `<tr data-id="${r.id}"><td>${r.name}</td><td class="cell-actions"><button class="btn" data-act="edit">編輯</button><button class="btn" data-act="del">刪除</button></td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

  const licensesHtml = `
    <div class="block" id="block-licenses">
      <div class="block-header">
        <span class="block-title">證照</span>
        <div class="block-actions"><button id="btnAddLicense" class="btn">新增</button></div>
      </div>
      <div class="table-wrapper">
        <table class="table">
          <thead><tr><th>名稱</th><th>操作</th></tr></thead>
          <tbody>
            ${appState.licenses.map((l) => `<tr data-id="${l.id}"><td>${l.name}</td><td class="cell-actions"><button class="btn" data-act="edit">編輯</button><button class="btn" data-act="del">刪除</button></td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

  settingsContent.innerHTML = companiesHtml + regionsHtml + licensesHtml;

  // 事件：公司
  const btnAddCompany = document.getElementById("btnAddCompany");
  attachPressInteractions(btnAddCompany);
  btnAddCompany.addEventListener("click", () => {
    openModal({
      title: "新增公司",
      fields: [
        { key: "name", label: "名稱", type: "text" },
        { key: "coords", label: "定位座標", type: "text", placeholder: "lat,lng" },
        { key: "radiusMeters", label: "有效打卡範圍半徑(公尺)", type: "number", placeholder: "100" },
        { key: "order", label: "順序", type: "number", placeholder: "0" },
      ],
      onSubmit: async (data) => {
        try {
          const payload = { name: data.name || "", coords: data.coords || "", radiusMeters: data.radiusMeters ?? null, order: (data.order != null ? Number(data.order) : null), createdAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString() };
          if (db && fns.addDoc && fns.collection) {
            const docRef = await withRetry(() => fns.addDoc(fns.collection(db, "companies"), payload));
            appState.companies.push({ id: docRef.id, name: payload.name, coords: payload.coords, radiusMeters: payload.radiusMeters, order: payload.order ?? null });
          } else {
            appState.companies.push({ id: id(), name: payload.name, coords: payload.coords, radiusMeters: payload.radiusMeters, order: payload.order ?? null });
          }
          renderSettingsContent("一般");
          return true;
        } catch (err) {
          alert(`儲存公司失敗：${err?.message || err}`);
          return false;
        }
      },
      afterRender: async ({ body }) => {
        const coordsInput = body.querySelector('[data-key="coords"]');
        const radiusInput = body.querySelector('[data-key="radiusMeters"]');
        const coordsRow = coordsInput?.parentElement;
        if (!coordsRow || !coordsInput) return;
        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = "用地圖選擇";
        attachPressInteractions(btn);
        btn.addEventListener("click", async () => {
          const maps = await ensureGoogleMaps();
          let inline = coordsRow.querySelector(".inline-map-picker");
          if (inline) { inline.classList.toggle("hidden"); return; }
          inline = document.createElement("div");
          inline.className = "inline-map-picker";
          inline.style.marginTop = "8px";
          const mapBox = document.createElement("div");
          mapBox.style.width = "100%";
          mapBox.style.height = "280px";
          inline.appendChild(mapBox);
          const controls = document.createElement("div");
          controls.style.display = "flex";
          controls.style.gap = "8px";
          controls.style.marginTop = "8px";
          const addrInput = document.createElement("input");
          addrInput.className = "input";
          addrInput.placeholder = "輸入地址以定位";
          controls.appendChild(addrInput);
          const btnApply = document.createElement("button");
          btnApply.className = "btn btn-primary";
          btnApply.textContent = "套用";
          attachPressInteractions(btnApply);
          controls.appendChild(btnApply);
          inline.appendChild(controls);
          coordsRow.appendChild(inline);

          const parse = (str) => {
            const [la, ln] = String(str || "").split(",").map((s) => s.trim());
            const lat = parseFloat(la); const lng = parseFloat(ln);
            if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
            return { lat: 25.041, lng: 121.532 };
          };
          const start = parse(coordsInput.value);
          const map = new maps.Map(mapBox, { center: start, zoom: 16 });
          const marker = new maps.Marker({ position: start, map, draggable: true });
          const circle = new maps.Circle({ strokeColor: "#4285F4", strokeOpacity: 0.8, strokeWeight: 2, fillColor: "#4285F4", fillOpacity: 0.15, map, center: start, radius: Number(radiusInput?.value) || 100 });
          const updateFromLatLng = async (lat, lng) => {
            coordsInput.value = `${lat.toFixed(6)},${lng.toFixed(6)}`;
            marker.setPosition({ lat, lng });
            circle.setCenter({ lat, lng });
            try { const res = await reverseGeocode(lat, lng); addrInput.value = res.formatted_address || addrInput.value; } catch {}
          };
          marker.addListener("dragend", (ev) => { const p = ev.latLng; updateFromLatLng(p.lat(), p.lng()); });
          radiusInput?.addEventListener("input", () => { const r = Number(radiusInput.value) || 100; circle.setRadius(r); });
          addrInput.addEventListener("change", async () => {
            const v = addrInput.value?.trim(); if (!v) return;
            try { const res = await geocodeAddress(v); const loc = res.geometry.location; const pos = { lat: loc.lat(), lng: loc.lng() }; map.setCenter(pos); marker.setPosition(pos); circle.setCenter(pos); coordsInput.value = `${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}`; } catch {}
          });
          btnApply.addEventListener("click", () => {
            // 套用僅更新欄位，不關閉彈窗，讓使用者再按儲存
          });
        });
        coordsRow.appendChild(btn);
      },
    });
  });
  settingsContent.querySelectorAll("#block-companies tbody tr").forEach((tr) => {
    const cid = tr.dataset.id;
    tr.querySelectorAll("button").forEach((b) => attachPressInteractions(b));
    tr.addEventListener("click", (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;
      const co = appState.companies.find((c) => c.id === cid);
      if (!co) return;
      if (act === "edit") {
        openModal({
          title: "編輯公司",
          fields: [
            { key: "name", label: "名稱", type: "text" },
            { key: "coords", label: "定位座標", type: "text" },
            { key: "radiusMeters", label: "有效打卡範圍半徑(公尺)", type: "number" },
            { key: "order", label: "順序", type: "number" },
          ],
          initial: co,
          onSubmit: async (data) => {
            try {
              const next = { name: data.name ?? co.name, coords: data.coords ?? co.coords, radiusMeters: data.radiusMeters ?? co.radiusMeters ?? null, order: (data.order != null ? Number(data.order) : (co.order ?? null)) };
              if (db && fns.setDoc && fns.doc) {
                await withRetry(() => fns.setDoc(fns.doc(db, "companies", cid), { ...next, updatedAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString() }, { merge: true }));
              }
              co.name = next.name;
              co.coords = next.coords;
              co.radiusMeters = next.radiusMeters;
              co.order = next.order;
              renderSettingsContent("一般");
              return true;
            } catch (err) {
              alert(`更新公司失敗：${err?.message || err}`);
              return false;
            }
          },
          afterRender: async ({ body }) => {
            const coordsInput = body.querySelector('[data-key="coords"]');
            const radiusInput = body.querySelector('[data-key="radiusMeters"]');
            const coordsRow = coordsInput?.parentElement;
            if (!coordsRow || !coordsInput) return;
            const btn = document.createElement("button");
            btn.className = "btn";
            btn.textContent = "用地圖選擇";
            attachPressInteractions(btn);
            btn.addEventListener("click", async () => {
              const maps = await ensureGoogleMaps();
              let inline = coordsRow.querySelector(".inline-map-picker");
              if (inline) { inline.classList.toggle("hidden"); return; }
              inline = document.createElement("div");
              inline.className = "inline-map-picker";
              inline.style.marginTop = "8px";
              const mapBox = document.createElement("div");
              mapBox.style.width = "100%";
              mapBox.style.height = "280px";
              inline.appendChild(mapBox);
              const controls = document.createElement("div");
              controls.style.display = "flex";
              controls.style.gap = "8px";
              controls.style.marginTop = "8px";
              const addrInput = document.createElement("input");
              addrInput.className = "input";
              addrInput.placeholder = "輸入地址以定位";
              controls.appendChild(addrInput);
              const btnApply = document.createElement("button");
              btnApply.className = "btn btn-primary";
              btnApply.textContent = "套用";
              attachPressInteractions(btnApply);
              controls.appendChild(btnApply);
              inline.appendChild(controls);
              coordsRow.appendChild(inline);

              const parse = (str) => {
                const [la, ln] = String(str || "").split(",").map((s) => s.trim());
                const lat = parseFloat(la); const lng = parseFloat(ln);
                if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
                return { lat: 25.041, lng: 121.532 };
              };
              const start = parse(coordsInput.value);
              const map = new maps.Map(mapBox, { center: start, zoom: 16 });
              const marker = new maps.Marker({ position: start, map, draggable: true });
              const circle = new maps.Circle({ strokeColor: "#4285F4", strokeOpacity: 0.8, strokeWeight: 2, fillColor: "#4285F4", fillOpacity: 0.15, map, center: start, radius: Number(radiusInput?.value) || 100 });
              const updateFromLatLng = async (lat, lng) => {
                coordsInput.value = `${lat.toFixed(6)},${lng.toFixed(6)}`;
                marker.setPosition({ lat, lng });
                circle.setCenter({ lat, lng });
                try { const res = await reverseGeocode(lat, lng); addrInput.value = res.formatted_address || addrInput.value; } catch {}
              };
              marker.addListener("dragend", (ev) => { const p = ev.latLng; updateFromLatLng(p.lat(), p.lng()); });
              radiusInput?.addEventListener("input", () => { const r = Number(radiusInput.value) || 100; circle.setRadius(r); });
              addrInput.addEventListener("change", async () => {
                const v = addrInput.value?.trim(); if (!v) return;
                try { const res = await geocodeAddress(v); const loc = res.geometry.location; const pos = { lat: loc.lat(), lng: loc.lng() }; map.setCenter(pos); marker.setPosition(pos); circle.setCenter(pos); coordsInput.value = `${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}`; } catch {}
              });
              btnApply.addEventListener("click", () => {
                // 套用僅更新欄位，不關閉彈窗，讓使用者再按儲存
              });
            });
            coordsRow.appendChild(btn);
          },
        });
      } else if (act === "del") {
        (async () => {
          const ok = await confirmAction({ title: "確認刪除公司", text: `確定要刪除公司「${co.name}」嗎？此動作無法復原。`, confirmText: "刪除" });
          if (!ok) return;
          try {
            if (db && fns.deleteDoc && fns.doc) {
              await withRetry(() => fns.deleteDoc(fns.doc(db, "companies", cid)));
            }
            appState.companies = appState.companies.filter((c) => c.id !== cid);
            renderSettingsContent("一般");
          } catch (err) {
            alert(`刪除公司失敗：${err?.message || err}`);
            // 雲端刪除失敗時仍執行本地刪除
            appState.companies = appState.companies.filter((c) => c.id !== cid);
            renderSettingsContent("一般");
          }
  })();
}
    });
  });

  // 事件：區域
  const btnAddRegion = document.getElementById("btnAddRegion");
  attachPressInteractions(btnAddRegion);
  btnAddRegion.addEventListener("click", () => {
    openModal({
      title: "新增區域",
      fields: [{ key: "name", label: "名稱", type: "text" }],
      onSubmit: async (data) => {
        try {
          const payload = { name: data.name || "", createdAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString() };
          if (db && fns.addDoc && fns.collection) {
            const docRef = await withRetry(() => fns.addDoc(fns.collection(db, "regions"), payload));
            appState.regions.push({ id: docRef.id, name: payload.name });
          } else {
            appState.regions.push({ id: id(), name: payload.name });
          }
          renderSettingsContent("一般");
          return true;
        } catch (err) {
          alert(`儲存區域失敗：${err?.message || err}`);
          return false;
        }
      },
    });
  });
  settingsContent.querySelectorAll("#block-regions tbody tr").forEach((tr) => {
    const rid = tr.dataset.id;
    tr.querySelectorAll("button").forEach((b) => attachPressInteractions(b));
    tr.addEventListener("click", (e) => {
      const act = e.target?.dataset?.act;
      const r = appState.regions.find((x) => x.id === rid);
      if (!r) return;
      if (act === "edit") {
        openModal({ title: "編輯區域", fields: [{ key: "name", label: "名稱", type: "text" }], initial: r, onSubmit: async (d) => {
          try {
            const next = { name: d.name ?? r.name };
            if (db && fns.setDoc && fns.doc) {
              await withRetry(() => fns.setDoc(fns.doc(db, "regions", rid), { ...next, updatedAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString() }, { merge: true }));
            }
            r.name = next.name;
            renderSettingsContent("一般");
            return true;
          } catch (err) {
            alert(`更新區域失敗：${err?.message || err}`);
            return false;
          }
        } });
      } else if (act === "del") {
        (async () => {
          const ok = await confirmAction({ title: "確認刪除區域", text: `確定要刪除區域「${r.name}」嗎？此動作無法復原。`, confirmText: "刪除" });
          if (!ok) return;
          try {
            if (db && fns.deleteDoc && fns.doc) {
              await withRetry(() => fns.deleteDoc(fns.doc(db, "regions", rid)));
            }
            appState.regions = appState.regions.filter((x) => x.id !== rid);
            renderSettingsContent("一般");
          } catch (err) {
            alert(`刪除區域失敗：${err?.message || err}`);
            // 雲端刪除失敗時仍執行本地刪除
            appState.regions = appState.regions.filter((x) => x.id !== rid);
            renderSettingsContent("一般");
          }
        })();
      }
    });
  });

  // 事件：證照
  const btnAddLicense = document.getElementById("btnAddLicense");
  attachPressInteractions(btnAddLicense);
  btnAddLicense.addEventListener("click", () => {
    openModal({
      title: "新增證照",
      fields: [{ key: "name", label: "名稱", type: "text" }],
      onSubmit: async (d) => {
        try {
          if (!db || !fns.addDoc || !fns.collection) throw new Error("Firestore 未初始化");
          const docRef = await withRetry(() => fns.addDoc(fns.collection(db, "licenses"), { name: d.name || "", createdAt: fns.serverTimestamp() }));
          appState.licenses.push({ id: docRef.id, name: d.name || "" });
        } catch (err) {
          alert(`儲存證照失敗：${err?.message || err}`);
          return false;
        }
      },
    });
  });
  settingsContent.querySelectorAll("#block-licenses tbody tr").forEach((tr) => {
    const lid = tr.dataset.id;
    tr.querySelectorAll("button").forEach((b) => attachPressInteractions(b));
    tr.addEventListener("click", (e) => {
      const act = e.target?.dataset?.act;
      const l = appState.licenses.find((x) => x.id === lid);
      if (!l) return;
      if (act === "edit") {
        openModal({ title: "編輯證照", fields: [{ key: "name", label: "名稱", type: "text" }], initial: l, onSubmit: async (d) => {
          try {
            if (!db || !fns.setDoc || !fns.doc) throw new Error("Firestore 未初始化");
            await withRetry(() => fns.setDoc(fns.doc(db, "licenses", lid), { name: d.name || l.name, updatedAt: fns.serverTimestamp() }, { merge: true }));
            l.name = d.name || l.name;
          } catch (err) {
            alert(`更新證照失敗：${err?.message || err}`);
            return false;
          }
        } });
      } else if (act === "del") {
        (async () => {
          const ok = await confirmAction({ title: "確認刪除證照", text: `確定要刪除證照「${l.name}」嗎？此動作無法復原。`, confirmText: "刪除" });
          if (!ok) return;
          try {
            if (!db || !fns.deleteDoc || !fns.doc) throw new Error("Firestore 未初始化");
            await withRetry(() => fns.deleteDoc(fns.doc(db, "licenses", lid)));
            appState.licenses = appState.licenses.filter((x) => x.id !== lid);
            renderSettingsContent("一般");
          } catch (err) {
            alert(`刪除證照失敗：${err?.message || err}`);
          }
        })();
      }
    });
  });
}

function renderSettingsCommunities() {
  const rows = appState.communities.slice().sort(compareCommunityByCode).map((c) => {
    const regionName = appState.regions.find((r) => r.id === c.regionId)?.name || "";
    const companyName = appState.companies.find((co) => co.id === c.companyId)?.name || "";
    return `<tr data-id="${c.id}"><td>${companyName}</td><td>${c.code || ""}</td><td>${c.name || ""}</td><td>${c.address || ""}</td><td>${regionName}</td><td>${c.coords || ""}</td><td>${c.radiusMeters ?? ""}</td><td class="cell-actions"><button class="btn" data-act="edit">編輯</button><button class="btn" data-act="del">刪除</button></td></tr>`;
  }).join("");

  settingsContent.innerHTML = `
    <div class="block" id="block-communities">
      <div class="block-header"><span class="block-title">社區列表</span><div class="block-actions"><button id="btnExportCommunities" class="btn">匯出.xlsx</button><button id="btnImportCommunities" class="btn">匯入.xlsx</button><button id="btnAddCommunity" class="btn">新增</button></div></div>
      <div class="table-wrapper">
        <table class="table">
          <thead><tr><th>公司</th><th>社區編號</th><th>社區名稱</th><th>地址</th><th>區域</th><th>定位座標</th><th>有效打卡範圍半徑(公尺)</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;

  // 匯出/匯入事件
  const btnExportC = document.getElementById("btnExportCommunities");
  const btnImportC = document.getElementById("btnImportCommunities");
  [btnExportC, btnImportC].forEach((b) => b && attachPressInteractions(b));
  btnExportC?.addEventListener("click", () => exportCommunitiesToXLSX());
  btnImportC?.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls";
    input.addEventListener("change", async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        await importCommunitiesFromXLSX(f);
      } catch (err) {
        alert(`匯入社區失敗：${err?.message || err}`);
      }
    });
    input.click();
  });

  const btnAdd = document.getElementById("btnAddCommunity");
  attachPressInteractions(btnAdd);
  btnAdd.addEventListener("click", () => {
    openModal({
      title: "新增社區",
      fields: [
        { key: "code", label: "社區編號", type: "text" },
        { key: "name", label: "社區名稱", type: "text" },
        { key: "address", label: "地址", type: "text" },
        { key: "companyId", label: "所屬公司", type: "select", options: optionList(appState.companies) },
        { key: "regionId", label: "區域", type: "select", options: optionList(appState.regions) },
        { key: "coords", label: "定位座標", type: "text", placeholder: "lat,lng" },
        { key: "radiusMeters", label: "有效打卡範圍半徑(公尺)", type: "number" },
        { key: "order", label: "順序", type: "number" },
      ],
      onSubmit: async (d) => {
        try {
          if (!db || !fns.addDoc || !fns.collection) throw new Error("Firestore 未初始化");
          const payload = { code: d.code || "", name: d.name || "", address: d.address || "", companyId: d.companyId || null, regionId: d.regionId || null, coords: d.coords || "", radiusMeters: d.radiusMeters ?? null, order: (d.order != null ? Number(d.order) : null), createdAt: fns.serverTimestamp() };
          const docRef = await withRetry(() => fns.addDoc(fns.collection(db, "communities"), payload));
          appState.communities.push({ id: docRef.id, ...payload });
        } catch (err) {
          alert(`儲存社區失敗：${err?.message || err}`);
          return false;
        }
      },
      afterRender: ({ body }) => {
        const addrInput = body.querySelector('[data-key="address"]');
        const coordsInput = body.querySelector('[data-key="coords"]');
        const regionSelect = body.querySelector('[data-key="regionId"]');
        const radiusInput = body.querySelector('[data-key="radiusMeters"]');
        // 預設 50 公尺（若尚未填值）
        if (radiusInput && (!radiusInput.value || radiusInput.value.trim() === "")) radiusInput.value = "50";
        // 依地址自動帶入區域與座標
        addrInput?.addEventListener("change", async () => {
          const v = addrInput.value?.trim(); if (!v) return;
          try {
            const res = await geocodeAddress(v);
            const loc = res.geometry.location; const pos = { lat: loc.lat(), lng: loc.lng() };
            coordsInput.value = `${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}`;
            const rid = regionIdFromAddressComponents(res.address_components || []);
            if (rid) regionSelect.value = rid;
          } catch {}
        });
        // 插入地圖編輯按鈕
        const coordsRow = coordsInput?.parentElement;
        if (coordsRow) {
          const btn = document.createElement("button");
          btn.className = "btn";
          btn.textContent = "開啟地圖編輯";
          attachPressInteractions(btn);
          btn.style.marginTop = "6px";
          btn.addEventListener("click", async () => {
            const result = await openMapPicker({ initialAddress: addrInput.value, initialCoords: coordsInput.value, initialRadius: Number(body.querySelector('[data-key="radiusMeters"]').value) || 50 });
            if (result) {
              addrInput.value = result.address || addrInput.value;
              coordsInput.value = result.coords || coordsInput.value;
              const radiusInput2 = body.querySelector('[data-key="radiusMeters"]');
              if (radiusInput2 && result.radiusMeters != null) radiusInput2.value = String(result.radiusMeters);
              // 反向地理編碼取得區域
              try {
                const [lat, lng] = (result.coords || "").split(",").map((s) => parseFloat(s.trim()));
                if (!isNaN(lat) && !isNaN(lng)) {
                  const rev = await reverseGeocode(lat, lng);
                  const rid = regionIdFromAddressComponents(rev.address_components || []);
                  if (rid) regionSelect.value = rid;
                }
              } catch {}
            }
          });
          coordsRow.appendChild(btn);
        }
      },
    });
  });

  settingsContent.querySelectorAll("#block-communities tbody tr").forEach((tr) => {
    const cid = tr.dataset.id;
    tr.querySelectorAll("button").forEach((b) => attachPressInteractions(b));
    tr.addEventListener("click", (e) => {
      const act = e.target?.dataset?.act;
      const item = appState.communities.find((x) => x.id === cid);
      if (!item) return;
      if (act === "edit") {
        openModal({
          title: "編輯社區",
          fields: [
            { key: "code", label: "社區編號", type: "text" },
            { key: "name", label: "社區名稱", type: "text" },
            { key: "address", label: "地址", type: "text" },
            { key: "companyId", label: "所屬公司", type: "select", options: optionList(appState.companies) },
            { key: "regionId", label: "區域", type: "select", options: optionList(appState.regions) },
            { key: "coords", label: "定位座標", type: "text" },
            { key: "radiusMeters", label: "有效打卡範圍半徑(公尺)", type: "number" },
            { key: "order", label: "順序", type: "number" },
          ],
          initial: item,
          onSubmit: async (d) => {
            try {
              if (!db || !fns.setDoc || !fns.doc) throw new Error("Firestore 未初始化");
              const payload = {
                code: d.code ?? item.code ?? "",
                name: d.name ?? item.name ?? "",
                companyId: d.companyId ?? item.companyId ?? null,
                regionId: d.regionId ?? item.regionId ?? null,
                coords: d.coords ?? item.coords ?? "",
                address: d.address ?? item.address ?? "",
                radiusMeters: d.radiusMeters ?? item.radiusMeters ?? null,
                order: (d.order != null ? Number(d.order) : (item.order ?? null)),
                updatedAt: fns.serverTimestamp(),
              };
              await withRetry(() => fns.setDoc(fns.doc(db, "communities", cid), payload, { merge: true }));
              Object.assign(item, d);
            } catch (err) {
              alert(`更新社區失敗：${err?.message || err}`);
              return false;
            }
          },
          afterRender: ({ body }) => {
            const addrInput = body.querySelector('[data-key="address"]');
            const coordsInput = body.querySelector('[data-key="coords"]');
            const regionSelect = body.querySelector('[data-key="regionId"]');
            const radiusInput = body.querySelector('[data-key="radiusMeters"]');
            // 若半徑未填值，預設為 50 公尺
            if (radiusInput && (!radiusInput.value || radiusInput.value.trim() === "")) radiusInput.value = "50";
            addrInput?.addEventListener("change", async () => {
              const v = addrInput.value?.trim(); if (!v) return;
              try {
                const res = await geocodeAddress(v);
                const loc = res.geometry.location; const pos = { lat: loc.lat(), lng: loc.lng() };
                coordsInput.value = `${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}`;
                const rid = regionIdFromAddressComponents(res.address_components || []);
                if (rid) regionSelect.value = rid;
              } catch {}
            });
            const coordsRow = coordsInput?.parentElement;
            if (coordsRow) {
              const btn = document.createElement("button");
              btn.className = "btn";
              btn.textContent = "開啟地圖編輯";
              attachPressInteractions(btn);
              btn.style.marginTop = "6px";
              btn.addEventListener("click", async () => {
                const result = await openMapPicker({ initialAddress: addrInput.value, initialCoords: coordsInput.value, initialRadius: Number(body.querySelector('[data-key="radiusMeters"]').value) || 100 });
                if (result) {
                  addrInput.value = result.address || addrInput.value;
                  coordsInput.value = result.coords || coordsInput.value;
                  const radiusInput = body.querySelector('[data-key="radiusMeters"]');
                  if (radiusInput && result.radiusMeters != null) radiusInput.value = String(result.radiusMeters);
                  try {
                    const [lat, lng] = (result.coords || "").split(",").map((s) => parseFloat(s.trim()));
                    if (!isNaN(lat) && !isNaN(lng)) {
                      const rev = await reverseGeocode(lat, lng);
                      const rid = regionIdFromAddressComponents(rev.address_components || []);
                      if (rid) regionSelect.value = rid;
                    }
                  } catch {}
                }
              });
              coordsRow.appendChild(btn);
            }
          },
        });
      } else if (act === "del") {
        (async () => {
          const ok = await confirmAction({ title: "確認刪除社區", text: `確定要刪除社區「${item.name}」嗎？此動作無法復原。`, confirmText: "刪除" });
          if (!ok) return;
          try {
            if (!db || !fns.deleteDoc || !fns.doc) throw new Error("Firestore 未初始化");
            await withRetry(() => fns.deleteDoc(fns.doc(db, "communities", cid)));
            appState.communities = appState.communities.filter((x) => x.id !== cid);
            renderSettingsContent("社區");
          } catch (err) {
            alert(`刪除社區失敗：${err?.message || err}`);
          }
        })();
      }
    });
  });
}

function renderSettingsAccounts() {
  const rows = appState.accounts.map((a) => {
    const companyName = appState.companies.find((c) => c.id === a.companyId)?.name || "";
    const service = Array.isArray(a.serviceCommunities) ? a.serviceCommunities.map((id) => appState.communities.find((x) => x.id === id)?.name || id).join("、") : "";
    const lic = Array.isArray(a.licenses) ? a.licenses.map((x) => appState.licenses.find((l) => l.id === x)?.name || x).join("、") : "";
    return `<tr data-id="${a.id}">
      <td>${a.photoUrl ? `<img src="${a.photoUrl}" alt="頭像" class="user-photo"/>` : ""}</td>
      <td>${a.name || ""}</td>
      <td>${a.title || ""}</td>
      <td>${a.email || ""}</td>
      <td>${a.phone || ""}</td>
      <td class="cell-password" contenteditable="true" title="雙擊編輯，Enter 或失焦儲存">${a.password || ""}</td>
      <td class="cell-password-confirm" contenteditable="true" title="雙擊編輯，Enter 或失焦儲存">${a.passwordConfirm || ""}</td>
      <td>${a.emergencyName || ""}</td>
      <td>${a.emergencyRelation || ""}</td>
      <td>${a.emergencyPhone || ""}</td>
      <td>${a.bloodType || ""}</td>
      <td>${a.birthdate || ""}</td>
      <td>${lic}</td>
      <td>${a.role || ""}</td>
      <td>${companyName}</td>
      <td>${service}</td>
      <td>${a.status || ""}</td>
      <td class="cell-actions"><button class="btn" data-act="edit">編輯</button><button class="btn" data-act="del">刪除</button></td>
    </tr>`;
  }).join("");

  const pendingRows = appState.pendingAccounts.map((p) => {
    return `<tr data-id="${p.id}">
      <td>${p.photoUrl ? `<img src="${p.photoUrl}" alt="頭像" class="user-photo"/>` : ""}</td>
      <td>${p.name || ""}</td>
      <td>${p.title || ""}</td>
      <td>${p.email || ""}</td>
      <td>${p.phone || ""}</td>
      <td>${p.role || "一般"}</td>
      <td>${p.status || "待審核"}</td>
      <td class="cell-actions"><button class="btn" data-act="approve">核准</button><button class="btn" data-act="del">刪除</button></td>
    </tr>`;
  }).join("");

  settingsContent.innerHTML = `
    <div class="block" id="block-accounts">
      <div class="block-header"><span class="block-title">帳號列表</span><div class="block-actions"><button id="btnExportAccounts" class="btn">匯出.xlsx</button><button id="btnImportAccounts" class="btn">匯入.xlsx</button><button id="btnAddAccount" class="btn">新增</button></div></div>
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>大頭照</th><th>中文姓名</th><th>職稱</th><th>電子郵件</th><th>手機號碼</th><th>預設密碼</th><th>確認密碼</th><th>緊急聯絡人</th><th>緊急聯絡人關係</th><th>緊急聯絡人手機號碼</th><th>血型</th><th>出生年月日</th><th>相關證照</th><th>角色</th><th>公司</th><th>服務社區</th><th>狀況</th><th>操作</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>

    <div class="block" id="block-pending-accounts">
      <div class="block-header"><span class="block-title">待審核帳號</span></div>
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>大頭照</th><th>中文姓名</th><th>職稱</th><th>電子郵件</th><th>手機號碼</th><th>角色</th><th>狀況</th><th>操作</th>
            </tr>
          </thead>
          <tbody>${pendingRows}</tbody>
        </table>
      </div>
    </div>`;

  // 帳號匯出/匯入事件
  const btnExportA = document.getElementById("btnExportAccounts");
  const btnImportA = document.getElementById("btnImportAccounts");
  [btnExportA, btnImportA].forEach((b) => b && attachPressInteractions(b));
  btnExportA?.addEventListener("click", () => exportAccountsToXLSX());
  btnImportA?.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls";
    input.addEventListener("change", async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        if (!hasFullAccessToTab('settings')) {
          alert("權限不足：不可於設定分頁匯入帳號。");
          return;
        }
        await importAccountsFromXLSX(f);
      } catch (err) {
        alert(`匯入帳號失敗：${err?.message || err}`);
      }
    });
    input.click();
  });

  const btnAdd = document.getElementById("btnAddAccount");
  attachPressInteractions(btnAdd);
  btnAdd.addEventListener("click", () => {
    openModal({
      title: "新增帳號",
      fields: [
        { key: "photoUrl", label: "大頭照", type: "file" },
        { key: "name", label: "中文姓名", type: "text" },
        { key: "title", label: "職稱", type: "text" },
        { key: "email", label: "電子郵件", type: "email" },
        { key: "phone", label: "手機號碼", type: "text" },
        { key: "password", label: "預設密碼", type: "text" },
        { key: "passwordConfirm", label: "確認密碼", type: "text" },
        { key: "emergencyName", label: "緊急聯絡人", type: "text" },
        { key: "emergencyRelation", label: "緊急聯絡人關係", type: "text" },
        { key: "emergencyPhone", label: "緊急聯絡人手機號碼", type: "text" },
        { key: "bloodType", label: "血型", type: "select", options: ["A","B","O","AB"].map((x)=>({value:x,label:x})) },
        { key: "birthdate", label: "出生年月日", type: "date" },
        { key: "licenses", label: "相關證照", type: "multiselect", options: optionList(appState.licenses) },
        { key: "role", label: "角色", type: "select", options: getRoles().map((r)=>({value:r,label:r})) },
        { key: "companyIds", label: "公司", type: "multiselect", options: optionList(appState.companies) },
        { key: "serviceCommunities", label: "服務社區", type: "multiselect", options: optionList(appState.communities) },
        { key: "status", label: "狀況", type: "select", options: ["在職","離職"].map((x)=>({value:x,label:x})) },
      ],
      onSubmit: async (d) => {
        try {
          if (!hasFullAccessToTab('settings')) {
            alert("權限不足：不可於設定分頁新增帳號。");
            return false;
          }
          if (!db || !fns.addDoc || !fns.collection) throw new Error("Firestore 未初始化");

          // 驗證密碼一致（若有提供）
          if (d.password && d.passwordConfirm && d.password !== d.passwordConfirm) {
            alert("預設密碼與確認密碼不一致。");
            return false;
          }

          // 嘗試建立 Auth 使用者（優先雲端函式，失敗或未配置則改用 REST）
          let createdUid = null;
          let emailExists = false;
          if (d.email && d.password) {
            if (fns.functions && fns.httpsCallable) {
              try {
                const createUser = fns.httpsCallable(fns.functions, "adminCreateUser");
                const res = await createUser({ email: d.email, password: d.password, name: d.name || "", photoUrl: d.photoUrl || "" });
                createdUid = res?.data?.uid || null;
              } catch (err) {
                console.warn("adminCreateUser 失敗，改用 REST 建立", err);
                try {
                  const r = await createAuthUserViaRest(d.email, d.password);
                  createdUid = r.uid || null;
                } catch (err2) {
                  const msg = String(err2?.message || "");
                  if (/EMAIL_EXISTS/.test(msg)) {
                    emailExists = true;
                    try { if (fns.sendPasswordResetEmail && auth) await fns.sendPasswordResetEmail(auth, d.email); } catch {}
                  } else {
                    console.warn("REST 建立 Auth 失敗", err2);
                    alert("警告：未能建立登入帳號（Auth）。已僅儲存基本資料，請稍後重試或部署雲端函式。");
                  }
                }
              }
            } else {
              try {
                const r = await createAuthUserViaRest(d.email, d.password);
                createdUid = r.uid || null;
              } catch (err2) {
                const msg = String(err2?.message || "");
                if (/EMAIL_EXISTS/.test(msg)) {
                  emailExists = true;
                  try { if (fns.sendPasswordResetEmail && auth) await fns.sendPasswordResetEmail(auth, d.email); } catch {}
                } else {
                  console.warn("REST 建立 Auth 失敗", err2);
                  alert("警告：未能建立登入帳號（Auth）。已僅儲存基本資料，請稍後重試或部署雲端函式。");
                }
              }
            }
          }

          const payload = {
            photoUrl: d.photoUrl || "",
            name: d.name || "",
            title: d.title || "",
            email: d.email || "",
            phone: d.phone || "",
            // 不將密碼寫入 Firestore（避免明文儲存）
            uid: createdUid || null,
            emergencyName: d.emergencyName || "",
            emergencyRelation: d.emergencyRelation || "",
            emergencyPhone: d.emergencyPhone || "",
            bloodType: d.bloodType || "",
            birthdate: d.birthdate || "",
          licenses: Array.isArray(d.licenses) ? d.licenses : [],
          role: d.role || "保全",
          companyIds: Array.isArray(d.companyIds) ? d.companyIds : [],
          companyId: (Array.isArray(d.companyIds) && d.companyIds.length) ? d.companyIds[0] : null,
          serviceCommunities: Array.isArray(d.serviceCommunities) ? d.serviceCommunities : [],
          status: d.status || "在職",
          createdAt: fns.serverTimestamp(),
        };
          // 若有建立 Auth 帳號，使用其 uid 作為文件 ID；否則使用自動 ID
          let newId = null;
          if (createdUid) {
            const ref = fns.doc(db, "users", createdUid);
            await withRetry(() => fns.setDoc(ref, payload));
            newId = createdUid;
          } else {
            const docRef = await withRetry(() => fns.addDoc(fns.collection(db, "users"), payload));
            newId = docRef.id;
          }
          appState.accounts.push({ id: newId, ...d, uid: createdUid || null });
          if (emailExists) {
            alert("儲存成功（此 Email 已存在於登入系統，已寄送重設密碼信，使用者重設後即可登入）");
          } else {
            alert("儲存成功");
          }
        } catch (err) {
          alert(`儲存帳號失敗：${err?.message || err}`);
          return false;
        }
      },
    });
  });

  settingsContent.querySelectorAll("#block-accounts tbody tr").forEach((tr) => {
    const aid = tr.dataset.id;
    tr.querySelectorAll("button").forEach((b) => attachPressInteractions(b));
    tr.addEventListener("click", (e) => {
      const act = e.target?.dataset?.act;
      const a = appState.accounts.find((x) => x.id === aid);
      if (!a) return;
      if (act === "edit") {
        openModal({
          title: "編輯帳號",
          fields: [
            { key: "photoUrl", label: "大頭照", type: "file" },
            { key: "name", label: "中文姓名", type: "text" },
            { key: "title", label: "職稱", type: "text" },
            { key: "email", label: "電子郵件", type: "email" },
            { key: "phone", label: "手機號碼", type: "text" },
            { key: "emergencyName", label: "緊急聯絡人", type: "text" },
            { key: "emergencyRelation", label: "緊急聯絡人關係", type: "text" },
            { key: "emergencyPhone", label: "緊急聯絡人手機號碼", type: "text" },
            { key: "bloodType", label: "血型", type: "select", options: ["A","B","O","AB"].map((x)=>({value:x,label:x})) },
            { key: "birthdate", label: "出生年月日", type: "date" },
            { key: "licenses", label: "相關證照", type: "multiselect", options: optionList(appState.licenses) },
            { key: "role", label: "角色", type: "select", options: getRoles().map((r)=>({value:r,label:r})) },
            { key: "companyIds", label: "公司", type: "multiselect", options: optionList(appState.companies) },
            { key: "serviceCommunities", label: "服務社區", type: "multiselect", options: optionList(appState.communities) },
            { key: "status", label: "狀況", type: "select", options: ["在職","離職"].map((x)=>({value:x,label:x})) },
          ],
          initial: a,
          afterRender: ({ footer }) => {
            const btnReset = document.createElement("button");
            btnReset.className = "btn btn-grey";
            btnReset.textContent = "重設密碼";
            attachPressInteractions(btnReset);
            btnReset.addEventListener("click", async () => {
              try {
                await ensureFirebase();
                const targetEmail = a.email || null;
                if (!targetEmail) { alert("此帳號缺少電子郵件，無法寄送重設密碼信。"); return; }
                if (auth) { try { auth.languageCode = "zh-TW"; } catch {} }
                if (fns.sendPasswordResetEmail && auth) {
                  await fns.sendPasswordResetEmail(auth, targetEmail);
                  alert(`已寄送重設密碼信到「${targetEmail}」。`);
                } else {
                  alert("未初始化寄送重設密碼功能。");
                }
              } catch (e) {
                alert(`寄送重設密碼信失敗：${e?.message || e}`);
              }
            });
            footer.insertBefore(btnReset, footer.firstChild);
          },
          onSubmit: async (d) => {
            try {
              if (!hasFullAccessToTab('settings')) {
                alert("權限不足：不可於設定分頁編輯帳號。");
                return false;
              }
              if (!db || !fns.setDoc || !fns.doc) throw new Error("Firestore 未初始化");

              const payload = {
                photoUrl: d.photoUrl ?? a.photoUrl ?? "",
                name: d.name ?? a.name ?? "",
                title: d.title ?? a.title ?? "",
                email: d.email ?? a.email ?? "",
                phone: d.phone ?? a.phone ?? "",
                // 不將密碼寫入 Firestore（避免明文儲存）
                uid: a.uid || null,
                emergencyName: d.emergencyName ?? a.emergencyName ?? "",
                emergencyRelation: d.emergencyRelation ?? a.emergencyRelation ?? "",
                emergencyPhone: d.emergencyPhone ?? a.emergencyPhone ?? "",
                bloodType: d.bloodType ?? a.bloodType ?? "",
                birthdate: d.birthdate ?? a.birthdate ?? "",
                licenses: Array.isArray(d.licenses) ? d.licenses : (Array.isArray(a.licenses) ? a.licenses : []),
                role: d.role ?? a.role ?? "一般",
                companyIds: Array.isArray(d.companyIds) ? d.companyIds : (Array.isArray(a.companyIds) ? a.companyIds : (a.companyId ? [a.companyId] : [])),
                companyId: (Array.isArray(d.companyIds) && d.companyIds.length) ? d.companyIds[0] : (Array.isArray(a.companyIds) && a.companyIds.length ? a.companyIds[0] : (a.companyId ?? null)),
                serviceCommunities: Array.isArray(d.serviceCommunities) ? d.serviceCommunities : (Array.isArray(a.serviceCommunities) ? a.serviceCommunities : []),
                status: d.status ?? a.status ?? "在職",
                updatedAt: fns.serverTimestamp(),
              };
              await withRetry(() => fns.setDoc(fns.doc(db, "users", aid), payload, { merge: true }));
              Object.assign(a, { ...d, uid: a.uid || payload.uid || aid });
              if (appState.currentUserId && appState.currentUserId === aid) {
                appState.currentUserRole = payload.role || appState.currentUserRole || "一般";
                applyPagePermissionsForUser({ uid: aid });
              }
              alert("儲存成功");
            } catch (err) {
              alert(`更新帳號失敗：${err?.message || err}`);
              return false;
            }
          },
        });
      } else if (act === "del") {
        (async () => {
          if (!hasFullAccessToTab('settings')) {
            alert("權限不足：不可於設定分頁刪除帳號。");
            return;
          }
          const ok = await confirmAction({ title: "確認刪除帳號", text: `確定要刪除帳號「${a.name || a.email || aid}」嗎？此動作無法復原。`, confirmText: "刪除" });
          if (!ok) return;
      try {
        if (!db || !fns.deleteDoc || !fns.doc) throw new Error("Firestore 未初始化");
        await withRetry(() => fns.deleteDoc(fns.doc(db, "users", aid)));
        try {
          const targetUid = a.uid || aid;
          if (targetUid && fns.functions && fns.httpsCallable) {
            const delUser = fns.httpsCallable(fns.functions, "adminDeleteUser");
            await delUser({ uid: targetUid });
          }
          // 若無 uid 或刪除失敗，以 email 嘗試刪除
          if ((!a.uid || !a.uid.length) && a.email && fns.functions && fns.httpsCallable) {
            const delByEmail = fns.httpsCallable(fns.functions, "adminDeleteUserByEmail");
            await delByEmail({ email: a.email });
          }
        } catch (_) {
          // 若未部署雲端函式，則僅刪除 Firestore 文件，保留提示
        }
        appState.accounts = appState.accounts.filter((x) => x.id !== aid);
        renderSettingsContent("帳號");
        if (!(fns.functions && fns.httpsCallable)) {
          alert("已刪除帳號資料；未能刪除登入帳號（Auth）。請於 Firebase Console 手動刪除或部署雲端函式。");
        }
      } catch (err) {
        alert(`刪除帳號失敗：${err?.message || err}`);
      }
        })();
      }
    });

    // 內嵌密碼編輯：在失焦或按 Enter 觸發更新
    const pwdCell = tr.querySelector(".cell-password");
    const confirmCell = tr.querySelector(".cell-password-confirm");
    [pwdCell, confirmCell].forEach((cell) => {
      if (!cell) return;
      cell.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          cell.blur();
        }
      });
      cell.addEventListener("blur", async () => {
        const a = appState.accounts.find((x) => x.id === aid);
        if (!a) return;
        const newPwd = (pwdCell?.textContent || "").trim();
        const newConfirm = (confirmCell?.textContent || "").trim();
        // 若兩者皆空，不做事
        if (!newPwd && !newConfirm) return;
        if (newPwd !== newConfirm) {
          alert("新密碼與確認密碼不一致。");
          return;
        }
        if (!hasFullAccessToTab('settings')) {
          alert("權限不足：不可於設定分頁更新密碼。");
          return;
        }
        if (!(fns.functions && fns.httpsCallable)) {
          const targetEmail = a.email || null;
          if (targetEmail && fns.sendPasswordResetEmail && auth) {
            try {
              await fns.sendPasswordResetEmail(auth, targetEmail);
              alert(`尚未設定雲端函式，已改寄送重設密碼信到「${targetEmail}」。`);
            } catch (e2) {
              alert(`尚未設定雲端函式且寄送重設信也失敗：${e2?.message || e2}`);
            }
          } else {
            alert("尚未設定雲端函式且無法寄送重設密碼信（缺少 Email 或初始化）。");
          }
          return;
        }
        try {
          const updatePwd = fns.httpsCallable(fns.functions, "adminUpdateUserPassword");
          await updatePwd({
            uid: a.uid || null,
            email: a.email || null,
            newPassword: newPwd,
          });
          alert("已更新登入頁面的密碼。");
          // 更新前端表格顯示值
          a.password = newPwd;
          a.passwordConfirm = newConfirm;
        } catch (err) {
          const targetEmail = a.email || null;
          if (targetEmail && fns.sendPasswordResetEmail && auth) {
            try {
              await fns.sendPasswordResetEmail(auth, targetEmail);
              alert(`更新登入密碼失敗，已改寄送重設密碼信到「${targetEmail}」。`);
            } catch (e2) {
              alert(`更新登入密碼失敗且寄送重設信也失敗：${e2?.message || e2}`);
            }
          } else {
            alert(`更新登入密碼失敗：${err?.message || err}`);
          }
        }
      });
    });
  });

  // 待審核帳號事件綁定
  settingsContent.querySelectorAll("#block-pending-accounts tbody tr").forEach((tr) => {
    const pid = tr.dataset.id;
    tr.querySelectorAll("button").forEach((b) => attachPressInteractions(b));
    tr.addEventListener("click", (e) => {
      const act = e.target?.dataset?.act;
      const item = appState.pendingAccounts.find((x) => x.id === pid);
      if (!act || !item) return;
      if (act === "approve") {
        (async () => {
          try {
            if (!hasFullAccessToTab('settings')) {
              alert("權限不足：不可於設定分頁核准帳號。");
              return;
            }
            // 準備 users 文件內容（不含密碼），狀態設為在職
            if (!db || !fns.collection || !fns.doc) throw new Error("Firestore 未初始化");
            const payload = {
              photoUrl: item.photoUrl || "",
              name: item.name || "",
              title: item.title || "",
              email: item.email || "",
              phone: item.phone || "",
              licenses: Array.isArray(item.licenses) ? item.licenses : [],
              role: item.role || "一般",
              companyId: item.companyId || null,
              companyIds: Array.isArray(item.companyIds) ? item.companyIds : (item.companyId ? [item.companyId] : []),
              serviceCommunities: Array.isArray(item.serviceCommunities) ? item.serviceCommunities : [],
              status: "在職",
              createdAt: fns.serverTimestamp(),
            };
            let authCreated = false;
            let authUid = null;
            let emailExists = false;
            const rawPwd = (item && typeof item.password === 'string') ? item.password : '';
            const rawConfirm = (item && typeof item.passwordConfirm === 'string') ? item.passwordConfirm : '';
            const newPwd = (rawPwd && rawPwd === rawConfirm) ? rawPwd : '000000';
            if (item.email) {
              if (fns.functions && fns.httpsCallable) {
                try {
                  const createUser = fns.httpsCallable(fns.functions, "adminCreateUser");
                  const res = await createUser({ email: item.email, password: newPwd, name: item.name || "", photoUrl: item.photoUrl || "" });
                  authUid = res?.data?.uid || null;
                  authCreated = !!authUid;
                } catch (err) {
                  console.warn("核准時建立 Auth 失敗，改用 REST", err);
                  try {
                    const r = await createAuthUserViaRest(item.email, newPwd);
                    authUid = r.uid;
                    authCreated = !!authUid;
                  } catch (err2) {
                    const msg = String(err2?.message || "");
                    if (/EMAIL_EXISTS/.test(msg)) {
                      emailExists = true;
                      try { if (fns.sendPasswordResetEmail && auth) await fns.sendPasswordResetEmail(auth, item.email); } catch {}
                    } else {
                      console.warn("REST 建立 Auth 失敗", err2);
                    }
                  }
                }
              } else {
                try {
                  const r = await createAuthUserViaRest(item.email, newPwd);
                  authUid = r.uid;
                  authCreated = !!authUid;
                } catch (err2) {
                  const msg = String(err2?.message || "");
                  if (/EMAIL_EXISTS/.test(msg)) {
                    emailExists = true;
                    try { if (fns.sendPasswordResetEmail && auth) await fns.sendPasswordResetEmail(auth, item.email); } catch {}
                  } else {
                    console.warn("REST 建立 Auth 失敗", err2);
                  }
                }
              }
            }

            // 刪除待審核紀錄
            await withRetry(() => fns.deleteDoc(fns.doc(db, "pendingAccounts", pid)));

            // 更新前端狀態與 UI
            // 寫入 users：若有 authUid，直接以其為文件 ID；否則建立新文件
            let finalUserId = null;
            if (authUid) {
              const ref = fns.doc(db, "users", authUid);
              await withRetry(() => fns.setDoc(ref, payload, { merge: true }));
              finalUserId = authUid;
            } else {
              const docRef = await withRetry(() => fns.addDoc(fns.collection(db, "users"), payload));
              finalUserId = docRef.id;
            }
            appState.accounts.push({ id: finalUserId, ...payload, uid: authUid || null });
            appState.pendingAccounts = appState.pendingAccounts.filter((x) => x.id !== pid);
            renderSettingsContent("帳號");
            // 提示狀態：已核准基本資料；若未建立 Auth，提醒管理者後續處理
            if (authCreated) {
              if (newPwd === '000000') {
                alert("核准完成：已加入帳號列表，登入預設密碼為 000000。");
              } else {
                alert("核准完成：已加入帳號列表，登入密碼為申請者自訂的密碼。");
              }
            } else {
              if (emailExists) {
                alert("核准完成（使用者 Email 已存在於登入系統）：已寄送重設密碼信，使用者重設後即可登入並自動合併資料。");
              } else {
                alert("核准完成（部分）：已加入帳號列表，但未建立登入帳號（Auth）。請稍後在帳號列表設定密碼或部署雲端函式。");
              }
            }
          } catch (err) {
            alert(`核准帳號失敗：${err?.message || err}`);
          }
        })();
      } else if (act === "del") {
        (async () => {
          const ok = await confirmAction({ title: "確認刪除待審核帳號", text: `確定要刪除此待審核帳號「${item.name || item.email || pid}」嗎？`, confirmText: "刪除" });
          if (!ok) return;
          try {
            if (db && fns.deleteDoc && fns.doc) {
              await withRetry(() => fns.deleteDoc(fns.doc(db, "pendingAccounts", pid)));
            }
          } catch (err) {
            console.warn("刪除 Firestore 待審核紀錄失敗：", err);
          }
          appState.pendingAccounts = appState.pendingAccounts.filter((x) => x.id !== pid);
          renderSettingsContent("帳號");
        })();
      }
    });
  });
}


// ===== 3) 檢查是否已設定 API 金鑰 =====
function isConfigReady() {
  const cfg = FIREBASE_CONFIG || {};
  return (
    !!cfg.apiKey && !cfg.apiKey.startsWith("YOUR_") &&
    !!cfg.projectId && !cfg.projectId.startsWith("YOUR_") &&
    !!cfg.appId && !cfg.appId.startsWith("YOUR_")
  );
}

if (!isConfigReady()) {
  setupWarning.classList.remove("hidden");
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
  emailSignInBtn.disabled = true;
} else {
  setupWarning.classList.add("hidden");
  emailSignInBtn.disabled = false;
}

// ===== 4) 動態載入 Firebase 模組並初始化 =====
let firebaseApp, auth, db, functionsApp;
let ensureFirebasePromise = null;
// 將常用 Firebase 函式存到外層，讓按鈕事件可即時呼叫
  let fns = {
  signInWithEmailAndPassword: null,
  createUserWithEmailAndPassword: null,
  signOut: null,
  sendPasswordResetEmail: null,
  doc: null,
  getDoc: null,
  setDoc: null,
  addDoc: null,
  collection: null,
  deleteDoc: null,
  updateDoc: null,
    serverTimestamp: null,
    onSnapshot: null,
  // Firebase Functions（雲端函式）
  functions: null,
    httpsCallable: null,
  };

  async function ensureFirebase() {
  if (!isConfigReady()) return;
  if (firebaseInitialized && auth && db) { return; }
  if (ensureFirebasePromise) { return ensureFirebasePromise; }
  ensureFirebasePromise = (async () => {
    const importWithRetry = async (url) => withRetry(() => import(url));
    const appMod = await importWithRetry("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
    const authMod = await importWithRetry("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js");
    const fsMod = await importWithRetry("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-lite.js");
    const { initializeApp } = appMod;
    const { getAuth, onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signInAnonymously } = authMod;
    const { getFirestore, doc, getDoc, setDoc, addDoc, collection, getDocs, deleteDoc, updateDoc, serverTimestamp, query, where, orderBy, limit } = fsMod;
    let getFunctions = null;
    let httpsCallable = null;
    try {
      const mod = await importWithRetry("https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js");
      getFunctions = mod.getFunctions;
      httpsCallable = mod.httpsCallable;
    } catch (err) {
      console.warn("載入 Firebase Functions 模組失敗（忽略並持續初始化）：", err);
    }

  // 初始化 Firebase
  firebaseApp = initializeApp(FIREBASE_CONFIG);
  auth = getAuth(firebaseApp);
  // Firestore Lite：使用 REST 請求，不建立 WebChannel/Listen 連線
  db = getFirestore(firebaseApp);
  // 明確指定雲端函式區域，避免跨區造成呼叫錯誤或 CORS 問題
  const isSecure = (typeof location !== 'undefined') ? (location.protocol === 'https:') : true;
  functionsApp = (isSecure && getFunctions) ? getFunctions(firebaseApp, "us-central1") : null;

  // 將函式指派到外層供事件使用
  fns.signInWithEmailAndPassword = signInWithEmailAndPassword;
  fns.createUserWithEmailAndPassword = createUserWithEmailAndPassword;
  fns.signOut = signOut;
  fns.sendPasswordResetEmail = sendPasswordResetEmail;
  fns.signInAnonymously = signInAnonymously;
  fns.doc = doc;
  fns.getDoc = getDoc;
  fns.setDoc = setDoc;
  fns.addDoc = addDoc;
  fns.collection = collection;
  fns.getDocs = getDocs;
  fns.deleteDoc = deleteDoc;
  fns.updateDoc = updateDoc;
  fns.serverTimestamp = serverTimestamp;
  // 查詢輔助
  fns.query = query;
  fns.where = where;
  fns.orderBy = orderBy;
  fns.limit = limit;
  // 雲端函式
  fns.functions = functionsApp;
  fns.httpsCallable = functionsApp ? httpsCallable : null;

  // 監聽登入狀態（容錯：若網路或授權網域設定不完整，改為顯示登入頁）
  try {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
        // 顯示主頁
        loginView.classList.add("hidden");
        appView.classList.remove("hidden");
      setActiveTab('home');

      // 先以 Auth 設定頁首使用者資訊（後續以 Firestore 覆蓋）
        const initialDisplayName = user.displayName || user.email || "使用者";
        userNameEl.textContent = `歡迎~ ${initialDisplayName}`;
        if (homeHeaderNameEl) homeHeaderNameEl.textContent = initialDisplayName;
  if (userPhotoEl) {
    if (user.photoURL) userPhotoEl.src = user.photoURL; else userPhotoEl.removeAttribute("src");
    userPhotoEl.onclick = () => { try { showProfileModal(user, "一般"); } catch {} };
  }
      if (homeHeroPhoto) {
        if (user.photoURL) homeHeroPhoto.src = user.photoURL; else homeHeroPhoto.removeAttribute("src");
      }

      const userDocRef = doc(db, "users", user.uid);
      let role = "一般";
      try {
          const userSnap = await withRetry(() => getDoc(userDocRef));
        if (userSnap.exists()) {
          const data = userSnap.data();
          role = data.role || role;
          const displayName = data.name || user.displayName || user.email || "使用者";
          userNameEl.textContent = `歡迎~ ${displayName}`;
          if (homeHeaderNameEl) homeHeaderNameEl.textContent = displayName;
          if (userPhotoEl) {
            const photoFromDoc = data.photoUrl || "";
            if (photoFromDoc) userPhotoEl.src = photoFromDoc; else if (user.photoURL) userPhotoEl.src = user.photoURL; else userPhotoEl.removeAttribute("src");
            userPhotoEl.onclick = () => { try { showProfileModal(user, role); } catch {} };
          }
          if (homeHeroPhoto) {
            const photoFromDoc = data.photoUrl || "";
            if (photoFromDoc) homeHeroPhoto.src = photoFromDoc; else if (user.photoURL) homeHeroPhoto.src = user.photoURL; else homeHeroPhoto.removeAttribute("src");
          }
        } else {
          try {
            const q = query(collection(db, "users"), where("email", "==", user.email || ""));
            const qs = await withRetry(() => getDocs(q));
            let found = null;
            qs.forEach((d) => { if (!found) found = d; });
            if (found) {
              const data = found.data() || {};
              role = data.role || role;
              const displayName = data.name || user.displayName || user.email || "使用者";
              userNameEl.textContent = `歡迎~ ${displayName}`;
              if (homeHeaderNameEl) homeHeaderNameEl.textContent = displayName;
              const photoFromDoc = data.photoUrl || "";
              if (photoFromDoc) {
                if (userPhotoEl) userPhotoEl.src = photoFromDoc;
                if (homeHeroPhoto) homeHeroPhoto.src = photoFromDoc;
              }
              await withRetry(() => setDoc(userDocRef, { ...data, uid: user.uid }, { merge: true }));
            } else {
              await withRetry(() => setDoc(userDocRef, { role, name: user.displayName || "使用者", email: user.email || "", createdAt: serverTimestamp() }));
            }
          } catch (_) {
            await withRetry(() => setDoc(userDocRef, { role, name: user.displayName || "使用者", email: user.email || "", createdAt: serverTimestamp() }));
          }
        }
      } catch (err) {
        console.warn("載入使用者文件失敗", err);
      }
      // 將目前使用者資訊保存於 appState 供權限檢查
      appState.currentUserId = user.uid;
      appState.currentUserRole = role;
      appState.currentUserEmail = user.email || null;
      // 身份資訊可移至頁首或設定分頁說明；此處改為由子分頁顯示邏輯控制

      // 登入後嘗試同步離線期間累積的打卡與請假紀錄
      try { await flushPendingCheckins(); } catch {}
      try { await flushPendingLeaves(); } catch {}
      try { await flushPendingAccounts(); } catch {}

      // 依帳號「頁面權限」控制可見的分頁（首頁永遠顯示）
      try { await loadRolesFromFirestore(); } catch {}
      applyPagePermissionsForUser(user);
      try { refreshSubtabBadges(); } catch {}

        // 紀錄目前裝置型號至 Firestore（供其他裝置顯示）
        initDeviceProfile();

      const cached = getLastCheckin(user.uid);
      if (cached && homeStatusEl) {
        setHomeStatus(cached.key || "work", cached.label || "上班");
        renderHomeStatusText(cached.summary || "");
      }
      try {
        const q2 = fns.query(
          fns.collection(db, "checkins"),
          fns.where("uid", "==", user.uid)
        );
        const snap2 = await fns.getDocs(q2);
        let best = null;
        const mapLabelToKey = (s) => {
          switch (s) {
            case '上班': return 'work';
            case '下班': return 'off';
            case '外出': return 'out';
            case '抵達': return 'arrive';
            case '返回': return 'return';
            case '離開': return 'leave';
            case '請假': return 'leave-request';
            default: return 'work';
          }
        };
        snap2.forEach((docSnap) => {
          const d = docSnap.data();
          const val = d.createdAt;
          let dt = null;
          if (val && typeof val.toDate === 'function') dt = val.toDate(); else if (typeof val === 'string') dt = new Date(val);
          if (!dt) return;
          if (!best || dt > best.dt) best = { data: d, dt };
        });
        if (best) {
          const d = best.data; const dt = best.dt;
          const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}:${String(dt.getSeconds()).padStart(2,'0')}`;
          const summary = `${dateStr} ${d.locationName || ''} ${d.status || ''} ${d.inRadius === true ? '正常' : '異常'}`.trim();
          const label = d.status || '';
          setHomeStatus(mapLabelToKey(label), label);
          if (homeStatusEl) renderHomeStatusText(summary);
          setLastCheckin(user.uid, { summary, key: mapLabelToKey(label), label });
        } else {
          const rest = await fetchLastCheckinViaRest(user.uid);
          if (rest) {
            const label = rest.status || '';
            setHomeStatus(mapLabelToKey(label), label);
            if (homeStatusEl) renderHomeStatusText(rest.summary || '');
            setLastCheckin(user.uid, { summary: rest.summary || '', key: mapLabelToKey(label), label });
          } else {
            if (homeStatusEl) homeStatusEl.textContent = '';
          }
        }
      } catch {}

      // 從 Firestore 載入 users 清單，帶入帳號列表
      await loadAccountsFromFirestore();

      // 從 Firestore 載入 設定→一般 所需清單（公司、區域、證照）
      await Promise.all([
        loadCompaniesFromFirestore(),
        loadRegionsFromFirestore(),
        loadLicensesFromFirestore(),
        loadCommunitiesFromFirestore(),
        loadPointsRulesFromFirestore(),
      ]);
      try { refreshSubtabBadges(); } catch {}
      // 依設定分頁可見決定是否載入待審核帳號
      if (hasFullAccessToTab('settings')) {
        await loadPendingAccountsFromFirestore();
        try { await normalizeCompanyIdsForAccounts(); } catch {}
      }
      if (activeMainTab === "settings" && activeSubTab === "一般") renderSettingsContent("一般");

      // 啟用定位顯示
      initGeolocation();
      startGeoRefresh();

        // 綁定打卡
        checkinBtn?.addEventListener("click", () => doCheckin(user, role));
      } else {
        // 顯示登入頁
        appView.classList.add("hidden");
        loginView.classList.remove("hidden");
        userNameEl.textContent = "未登入";
        if (homeHeaderNameEl) homeHeaderNameEl.textContent = "";
        userPhotoEl.removeAttribute("src");
        // 登出時恢復顯示所有分頁
        resetPagePermissions();
        stopGeoRefresh();
      }
    });
    authListenerAttached = true;
    firebaseInitialized = true;
  } catch (err) {
    // 提示使用者可能需要在 Firebase Authentication 設定中加入授權網域（localhost/127.0.0.1）
    console.warn("Firebase Auth 狀態監聽失敗：", err);
    setupWarning.classList.remove("hidden");
    loginView.classList.remove("hidden");
    appView.classList.add("hidden");
    emailSignInBtn.disabled = true;
  }
  })();
  return ensureFirebasePromise;
}

// 分頁切換
  function resolveExternalUrl() {
    try {
      const companies = Array.isArray(appState.companies) ? appState.companies : [];
      let coId = appState.leaderCompanyFilter || null;
      if (!coId) {
        const me = appState.accounts.find((a) => a.id === appState.currentUserId) || null;
        const ids = Array.isArray(me?.companyIds) ? me.companyIds : (me?.companyId ? [me.companyId] : []);
        coId = ids && ids.length ? ids[0] : null;
      }
      let co = null;
      if (coId) {
        co = companies.find((c) => String(c.id||'') === String(coId)) || companies.find((c) => String(c.name||'') === String(coId)) || null;
      }
      if (!co) co = companies[0] || null;
      const url = String(co?.externalUrl || '').trim();
      return url || '';
    } catch { return ''; }
  }
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab === 'external') {
        const url = resolveExternalUrl();
        if (url) { try { window.open(url, '_blank'); } catch {} }
        else { alert('未設定外部連結網址'); }
        return;
      }
      setActiveTab(tab);
    });
  });

  // 請假與補卡
  btnLeaveRequest?.addEventListener('click', () => {
    let __leaveRefs = null;
              openModal({
                title: '新增請假',
                fields: [
        { key: 'type', label: '類型', type: 'select', options: [
          { value: '病假', label: '病假' },
          { value: '事假', label: '事假' },
          { value: '特休', label: '特休' },
          { value: '公假', label: '公假' },
          { value: '其他', label: '其他' },
        ] },
        { key: 'startAt', label: '開始', type: 'datetime-local', step: 60 },
        { key: 'endAt', label: '結束', type: 'datetime-local', step: 60 },
        { key: 'reason', label: '原因', type: 'text' },
        { key: 'attachment', label: '上傳照片', type: 'file', accept: 'image/png,image/jpeg' },
      ],
      initial: { type: '病假' },
      submitText: '送出申請',
      refreshOnSubmit: false,
      onSubmit: async (data) => {
        try {
          if (__leaveRefs && __leaveRefs.errs) { Object.values(__leaveRefs.errs).forEach((el) => { el.textContent = ''; }); }
          const typ = String(data.type || '').trim();
          const sAt = String(data.startAt || '').trim();
          const eAt = String(data.endAt || '').trim();
          const rsn = String(data.reason || '').trim();
          const att = String(data.attachment || window.__leaveAttachmentData || '').trim();
          let hasErr = false;
          if (!typ) { hasErr = true; if (__leaveRefs?.errs?.type) __leaveRefs.errs.type.textContent = '請選擇類型'; }
          if (!sAt) { hasErr = true; if (__leaveRefs?.errs?.startAt) __leaveRefs.errs.startAt.textContent = '請輸入開始'; }
          if (!eAt) { hasErr = true; if (__leaveRefs?.errs?.endAt) __leaveRefs.errs.endAt.textContent = '請輸入結束'; }
          if (!rsn) { hasErr = true; if (__leaveRefs?.errs?.reason) __leaveRefs.errs.reason.textContent = '請填寫原因'; }
          if (!att) { hasErr = true; if (__leaveRefs?.errs?.attachment) __leaveRefs.errs.attachment.textContent = '請上傳照片'; }
          if (hasErr) return false;
          await ensureFirebase();
          const u = auth?.currentUser || null;
          const payload = {
            uid: u?.uid || null,
            name: (homeHeaderNameEl?.textContent || '').replace(/^歡迎~\s*/, '') || (u?.email || '使用者'),
            type: String(data.type || ''),
            startAt: String(data.startAt || ''),
            endAt: String(data.endAt || ''),
            reason: String(data.reason || ''),
            attachmentData: String(data.attachment || window.__leaveAttachmentData || ''),
            status: '送審',
            createdAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString(),
          };
          let saved = false;
          if (db && fns.addDoc && fns.collection) {
            try { await withRetry(() => fns.addDoc(fns.collection(db, 'leaveRequests'), payload)); saved = true; } catch {}
          }
          if (!saved) {
            const p2 = { ...payload };
            if (typeof p2.createdAt !== 'string') p2.createdAt = new Date(networkNowMs()).toISOString();
            enqueuePendingLeave(p2);
          }
          alert('已送出請假申請');
          return true;
        } catch (e) {
          const msg = e?.message || e;
          alert(typeof msg === 'string' ? `送出失敗：${msg}` : '送出失敗');
          return false;
        }
      },
      afterRender: ({ body }) => {
        try {
          const fileInput = body.querySelector('[data-key="attachment"]');
          if (fileInput) {
            fileInput.addEventListener('change', () => {
              try {
                const f = fileInput.files?.[0];
                if (!f) { window.__leaveAttachmentData = ''; return; }
                const reader = new FileReader();
                reader.onload = () => { window.__leaveAttachmentData = String(reader.result || ''); };
                reader.readAsDataURL(f);
              } catch { window.__leaveAttachmentData = ''; }
            });
          }
          const makeErr = (key) => {
            const input = body.querySelector(`[data-key="${key}"]`);
            const row = input?.parentElement;
            if (!row) return null;
            let el = row.querySelector('.help');
            if (!el) { el = document.createElement('div'); el.className = 'help'; row.appendChild(el); }
            if (input) { input.addEventListener('input', () => { el.textContent = ''; }); input.addEventListener('change', () => { el.textContent = ''; }); }
            return el;
          };
          __leaveRefs = { errs: { type: makeErr('type'), startAt: makeErr('startAt'), endAt: makeErr('endAt'), reason: makeErr('reason'), attachment: makeErr('attachment') } };
        } catch {}
      }
    });
  });

  btnMakeup?.addEventListener('click', () => {
    const statusOptions = [
      { value: '上班', label: '上班' },
      { value: '下班', label: '下班' },
      { value: '外出', label: '外出' },
      { value: '抵達', label: '抵達' },
      { value: '離開', label: '離開' },
      { value: '返回', label: '返回' },
    ];
    // 依角色與帳號取得打卡位置選項（與上班打卡位置相同資料來源）
    const userRole = appState.currentUserRole || '一般';
    const adminRoles = new Set(['系統管理員', '管理層', '高階主管', '初階主管', '行政']);
    const uid = appState.currentUserId || null;
    const userAccount = uid ? (appState.accounts.find((a) => a.id === uid) || null) : null;
    let placeOptions = [];
    let sourceType = 'company';
    if (adminRoles.has(userRole)) {
      if (userAccount && Array.isArray(userAccount.companyIds) && userAccount.companyIds.length > 0) {
        const set = new Set(userAccount.companyIds);
        const list = appState.companies.filter((c) => set.has(c.id)).slice().sort((a,b)=>{
          const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
          const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return String(a.name||'').localeCompare(String(b.name||''), 'zh-Hant');
        });
        placeOptions = list.map((c) => ({ value: c.id, label: c.name }));
      } else if (userAccount?.companyId) {
        const co = appState.companies.find((c) => c.id === userAccount.companyId) || null;
        placeOptions = co ? [{ value: co.id, label: co.name }] : [];
      }
      if (!placeOptions.length) placeOptions = optionList(appState.companies);
      sourceType = 'company';
    } else {
      const allowedCommunityIds = (userAccount && Array.isArray(userAccount.serviceCommunities)) ? new Set(userAccount.serviceCommunities) : null;
      let communities = [];
      if (allowedCommunityIds && allowedCommunityIds.size > 0) {
        communities = appState.communities.filter((c) => allowedCommunityIds.has(c.id));
      } else if (userAccount && Array.isArray(userAccount.companyIds) && userAccount.companyIds.length > 0) {
        const coSet = new Set(userAccount.companyIds);
        communities = appState.communities.filter((c) => coSet.has(c.companyId));
      } else if (userAccount?.companyId) {
        communities = appState.communities.filter((c) => c.companyId === userAccount.companyId);
      } else {
        communities = appState.communities.slice();
      }
      communities = communities.slice().sort((a,b)=>{
        const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
        const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return String(a.name||'').localeCompare(String(b.name||''), 'zh-Hant');
      });
      placeOptions = communities.map((c) => ({ value: c.id, label: c.name }));
      sourceType = 'community';
    }
    openModal({
      title: '補卡申請',
      fields: [
        { key: 'place', label: '打卡地點', type: 'select', options: placeOptions },
        { key: 'status', label: '狀態', type: 'select', options: statusOptions },
        { key: 'datetime', label: '日期時間', type: 'datetime-local', placeholder: '請選擇日期時間' },
      ],
      initial: { place: (placeOptions[0]?.value || ''), status: '上班', datetime: '' },
      submitText: '送出',
      refreshOnSubmit: false,
      onSubmit: async (data) => {
        try {
          await ensureFirebase();
          try { loadRosterPlansFromStorage(); } catch {}
          const user = auth?.currentUser || null;
          const selected = placeOptions.find((o) => String(o.value) === String(data.place || '')) || null;
          const payload = {
            uid: user?.uid || null,
            name: (homeHeaderNameEl?.textContent || '').replace(/^歡迎~\s*/, ''),
            place: selected ? (selected.label || '') : '',
            status: String(data.status || ''),
            datetime: String(data.datetime || ''),
            createdAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString(),
          };
          if (db && fns.addDoc && fns.collection) {
            await withRetry(() => fns.addDoc(fns.collection(db, 'makeupRequests'), payload));
          }
          alert('已送出補卡申請');
          return true;
        } catch (e) {
          alert(`送出失敗：${e?.message || e}`);
          return false;
        }
      },
    });
  });

  // 防呆：頁尾事件委派，避免個別按鈕事件失效
  const appFooter = document.querySelector('.app-footer');
  if (appFooter) {
    appFooter.addEventListener('click', (e) => {
      const el = e.target && e.target.closest && e.target.closest('.tab-btn');
      if (el && el.dataset && el.dataset.tab) {
        setActiveTab(el.dataset.tab);
      }
    });
  }

  async function loadAccountsFromFirestore() {
    if (!db || !fns.getDocs || !fns.collection) return;
    try {
      const snap = await withRetry(() => fns.getDocs(fns.collection(db, "users")));
      const items = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data() || {};
        items.push({
          id: docSnap.id,
          uid: d.uid || docSnap.id,
          photoUrl: d.photoUrl || "",
          name: d.name || "",
          title: d.title || "",
          email: d.email || "",
          phone: d.phone || "",
          password: d.password || "",
          passwordConfirm: d.passwordConfirm || "",
          emergencyName: d.emergencyName || "",
          emergencyRelation: d.emergencyRelation || "",
          emergencyPhone: d.emergencyPhone || "",
          bloodType: d.bloodType || "",
          birthdate: d.birthdate || "",
          licenses: Array.isArray(d.licenses) ? d.licenses : [],
          role: d.role || "保全",
          companyId: d.companyId || null,
          companyIds: Array.isArray(d.companyIds) ? d.companyIds : (d.companyId ? [d.companyId] : []),
        serviceCommunities: Array.isArray(d.serviceCommunities) ? d.serviceCommunities : [],
        status: d.status || "在職",
      });
      });
      items.forEach((it) => {
        const idx = appState.accounts.findIndex((a) => a.id === it.id);
        if (idx >= 0) {
          appState.accounts[idx] = { ...appState.accounts[idx], ...it };
        } else {
          appState.accounts.push(it);
        }
      });
      try {
        const uid = appState.currentUserId || null;
        if (uid) {
          const acc = appState.accounts.find((a) => a.id === uid) || null;
          const nm = acc?.name || "";
          if (nm) {
            if (homeHeaderNameEl) homeHeaderNameEl.textContent = nm;
            if (userNameEl) userNameEl.textContent = `歡迎~ ${nm}`;
          }
          const photo = acc?.photoUrl || "";
          if (photo) {
            if (userPhotoEl) userPhotoEl.src = photo;
            if (homeHeroPhoto) homeHeroPhoto.src = photo;
          }
        }
      } catch {}
      if (activeMainTab === "settings" && activeSubTab === "帳號") renderSettingsContent("帳號");
    } catch (err) {
      console.warn("載入 Firestore users 失敗：", err);
    }
  }

  async function loadCompaniesFromFirestore() {
    if (!db || !fns.getDocs || !fns.collection) return;
    try {
      const snap = await withRetry(() => fns.getDocs(fns.collection(db, "companies")));
      const items = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data() || {};
        items.push({ id: docSnap.id, name: d.name || "", coords: d.coords || "", radiusMeters: d.radiusMeters ?? null, order: (typeof d.order === "number" ? d.order : null), externalUrl: (typeof d.externalUrl === 'string' ? d.externalUrl : '') });
      });
      items.sort(compareCommunityByCode);
      // 以雲端資料覆蓋本地預設項目，避免預設示例持續顯示
      appState.companies = items;
      if (activeMainTab === "settings" && activeSubTab === "一般") renderSettingsContent("一般");
    } catch (err) {
      console.warn("載入 Firestore companies 失敗：", err);
    }
  }

  async function loadRegionsFromFirestore() {
    if (!db || !fns.getDocs || !fns.collection) return;
    try {
      const snap = await withRetry(() => fns.getDocs(fns.collection(db, "regions")));
      const items = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data() || {};
        items.push({ id: docSnap.id, name: d.name || "" });
      });
      // 以雲端資料覆蓋本地預設項目，避免預設示例持續顯示造成誤解
      appState.regions = items;
      if (activeMainTab === "settings" && activeSubTab === "一般") renderSettingsContent("一般");
    } catch (err) {
      console.warn("載入 Firestore regions 失敗：", err);
    }
  }

  async function loadLicensesFromFirestore() {
    if (!db || !fns.getDocs || !fns.collection) return;
    try {
      const snap = await withRetry(() => fns.getDocs(fns.collection(db, "licenses")));
      const items = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data() || {};
        items.push({ id: docSnap.id, name: d.name || "" });
      });
      items.forEach((it) => {
        const idx = appState.licenses.findIndex((a) => a.id === it.id);
        if (idx >= 0) appState.licenses[idx] = { ...appState.licenses[idx], ...it }; else appState.licenses.push(it);
      });
    } catch (err) {
      console.warn("載入 Firestore licenses 失敗：", err);
    }
  }

  async function normalizeCompanyIdsForAccounts() {
    try {
      await ensureFirebase();
      const companies = Array.isArray(appState.companies) ? appState.companies : [];
      if (!companies.length) return;
      const idSet = new Set(companies.map((c) => String(c.id || '').trim()).filter(Boolean));
      const nameToId = new Map(companies.map((c) => [String(c.name || '').trim(), String(c.id || '').trim()]));
      const accounts = Array.isArray(appState.accounts) ? appState.accounts : [];
      for (let i = 0; i < accounts.length; i++) {
        const a = accounts[i];
        const list0 = Array.isArray(a.companyIds) ? a.companyIds : (a.companyId ? [a.companyId] : []);
        const norm = [];
        list0.forEach((v) => {
          const s = String(v || '').trim();
          if (!s) return;
          if (idSet.has(s)) { norm.push(s); return; }
          const id = nameToId.get(s);
          if (id) norm.push(id);
        });
        const uniq = Array.from(new Set(norm));
        if (!uniq.length) continue;
        const oldIds = (Array.isArray(a.companyIds) ? a.companyIds : []).map((x) => String(x || '').trim());
        const needUpdate = JSON.stringify(oldIds) !== JSON.stringify(uniq) || String(a.companyId || '').trim() !== String(uniq[0] || '');
        if (!needUpdate) continue;
        const payload = { companyIds: uniq, companyId: uniq[0] };
        try {
          if (db && fns.updateDoc && fns.doc) {
            await withRetry(() => fns.updateDoc(fns.doc(db, 'users', a.id), payload));
          }
          const updated = { ...a, ...payload };
          const idx = appState.accounts.findIndex((x) => x.id === a.id);
          if (idx >= 0) appState.accounts[idx] = updated;
        } catch {}
      }
    } catch {}
  }

  async function loadCommunitiesFromFirestore() {
    if (!db || !fns.getDocs || !fns.collection) return;
    try {
      const snap = await withRetry(() => fns.getDocs(fns.collection(db, "communities")));
      const items = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data() || {};
        items.push({
          id: docSnap.id,
          code: d.code || "",
          name: d.name || "",
          companyId: d.companyId || null,
          regionId: d.regionId || null,
          coords: d.coords || "",
          address: d.address || "",
          radiusMeters: d.radiusMeters ?? null,
          order: (typeof d.order === "number" ? d.order : null),
        });
      });
      items.sort((a,b)=>{
        const ao = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
        const bo = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return String(a.name||"").localeCompare(String(b.name||""), "zh-Hant");
      });
      items.forEach((it) => {
        const idx = appState.communities.findIndex((a) => a.id === it.id);
        if (idx >= 0) appState.communities[idx] = { ...appState.communities[idx], ...it }; else appState.communities.push(it);
      });
      if (activeMainTab === "settings" && activeSubTab === "社區") renderSettingsContent("社區");
    } catch (err) {
      console.warn("載入 Firestore communities 失敗：", err);
    }
  }

  async function loadPointsRulesFromFirestore() {
    try {
      await ensureFirebase();
      if (!db || !fns.collection || !fns.getDocs) return;
      const ref = fns.collection(db, 'pointsRules');
      const snap = await withRetry(() => fns.getDocs(ref));
      const list = [];
      snap.forEach((doc) => { const d = doc.data() || {}; list.push({ id: doc.id, ...d }); });
      appState.pointsRules = list;
    } catch {}
  }

  // 待審核帳號：從 Firestore 載入
  async function loadPendingAccountsFromFirestore() {
    if (!db || !fns.getDocs || !fns.collection) return;
    try {
      const role = appState.currentUserRole || "保全";
      let q = fns.collection(db, "pendingAccounts");
      if (!hasFullAccessToTab('settings') && appState.currentUserEmail) {
        q = fns.query(q, fns.where("email", "==", appState.currentUserEmail));
      }
      const snap = await withRetry(() => fns.getDocs(q));
      const items = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data() || {};
      items.push({
        id: docSnap.id,
        photoUrl: d.photoUrl || "",
        name: d.name || "",
        title: d.title || "",
        email: d.email || "",
        phone: d.phone || "",
        licenses: Array.isArray(d.licenses) ? d.licenses : [],
        role: d.role || "保全",
        companyId: d.companyId || null,
        companyIds: Array.isArray(d.companyIds) ? d.companyIds : (d.companyId ? [d.companyId] : []),
        serviceCommunities: Array.isArray(d.serviceCommunities) ? d.serviceCommunities : [],
        status: d.status || "待審核",
      });
      });
      // 覆蓋或新增到前端狀態
      items.forEach((it) => {
        const idx = appState.pendingAccounts.findIndex((a) => a.id === it.id);
        if (idx >= 0) appState.pendingAccounts[idx] = { ...appState.pendingAccounts[idx], ...it }; else appState.pendingAccounts.push(it);
      });
      if (activeMainTab === "settings" && activeSubTab === "帳號") renderSettingsContent("帳號");
    } catch (err) {
      console.warn("載入 Firestore pendingAccounts 失敗：", err);
    }
  }

function applyPagePermissionsForUser(user) {
  try {
    const role = appState.currentUserRole || "一般";
    const allTabs = ["home","checkin","leader","manage","feature","external","personnel","settings"];
    let allowed = ["home"];
    const cfg = Array.isArray(appState.rolesConfig) ? appState.rolesConfig.find((r) => String(r.name||"") === String(role)) : null;
    if (cfg && Array.isArray(cfg.allowedTabs) && cfg.allowedTabs.length) {
      allowed = cfg.allowedTabs.filter((t) => allTabs.includes(t));
      if (!allowed.includes("home")) allowed.unshift("home");
    } else {
      switch (role) {
        case "系統管理員":
          allowed = ["home","checkin","leader","manage","feature","external","personnel","settings"];
          break;
        case "管理層":
          allowed = ["home","checkin","leader","manage","feature","external","personnel"];
          break;
        case "高階主管":
          allowed = ["home","checkin","manage","feature","external"];
          break;
        case "初階主管":
          allowed = ["home","checkin","manage","feature","external"];
          break;
        case "行政":
          allowed = ["home","checkin","feature","external"];
          break;
        case "保全":
          allowed = ["home","checkin","feature","external"];
          break;
        case "總幹事":
        case "秘書":
        case "清潔":
        case "機電":
          allowed = ["home","checkin","feature","external"];
          break;
        default:
          allowed = ["home","checkin","feature","external"];
          break;
      }
    }
    appState.allowedTabs = allowed;
    (async () => {
      try {
        await ensureFirebase();
        const uid = auth?.currentUser?.uid || null;
        if (uid && db && fns.setDoc && fns.doc) {
          await withRetry(() => fns.setDoc(fns.doc(db, 'users', uid), { pagePermissions: allowed }, { merge: true }));
        }
      } catch {}
    })();
    tabButtons.forEach((b) => {
      const t = b.dataset.tab || "";
      const show = allowed.includes(t);
      b.classList.toggle("hidden", !show);
    });
    const currentShown = allowed.includes(activeMainTab);
    if (!currentShown) setActiveTab("home");
  } catch (_) {
    tabButtons.forEach((b) => b.classList.remove("hidden"));
  }
}

function hasFullAccessToTab(tab) {
  try {
    const allowed = Array.isArray(appState.allowedTabs) ? appState.allowedTabs : [];
    return allowed.includes(tab);
  } catch { return false; }
}

  function resetPagePermissions() {
    tabButtons.forEach((b) => b.classList.remove("hidden"));
  }

  function setActiveTab(tab) {
    const same = tab === activeMainTab;
    activeMainTab = tab;
    tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    homeSection.classList.toggle("hidden", tab !== "home");
    checkinSection.classList.toggle("hidden", tab !== "checkin");
    leaderSection.classList.toggle("hidden", tab !== "leader");
    personnelSection?.classList.toggle("hidden", tab !== "personnel");
    manageSection.classList.toggle("hidden", tab !== "manage");
    featureSection.classList.toggle("hidden", tab !== "feature");
    settingsSection.classList.toggle("hidden", tab !== "settings");
    // 首頁專用版面：切換 home-layout 類別
    appView.classList.toggle("home-layout", tab === "home");
    // 首頁專用大圖已停用，不顯示
    if (homeHero) homeHero.classList.add("hidden");
    // 所有分頁顯示地圖覆蓋層
    homeMapOverlay?.classList.toggle("hidden", false);
    // 首頁：A/B/C/D/E 堆疊顯示切換
    homeHeaderStack?.classList.toggle("hidden", tab !== "home");
    if (tab === "home") { startHomeClock(); renderHomeRosterLabel(); } else { stopHomeClock(); }
    // 所有分頁皆更新定位地圖，僅在頁面可見時執行
    startGeoRefresh();
    if (!same) renderSubTabs(tab);
  }

  function renderSubTabs(mainTab) {
    const tabs = SUB_TABS[mainTab] || [];
    subTabsEl.innerHTML = "";
    if (!tabs.length) return;
  if (mainTab === 'leader') {
    const sel = document.createElement('select');
    sel.className = 'subtab-select';
    sel.id = 'leaderCompanySelect';
    const companies = Array.isArray(appState.companies) ? appState.companies : [];
    const me = appState.accounts.find((a) => a.id === appState.currentUserId) || null;
    const meCompanyIds = Array.isArray(me?.companyIds) ? me.companyIds : (me?.companyId ? [me.companyId] : []);
    const onlyOneRaw = meCompanyIds.length === 1 ? meCompanyIds[0] : null;
    if (companies.length) {
      companies.forEach((co) => {
        const opt = document.createElement('option');
        opt.value = co.id;
        opt.textContent = co.name || co.id;
        sel.appendChild(opt);
      });
    }
    if (onlyOneRaw) {
      let onlyOne = onlyOneRaw;
      if (!companies.some((c) => String(c.id||'') === String(onlyOne))) {
        const byName = companies.find((c) => String(c.name||'') === String(onlyOne));
        if (byName) onlyOne = byName.id;
      }
      appState.leaderCompanyFilter = onlyOne;
      sel.value = onlyOne;
      sel.disabled = true;
    } else if (appState.leaderCompanyFilter) {
      let v = appState.leaderCompanyFilter;
      if (!companies.some((c) => String(c.id||'') === String(v))) {
        const byName = companies.find((c) => String(c.name||'') === String(v));
        if (byName) v = byName.id;
        appState.leaderCompanyFilter = v;
      }
      sel.value = v;
    } else {
      const firstOpt = sel.options && sel.options.length ? sel.options[0].value : null;
      if (firstOpt) {
        appState.leaderCompanyFilter = firstOpt;
        sel.value = firstOpt;
      }
    }
      sel.addEventListener('change', () => {
        appState.leaderCompanyFilter = sel.value || null;
        setActiveSubTab(activeSubTab);
        try { refreshSubtabBadges(); } catch {}
      });
      subTabsEl.appendChild(sel);
    }
    tabs.forEach((label, idx) => {
      const btn = document.createElement("button");
      btn.className = "subtab-btn";
      btn.textContent = label;
      btn.dataset.subtab = label;
      btn.addEventListener("click", () => setActiveSubTab(label));
      // 掛載按鈕按下互動效果（滑鼠/觸控）
      attachPressInteractions(btn);
      subTabsEl.appendChild(btn);
      if (idx === 0) activeSubTab = label;
    });
    setActiveSubTab(activeSubTab);
    try { refreshSubtabBadges(); } catch {}
  }

  function setActiveSubTab(label) {
    activeSubTab = label;
    Array.from(subTabsEl.querySelectorAll(".subtab-btn")).forEach((b) => {
      b.classList.toggle("active", b.dataset.subtab === label);
    });
    // 更新各分頁的子分頁標題（作占位）
    if (activeMainTab === "checkin") {
      if (checkinSubTitle) checkinSubTitle.textContent = label;
      renderCheckinContent(label);
    } else if (activeMainTab === "leader") {
      if (leaderSubTitle) leaderSubTitle.textContent = label;
      renderLeaderContent(label);
    } else if (activeMainTab === "personnel") {
      renderPersonnelContent(label);
    } else if (activeMainTab === "manage") {
      manageSubTitle.textContent = label;
    } else if (activeMainTab === "feature") {
      featureSubTitle.textContent = label;
      renderFeatureContent(label);
    } else if (activeMainTab === "settings") {
      if (settingsSubTitle) settingsSubTitle.textContent = label;
      if (label === "帳號") {
        if (hasFullAccessToTab('settings')) { try { loadPendingAccountsFromFirestore(); } catch {} }
      }
      renderSettingsContent(label);
    }
    try { refreshSubtabBadges(); } catch {}
  }

  // 人事分頁內容渲染（子分頁）
  function renderPersonnelContent(label) {
    const container = document.getElementById("personnelContent");
    if (!container) return;
    container.innerHTML = "";
    if (label === "班表") {
      try { loadRosterPlansFromStorage(); } catch {}
      const html = `
        <div class="roster-layout" role="region" aria-label="班表">
          <div class="roster-row roster-add">
            <button id="btnAddRoster" class="btn btn-sm hidden">編輯</button>
          </div>
          <div class="roster-row roster-a">
            <label for="rosterOfficerSelect" class="roster-label">幹部名單：</label>
            <select id="rosterOfficerSelect" class="roster-select">
              <option value="">請選擇幹部</option>
            </select>
          </div>
          <div class="roster-row roster-b">
            <div id="rosterCalendar" class="roster-calendar" aria-live="polite">月曆</div>
          </div>
          <div class="roster-row roster-c">
            <div id="rosterInfo" class="roster-info"></div>
          </div>
        </div>`;
      container.innerHTML = html;
      const info = document.getElementById("rosterInfo");
      const dt = nowInTZ('Asia/Taipei');
      // 在資訊區建立日期與列表
      if (info) {
        info.innerHTML = `
          <div class="roster-datebar">
            <div id="rosterDate" class="roster-date"></div>
          </div>
          <table id="rosterList" class="table roster-list" aria-label="班表列表">
            <thead>
              <tr>
                <th scope="col">上班時間</th>
                <th scope="col">下班時間</th>
                <th scope="col">狀態</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        `;
      }
      const rosterDateEl = document.getElementById("rosterDate");
      const rosterListBody = document.querySelector("#rosterList tbody");
      const addBtn = document.getElementById("btnAddRoster");
      const sel = document.getElementById("rosterOfficerSelect");
      function resolveOfficerIds(raw) {
        const v = String(raw||'');
        const acc = (appState.accounts||[]).find((a) => String(a.id||'') === v || String(a.uid||'') === v || String(a.name||'') === v || String(a.email||'') === v) || null;
        return { uid: String(acc?.uid||''), id: String(acc?.id||''), raw: v, name: String(acc?.name||'') };
      }
      // 幹部名單選項
      if (sel) {
        const officers = appState.accounts.filter((a) => (a.role || "").includes("主管") || (a.role || "").includes("管理"));
        const opts = officers.length ? officers : appState.accounts.slice(0, 10);
        opts.forEach((a) => {
          const opt = document.createElement("option");
          opt.value = a.id;
          opt.textContent = a.name || a.email || a.id;
          sel.appendChild(opt);
        });
      }
      // 僅在選擇幹部後顯示新增按鈕
      function refreshAddVisibility() {
        if (!addBtn) return;
        const hasOfficer = !!(sel && sel.value);
        addBtn.classList.toggle("hidden", !hasOfficer);
      }
      refreshAddVisibility();
      sel?.addEventListener("change", () => {
        refreshAddVisibility();
        updateRoster(currentDate);
        document.getElementById("rosterCalendar")?.dispatchEvent(new Event("rosterPlansChanged"));
      });
      let currentDate = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
      function isHoliday(d) { return d.getDay() === 0 || d.getDay() === 6; }
      // 未指派值班時，週五視為休假日
      function isDefaultHoliday(d) { const wd = d.getDay(); return wd === 0 || wd === 6 || wd === 5; }
      function ymd(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
      appState.rosterPlans = appState.rosterPlans || {};
      const rosterPlans = appState.rosterPlans; // officerId -> { ymd -> { startTime, endTime, status } }
      function getRosterBucketByIds(ids) {
        const rp = appState.rosterPlans || {};
        const norm = (s) => String(s||'').trim();
        const keys = [ids.uid, ids.id, ids.raw, ids.name].map(norm).filter(Boolean);
        for (const k of keys) { if (rp[k]) return rp[k]; }
        try {
          const rpKeys = Object.keys(rp);
          for (const key of rpKeys) { if (keys.includes(norm(key))) return rp[key]; }
        } catch {}
        return {};
      }
      function getRosterPlan(bucket, y, m, d) {
        try {
          const b = bucket || {};
          const allKeys = Object.keys(b).map((k)=>String(k||'').trim());
          const dd = String(d).padStart(2,'0');
          const mm = String(m+1).padStart(2,'0');
          const yyyy = String(y);
          const yy = yyyy.slice(-2);
          const candidates = [
            `${yyyy}-${mm}-${dd}`,
            `${yy}-${mm}-${dd}`,
            `${yyyy}-${m+1}-${d}`,
            `${yy}-${m+1}-${d}`,
          ];
          for (const k of candidates) {
            const i = allKeys.indexOf(k);
            if (i >= 0) return b[allKeys[i]] || null;
          }
          return null;
        } catch { return null; }
      }
      function updateRoster(date) {
        if (rosterDateEl) rosterDateEl.textContent = `日期：${ymd(date)}`;
        if (!rosterListBody) return;
        rosterListBody.innerHTML = "";
        const officerId = sel?.value || "";
        const ids = resolveOfficerIds(officerId);
        const bucket = getRosterBucketByIds(ids);
        const plan = getRosterPlan(bucket, date.getFullYear(), date.getMonth(), date.getDate());
        const wd = date.getDay();
        const holiday = isHoliday(date);
        const defaultStatus = defaultRosterStatusForDate(date);
        const startCell = plan ? (String(plan.status||"").includes("休假") ? "" : (plan.startTime || "09:00")) : (defaultStatus === "休假日" ? "" : "09:00");
        const endCell = plan ? (String(plan.status||"").includes("休假") ? "" : (plan.endTime || "17:30")) : (defaultStatus === "休假日" ? "" : "17:30");
        const status = plan ? plan.status : defaultStatus;
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${startCell}</td><td>${endCell}</td><td>${status}</td><td><button class="btn btn-xs roster-edit">編輯</button> <button class="btn btn-xs roster-del">刪除</button></td>`;
        // 編輯
        tr.querySelector(".roster-edit")?.addEventListener("click", () => {
          if (!officerId) return;
          const initial = { startTime: startCell || "09:00", endTime: endCell || "17:30", status };
          openModal({
            title: "編輯班表",
            fields: [
              { key: "startTime", label: "上班時間", type: "text", placeholder: "HH:mm" },
              { key: "endTime", label: "下班時間", type: "text", placeholder: "HH:mm" },
              { key: "status", label: "狀態", type: "select", options: [{ id: "上班日", name: "上班日" }, { id: "值班日", name: "值班日" }, { id: "休假日", name: "休假日" }] },
            ],
            initial,
            submitText: "儲存",
            onSubmit: async (data) => {
              const ids = resolveOfficerIds(officerId);
              const val = { startTime: data.startTime, endTime: data.endTime, status: data.status };
              if (ids.uid) { rosterPlans[ids.uid] = rosterPlans[ids.uid] || {}; rosterPlans[ids.uid][key] = val; }
              if (ids.id) { rosterPlans[ids.id] = rosterPlans[ids.id] || {}; rosterPlans[ids.id][key] = val; }
              if (!ids.uid && !ids.id) { rosterPlans[ids.raw] = rosterPlans[ids.raw] || {}; rosterPlans[ids.raw][key] = val; }
              updateRoster(date);
              document.getElementById("rosterCalendar")?.dispatchEvent(new Event("rosterPlansChanged"));
              try { saveRosterPlansToStorage(); } catch {}
              try { renderHomeRosterLabel(); } catch {}
              try { document.querySelectorAll('.modal').forEach((m) => m.remove()); } catch {}
              try { if (modalRoot) { modalRoot.classList.add('hidden'); modalRoot.innerHTML = ''; } } catch {}
              return true;
            },
          });
        });
        // 刪除 => 標記為休假日
        tr.querySelector(".roster-del")?.addEventListener("click", async () => {
          if (!officerId) return;
          const ok = await confirmAction({ title: "刪除班表", text: "確定要刪除？此日期將標記為休假日。", confirmText: "刪除" });
          if (!ok) return;
          const ids = resolveOfficerIds(officerId);
          const val = { startTime: "", endTime: "", status: "休假日" };
          if (ids.uid) { rosterPlans[ids.uid] = rosterPlans[ids.uid] || {}; rosterPlans[ids.uid][key] = val; }
          if (ids.id) { rosterPlans[ids.id] = rosterPlans[ids.id] || {}; rosterPlans[ids.id][key] = val; }
          if (!ids.uid && !ids.id) { rosterPlans[ids.raw] = rosterPlans[ids.raw] || {}; rosterPlans[ids.raw][key] = val; }
          updateRoster(date);
          document.getElementById("rosterCalendar")?.dispatchEvent(new Event("rosterPlansChanged"));
          try { saveRosterPlansToStorage(); } catch {}
          try { renderHomeRosterLabel(); } catch {}
        });
        rosterListBody.appendChild(tr);
      }
      updateRoster(currentDate);
      // 開啟新增班表彈窗
      if (addBtn) {
        addBtn.addEventListener("click", () => {
          const officerId = sel?.value || "";
          if (!officerId) return;
          const baseYear = currentDate.getFullYear();
          const baseMonth = currentDate.getMonth();
          const totalDays = new Date(baseYear, baseMonth + 1, 0).getDate();
          const workSelected = [];
          const dutySelected = [];
          openModal({
            title: "編輯班表",
            fields: [
              { key: "startTime", label: "上班時間", type: "text", placeholder: "HH:mm" },
              { key: "endTime", label: "下班時間", type: "text", placeholder: "HH:mm" }
            ],
            initial: { startTime: "09:00", endTime: "17:30" },
            submitText: "儲存",
            onSubmit: async (data) => {
              // 全量同步當月的班表：值班 > 上班 > 休假
              const ids = resolveOfficerIds(officerId);
              for (let d = 1; d <= totalDays; d++) {
                const k = `${baseYear}-${String(baseMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                if (dutySelected.includes(d)) {
                  const val = { startTime: data.startTime, endTime: data.endTime, status: "值班日" };
                  if (ids.uid) { rosterPlans[ids.uid] = rosterPlans[ids.uid] || {}; rosterPlans[ids.uid][k] = val; }
                  if (ids.id) { rosterPlans[ids.id] = rosterPlans[ids.id] || {}; rosterPlans[ids.id][k] = val; }
                  if (!ids.uid && !ids.id) { rosterPlans[ids.raw] = rosterPlans[ids.raw] || {}; rosterPlans[ids.raw][k] = val; }
                } else if (workSelected.includes(d)) {
                  const val = { startTime: data.startTime, endTime: data.endTime, status: "上班日" };
                  if (ids.uid) { rosterPlans[ids.uid] = rosterPlans[ids.uid] || {}; rosterPlans[ids.uid][k] = val; }
                  if (ids.id) { rosterPlans[ids.id] = rosterPlans[ids.id] || {}; rosterPlans[ids.id][k] = val; }
                  if (!ids.uid && !ids.id) { rosterPlans[ids.raw] = rosterPlans[ids.raw] || {}; rosterPlans[ids.raw][k] = val; }
                } else {
                  const val = { startTime: data.startTime, endTime: data.endTime, status: "休假日" };
                  if (ids.uid) { rosterPlans[ids.uid] = rosterPlans[ids.uid] || {}; rosterPlans[ids.uid][k] = val; }
                  if (ids.id) { rosterPlans[ids.id] = rosterPlans[ids.id] || {}; rosterPlans[ids.id][k] = val; }
                  if (!ids.uid && !ids.id) { rosterPlans[ids.raw] = rosterPlans[ids.raw] || {}; rosterPlans[ids.raw][k] = val; }
                }
              }
              updateRoster(currentDate);
              // 通知月曆重新渲染，顯示值班徽章
              document.getElementById("rosterCalendar")?.dispatchEvent(new Event("rosterPlansChanged"));
              try { saveRosterPlansToStorage(); } catch {}
              try { renderHomeRosterLabel(); } catch {}
              try { document.querySelectorAll('.modal').forEach((m) => m.remove()); } catch {}
              try { if (modalRoot) { modalRoot.classList.add('hidden'); modalRoot.innerHTML = ''; } } catch {}
              return true;
            },
            afterRender: ({ body }) => {
              // 重置選取狀態，避免第二次開啟殘留
              if (Array.isArray(workSelected)) workSelected.length = 0;
              if (Array.isArray(dutySelected)) dutySelected.length = 0;
              // 上班日期選擇格
              const rowWork = document.createElement("div");
              rowWork.className = "form-row";
              const labelWork = document.createElement("label");
              labelWork.className = "label";
              labelWork.textContent = "上班日期";
              const gridWork = document.createElement("div");
              gridWork.className = "pick-grid";
              rowWork.appendChild(labelWork);
              rowWork.appendChild(gridWork);
              // 值班日期選擇格
              const rowDuty = document.createElement("div");
              rowDuty.className = "form-row";
              const labelDuty = document.createElement("label");
              labelDuty.className = "label";
              labelDuty.textContent = "值班日期";
              const gridDuty = document.createElement("div");
              gridDuty.className = "pick-grid";
              rowDuty.appendChild(labelDuty);
              rowDuty.appendChild(gridDuty);

              // 以週排列（周日至周六）並同步既有班表選擇
              const startPad = new Date(baseYear, baseMonth, 1).getDay();
              const endPad = (startPad + totalDays) % 7 === 0 ? 0 : 7 - ((startPad + totalDays) % 7);
              const officerId2 = officerId;
              const ids2 = resolveOfficerIds(officerId2);
              const monthPlans = rosterPlans[ids2.uid] || rosterPlans[ids2.id] || rosterPlans[ids2.raw] || rosterPlans[ids2.name] || {};

              // 前置空格
              for (let i = 0; i < startPad; i++) {
                const blankW = document.createElement("div"); blankW.className = "pick-day"; blankW.style.visibility = "hidden";
                const blankD = document.createElement("div"); blankD.className = "pick-day"; blankD.style.visibility = "hidden";
                gridWork.appendChild(blankW);
                gridDuty.appendChild(blankD);
              }

              for (let d = 1; d <= totalDays; d++) {
                const date = new Date(baseYear, baseMonth, d);
                const weekday = date.getDay();
                const key = `${baseYear}-${String(baseMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const plan = monthPlans[key];
                // 上班日期按鈕
                const w = document.createElement("div");
                w.className = "pick-day";
                w.textContent = String(d);
                // 先依既有計畫標記
                if (String(plan?.status||'').includes("上班")) {
                  w.classList.add("work-selected");
                  workSelected.push(d);
                } else if (!plan && weekday >= 1 && weekday <= 4) {
                  // 無既有計畫則預設週一至週四為上班日
                  w.classList.add("work-selected");
                  workSelected.push(d);
                }
                w.addEventListener("click", () => {
                  const idx = workSelected.indexOf(d);
                  if (idx >= 0) {
                    workSelected.splice(idx, 1);
                    w.classList.remove("work-selected");
                  } else {
                    workSelected.push(d);
                    w.classList.add("work-selected");
                  }
                });
                gridWork.appendChild(w);
                // 值班日期按鈕
                const u = document.createElement("div");
                u.className = "pick-day";
                u.textContent = String(d);
                if (String(plan?.status||'').includes("值班")) {
                  u.classList.add("duty-selected");
                  dutySelected.push(d);
                }
                u.addEventListener("click", () => {
                  const idx = dutySelected.indexOf(d);
                  if (idx >= 0) {
                    dutySelected.splice(idx, 1);
                    u.classList.remove("duty-selected");
                  } else {
                    dutySelected.push(d);
                    u.classList.add("duty-selected");
                  }
                });
                gridDuty.appendChild(u);
              }

              // 尾端空格補齊整週
              for (let i = 0; i < endPad; i++) {
                const blankW = document.createElement("div"); blankW.className = "pick-day"; blankW.style.visibility = "hidden";
                const blankD = document.createElement("div"); blankD.className = "pick-day"; blankD.style.visibility = "hidden";
                gridWork.appendChild(blankW);
                gridDuty.appendChild(blankD);
              }

              body.appendChild(rowWork);
              body.appendChild(rowDuty);
            }
          });
        });
      }
      // 下方原本的幹部選單填充邏輯已上移，避免重複宣告

      // 月曆渲染（沿用現有邏輯）
      const calendarRoot = document.getElementById("rosterCalendar");
      if (calendarRoot) {
        let viewDate = new Date(dt.getFullYear(), dt.getMonth(), 1);
        let selectedDay = currentDate.getDate();
        const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
        function monthLabel(date) { return `${date.getFullYear()}年${String(date.getMonth()+1).padStart(2, "0")}月`; }
        function daysInMonth(date) { const y = date.getFullYear(); const m = date.getMonth(); return new Date(y, m + 1, 0).getDate(); }
        function firstWeekday(date) { return new Date(date.getFullYear(), date.getMonth(), 1).getDay(); }
        function renderMonth(date) {
          const totalDays = daysInMonth(date);
          const startPad = firstWeekday(date);
          const cells = [];
          for (let i = 0; i < startPad; i++) cells.push("");
          for (let d = 1; d <= totalDays; d++) cells.push(String(d));
          while (cells.length % 7 !== 0) cells.push("");
          const rows = [];
          for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
          const today = nowInTZ('Asia/Taipei');
          const isSameMonth = today.getFullYear() === date.getFullYear() && today.getMonth() === date.getMonth();
          const officerId = sel?.value || "";
          const y = date.getFullYear();
          const m = date.getMonth();
          async function ensureMonthlyCheckinsFor(uid, y, m) {
            try {
              await ensureFirebase();
              const start = new Date(y, m, 1);
              const end = new Date(y, m + 1, 1);
              appState.rosterMonthCheckins = appState.rosterMonthCheckins || {};
              const key = `${y}-${m+1}`;
              const exists = appState.rosterMonthCheckins[uid] && appState.rosterMonthCheckins[uid][key];
              if (exists) return false;
              const ref = fns.collection(db, 'checkins');
              const q = fns.query(ref, fns.where('uid','==', uid));
              const snap = await withRetry(() => fns.getDocs(q));
              const dayMap = {};
              snap.forEach((doc) => {
                const data = doc.data() || {};
                let created = data.createdAt;
                let dt = null;
                if (created && typeof created.toDate === 'function') dt = created.toDate(); else if (typeof created === 'string') dt = new Date(created);
                if (!(dt instanceof Date) || isNaN(dt)) return;
                if (dt.getFullYear() !== y || dt.getMonth() !== m) return;
                const dkey = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
                const baseStatus = String(data.status||'').split('-')[0];
                const rec = dayMap[dkey] || { hasStart: false, hasEnd: false };
                if (baseStatus === '上班') rec.hasStart = true; else if (baseStatus === '下班') rec.hasEnd = true;
                dayMap[dkey] = rec;
              });
              appState.rosterMonthCheckins[uid] = appState.rosterMonthCheckins[uid] || {};
              appState.rosterMonthCheckins[uid][key] = dayMap;
              return true;
            } catch { return false; }
          }
          function getDayClasses(dayStr) {
            if (!dayStr) return { cellCls: "", btnCls: "" };
            const ids = resolveOfficerIds(officerId);
            const bucket = getRosterBucketByIds(ids);
            const plan = getRosterPlan(bucket, y, m, Number(dayStr));
            const k = `${y}-${String(m+1).padStart(2,'0')}-${String(dayStr).padStart(2,'0')}`;
            const wd = new Date(y,m,Number(dayStr)).getDay();
            let base = plan?.status || defaultRosterStatusForDate(new Date(y, m, Number(dayStr)));
            const norm = (s) => {
              const v = String(s||'');
              if (v.includes('值班')) return '值班日';
              if (v.includes('休假')) return '休假日';
              return '上班日';
            };
            base = norm(base);
            const baseCls = base === '值班日' ? 'status-duty' : (base === '休假日' ? 'status-off' : 'status-work');
            const key = `${y}-${m+1}`;
            const map = appState.rosterMonthCheckins?.[officerId]?.[key] || {};
            const rec = map[k] || null;
            const doneCls = rec ? ((rec.hasStart && rec.hasEnd) ? 'done' : 'undone') : '';
            const btnCls = ['roster-cal-day', baseCls, doneCls].filter(Boolean).join(' ');
            return { btnCls };
          }
          try {
            if (officerId) {
              const ids = resolveOfficerIds(officerId);
              const uid = ids.uid || officerId;
              ensureMonthlyCheckinsFor(uid, y, m).then((loaded) => { if (loaded) { try { renderMonth(date); } catch {} } });
            }
          } catch {}
          const headerHtml = `
            <div class="roster-cal-header" role="group" aria-label="月曆導航">
              <button id="rosterPrevMonth" class="btn" aria-label="上一月">◀</button>
              <div class="roster-cal-title" aria-live="polite">${monthLabel(date)}</div>
              <button id="rosterNextMonth" class="btn" aria-label="下一月">▶</button>
            </div>`;
          const tableHeader = `
            <table class="roster-cal-table" aria-label="${monthLabel(date)}">
              <thead><tr>${weekdayLabels.map((w) => `<th scope="col">${w}</th>`).join("")}</tr></thead>
              <tbody>
                ${rows.map((r) => `<tr>${r.map((c) => {
                  const isToday = isSameMonth && String(today.getDate()) === c;
                  const cellCls = ["roster-cal-cell", c ? "" : "empty", isToday ? "today" : ""].filter(Boolean).join(" ");
                  if (!c) return `<td class="${cellCls}"></td>`;
                  const { btnCls } = getDayClasses(c);
                  const k = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(c).padStart(2,'0')}`;
                  // 不顯示值班小標籤，僅以底色區分
                  return `<td class="${cellCls}"><button type="button" class="${btnCls}" data-day="${c}">${c}</button></td>`;
                }).join("")}</tr>`).join("")}
              </tbody>
            </table>`;
          calendarRoot.innerHTML = headerHtml + tableHeader;
          const prevBtn = document.getElementById("rosterPrevMonth");
          const nextBtn = document.getElementById("rosterNextMonth");
          prevBtn?.addEventListener("click", () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); renderMonth(viewDate); });
          nextBtn?.addEventListener("click", () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); renderMonth(viewDate); });
          // 接收班表變更事件，重新渲染徽章
          calendarRoot.addEventListener("rosterPlansChanged", () => renderMonth(viewDate));
          // 初次渲染後套用選取框（若同月）
          if (currentDate.getFullYear() === viewDate.getFullYear() && currentDate.getMonth() === viewDate.getMonth()) {
            const btnSel = calendarRoot.querySelector(`.roster-cal-day[data-day="${String(selectedDay)}"]`);
            if (btnSel) btnSel.closest("td")?.classList.add("selected");
          }
          // 日期按鈕事件：更新日期與列表與選取效果
          calendarRoot.addEventListener("click", (e) => {
            const btn = e.target.closest(".roster-cal-day");
            if (!btn) return;
            const day = btn.dataset.day;
            if (!day) return;
            // 更新選取框
            calendarRoot.querySelectorAll(".roster-cal-cell.selected").forEach((cell) => cell.classList.remove("selected"));
            btn.closest("td")?.classList.add("selected");
            selectedDay = parseInt(day, 10);
            currentDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), selectedDay);
            updateRoster(currentDate);
          });
        }
        renderMonth(viewDate);
      }
    }
  }

  // 幹部分頁內容渲染（子分頁）
  function renderLeaderContent(label) {
    const container = document.getElementById("leaderContent");
    if (!container) return;
    container.innerHTML = "";
    try {
      const sel = document.getElementById('leaderCompanySelect');
      if (!appState.leaderCompanyFilter && sel && sel.value) appState.leaderCompanyFilter = sel.value;
    } catch {}
    if (label === "紀錄") {
      (async () => {
        try {
          await ensureFirebase();
          const coId = appState.leaderCompanyFilter || null;
          const accounts = Array.isArray(appState.accounts) ? appState.accounts : [];
          if (!coId) { container.textContent = "請先選擇公司"; return; }
          const companies = Array.isArray(appState.companies) ? appState.companies : [];
          const coObj = companies.find((c) => String(c.id||'') === String(coId) || String(c.name||'') === String(coId)) || null;
          const coName = coObj?.name || null;
          const targets = accounts.filter((a) => {
            const ids0 = Array.isArray(a.companyIds) ? a.companyIds : (a.companyId ? [a.companyId] : []);
            const ids = ids0.map((x) => String(x||'').trim());
            const idOk = coId ? ids.includes(String(coId)) : false;
            const nameOk = coName ? ids.includes(String(coName)) : false;
            const allowedRoles = ["高階主管","主管","初階主管","行政"];
            const roleOk = allowedRoles.includes(String(a.role||""));
            return roleOk && (idOk || nameOk);
          });
          if (!targets.length) {
            // 仍渲染空界面，避免誤導
            const tzNow = nowInTZ('Asia/Taipei');
            const todayYmd = `${tzNow.getFullYear()}-${String(tzNow.getMonth()+1).padStart(2,'0')}-${String(tzNow.getDate()).padStart(2,'0')}`;
            container.innerHTML = `
              <div class="block" id="leader-block-records">
                <div class="block-header"><span class="block-title">${coName || ''}打卡列表</span></div>
                <div class="block-actions"><label for="leaderRecordDate"></label> <input id="leaderRecordDate" type="date" class="input" /></div>
                <div class="table-wrapper"><div id="leaderRecordList">該公司無打卡紀錄</div></div>
              </div>
            `;
            const dateInput = container.querySelector('#leaderRecordDate');
            if (dateInput) dateInput.value = todayYmd;
            return;
          }
          const nameByUid = new Map();
          targets.forEach((a) => {
            const nm = a.name || a.email || "使用者";
            const id1 = String(a.id||''); if (id1) nameByUid.set(id1, nm);
            const id2 = String(a.uid||''); if (id2) nameByUid.set(id2, nm);
          });
          const nameByUid2 = new Map();
          targets.forEach((a) => {
            const nm = a.name || a.email || '使用者';
            const id1 = String(a.id||''); if (id1) nameByUid2.set(id1, nm);
            const id2 = String(a.uid||''); if (id2) nameByUid2.set(id2, nm);
          });
          const uids = targets.map((a) => a.uid || a.id).filter(Boolean).map(String);
          const ref = fns.collection(db, "checkins");
          const chunks = []; for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));
          const list = [];
          for (const ch of chunks) {
            const q = fns.query(ref, fns.where("uid", "in", ch));
            const snap = await withRetry(() => fns.getDocs(q));
            snap.forEach((doc) => {
              const data = doc.data() || {};
              let created = data.createdAt;
              let dt = null;
              if (created && typeof created.toDate === 'function') dt = created.toDate(); else if (typeof created === 'string') dt = new Date(created);
              if (!(dt instanceof Date) || isNaN(dt)) return;
              const nm = nameByUid.get(String(data.uid || '')) || data.name || '使用者';
              list.push({ id: doc.id, ...data, dt, name: nm });
            });
          }
          const tzNow = nowInTZ('Asia/Taipei');
          const todayYmd = `${tzNow.getFullYear()}-${String(tzNow.getMonth()+1).padStart(2,'0')}-${String(tzNow.getDate()).padStart(2,'0')}`;
          container.innerHTML = `
            <div class="block" id="leader-block-records">
              <div class="block-header"><span class="block-title">${coName || ''}打卡列表</span></div>
              <div class="block-actions"><label for="leaderRecordDate"></label> <select id="leaderRecordNameFilter" class="input"></select> <input id="leaderRecordDate" type="date" class="input" /></div>
              <div class="table-wrapper"><div id="leaderRecordList"></div></div>
            </div>
          `;
          const dateInput = container.querySelector('#leaderRecordDate');
          const listRoot = container.querySelector('#leaderRecordList');
          const nameFilter = container.querySelector('#leaderRecordNameFilter');
          if (!listRoot || !dateInput) return;
          dateInput.value = todayYmd;
          const nameOptions = [{ value: '', label: '全部' }].concat(targets.map((a) => ({ value: String(a.uid || a.id || ''), label: a.name || a.email || '使用者' })));
          if (nameFilter) { nameFilter.innerHTML = nameOptions.map((o) => `<option value="${o.value}">${o.label}</option>`).join(''); }
          async function renderForDate(ymdStr) {
            const sel = String(ymdStr || '').trim();
            if (!sel) return;
            const selUid = String(nameFilter?.value || '').trim();
            const dayList = list.filter((r) => formatYmdTZ(r.dt, 'Asia/Taipei') === sel && (!selUid || String(r.uid||'') === selUid)).sort((a, b) => b.dt - a.dt).slice(0, 100);
            listRoot.innerHTML = '';
            if (!dayList.length) { listRoot.textContent = '該日無打卡紀錄'; return; }
            const changeById = new Map();
            try {
              await ensureFirebase();
              if (db && fns.collection && fns.where && fns.getDocs) {
                const ids = dayList.map((r) => r.id);
                const chunks = []; for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
                for (const ch of chunks) {
                  const q = fns.query(fns.collection(db, 'changeRequests'), fns.where('checkinId', 'in', ch));
                  const snap = await withRetry(() => fns.getDocs(q));
                  snap.forEach((doc) => {
                    const data = doc.data() || {};
                    const cid = String(data.checkinId || '');
                    const created = data.createdAt;
                    let dt2 = typeof created === 'string' ? new Date(created) : (created && typeof created.toDate === 'function' ? created.toDate() : new Date());
                    const prev = changeById.get(cid);
                    if (!prev || (dt2 instanceof Date && prev?.dt && dt2 > prev.dt)) changeById.set(cid, { id: doc.id, ...data, dt: dt2 });
                  });
                }
              }
            } catch {}
            dayList.forEach((r) => {
              const card = document.createElement('div');
              card.className = 'record-card';
              card.style.display = 'grid';
              card.style.gridTemplateColumns = '1fr';
              card.style.gap = '8px';
              const status = document.createElement('div');
              const stRaw = r.status || '';
              const baseSt = String(stRaw).split('-')[0];
              const stCls = (() => {
                switch (baseSt) {
                  case '上班': return 'work';
                  case '下班': return 'off';
                  case '外出': return 'out';
                  case '抵達': return 'arrive';
                  case '離開': return 'leave';
                  case '返回': return 'return';
                  default: return '';
                }
              })();
              const place = r.locationName || '未知地點';
              const flagHtml = (() => {
                const st = String(r.status||'');
                const baseSt = st.split('-')[0];
                const i = st.indexOf('-');
                const reason = i >= 0 ? st.slice(i+1) : '';
                if ((baseSt === '外出' || baseSt === '抵達' || baseSt === '離開') && reason) {
                  const rules = Array.isArray(appState.pointsRules) ? appState.pointsRules : [];
                  const match = rules.find((x) => String(x.reason||'') === String(reason));
                  const abnormal = match && String(match.status||'') === '異常';
                  return abnormal ? ` <span class="status-flag bad">異常-${reason}</span>` : ' <span class="status-flag good">正常</span>';
                }
                return r.inRadius === true ? ' <span class="status-flag good">正常</span>' : ' <span class="status-flag bad">異常</span>';
              })();
              const stDisplay = (() => {
                const reason = r.reason || '';
                if ((baseSt === '外出' || baseSt === '抵達' || baseSt === '離開') && reason) return `${baseSt}-${reason}`;
                return stRaw || baseSt;
              })();
              const nameText = r.name || '使用者';
              status.innerHTML = `${nameText} 打卡地點：<span class="status-label ${stCls}">${place}</span> 狀態：<span class="status-label ${stCls}">${stDisplay}</span>${flagHtml}`;
              const dtStr = formatDateTimeTZ(r.dt, 'Asia/Taipei');
              const when = document.createElement('div');
              when.textContent = `時間：${dtStr}`;

              const actions = document.createElement('div');
              actions.className = 'record-actions';

              const mapBtn = document.createElement('button');
              mapBtn.className = 'btn btn-blue';
              mapBtn.type = 'button';
              mapBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right:6px;"><path d="M12 2c-3.866 0-7 3.134-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.866-3.134-7-7-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="9" r="2" stroke="currentColor" stroke-width="2"/></svg>地圖`;
              mapBtn.style.borderRadius = '0'; mapBtn.style.padding = '4px 8px'; mapBtn.style.minHeight = '30px';
              attachPressInteractions(mapBtn);
              mapBtn.disabled = !(typeof r.lat === 'number' && typeof r.lng === 'number');
              mapBtn.title = mapBtn.disabled ? '座標未知' : '';
              mapBtn.addEventListener('click', () => {
                if (mapBtn.disabled) return;
                const lat = Number(r.lat).toFixed(6);
                const lon = Number(r.lng).toFixed(6);
                openModal({ title: '定位地圖', fields: [], submitText: '關閉', refreshOnSubmit: false, onSubmit: async () => true, afterRender: async ({ body }) => { try { const maps = await ensureGoogleMaps(); const box = document.createElement('div'); box.style.width = '100%'; box.style.height = '65vh'; box.style.borderRadius = '8px'; body.appendChild(box); const center = { lat: parseFloat(lat), lng: parseFloat(lon) }; const map = new maps.Map(box, { center, zoom: 18, gestureHandling: 'greedy' }); new maps.Marker({ position: center, map, draggable: false, title: '目前位置' }); const txt = document.createElement('div'); txt.textContent = `座標：${lat}, ${lon}`; txt.className = 'muted'; txt.style.marginTop = '8px'; body.appendChild(txt); } catch { const txt = document.createElement('div'); txt.textContent = `座標：${lat}, ${lon}`; txt.className = 'muted'; txt.style.marginTop = '8px'; body.appendChild(txt); } } });
              });

              const photoBtn = document.createElement('button');
              photoBtn.className = 'btn btn-green';
              photoBtn.type = 'button';
              photoBtn.innerHTML = `<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" style=\"margin-right:6px;\"><rect x=\"4\" y=\"7\" width=\"16\" height=\"12\" rx=\"2\" stroke=\"currentColor\" stroke-width=\"2\" /><path d=\"M9 7l1.5-2h3L15 7\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" /><circle cx=\"12\" cy=\"13\" r=\"3.5\" stroke=\"currentColor\" stroke-width=\"2\" /></svg>照片`;
              photoBtn.style.borderRadius = '0'; photoBtn.style.padding = '4px 8px'; photoBtn.style.minHeight = '30px';
              attachPressInteractions(photoBtn);
              photoBtn.disabled = !r.photoData;
              photoBtn.title = photoBtn.disabled ? '無照片' : '';
              photoBtn.addEventListener('click', () => {
                if (photoBtn.disabled) return;
                openModal({ title: '打卡照片', fields: [], submitText: '關閉', refreshOnSubmit: false, onSubmit: async () => true, afterRender: ({ body }) => { const img = document.createElement('img'); img.src = r.photoData; img.alt = '打卡照片'; img.style.width = '100%'; img.style.height = 'auto'; img.style.borderRadius = '8px'; body.appendChild(img); } });
              });

              const isAdmin = hasFullAccessToTab('leader');
              const curUid = auth?.currentUser?.uid || '';
              const isSelf = curUid && String(r.uid||'') === String(curUid);

              const editBtn = document.createElement('button');
              editBtn.className = 'btn btn-blue'; editBtn.type = 'button'; editBtn.textContent = '編輯';
              editBtn.style.borderRadius = '0'; editBtn.style.padding = '4px 8px'; editBtn.style.minHeight = '30px'; attachPressInteractions(editBtn);
              editBtn.disabled = !isAdmin && !isSelf;
              editBtn.addEventListener('click', () => {
                if (editBtn.disabled) return;
                const statusOptions = [ { value: '上班', label: '上班' }, { value: '下班', label: '下班' }, { value: '外出', label: '外出' }, { value: '抵達', label: '抵達' }, { value: '離開', label: '離開' }, { value: '返回', label: '返回' } ];
                const accountsAll = Array.isArray(appState.accounts) ? appState.accounts : [];
                const account = accountsAll.find((a) => String(a.uid||a.id||'') === String(r.uid||'')) || null;
                const allowedCommunityIds = (account && Array.isArray(account.serviceCommunities)) ? new Set(account.serviceCommunities) : null;
                let communities = [];
                if (allowedCommunityIds && allowedCommunityIds.size > 0) {
                  communities = (Array.isArray(appState.communities) ? appState.communities : []).filter((c) => allowedCommunityIds.has(c.id));
                } else if (account && Array.isArray(account.companyIds) && account.companyIds.length > 0) {
                  const coSet = new Set(account.companyIds);
                  communities = (Array.isArray(appState.communities) ? appState.communities : []).filter((c) => coSet.has(c.companyId));
                } else if (account?.companyId) {
                  communities = (Array.isArray(appState.communities) ? appState.communities : []).filter((c) => c.companyId === account.companyId);
                } else {
                  communities = (Array.isArray(appState.communities) ? appState.communities : []).slice();
                }
                communities = communities.slice().sort((a,b)=>{
                  const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
                  const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
                  if (ao !== bo) return ao - bo;
                  return String(a.name||'').localeCompare(String(b.name||''), 'zh-Hant');
                });
                const commOptions = communities.map((c) => ({ value: c.id, label: c.name }));
                const reasonOptions = [
                  { value: '督察', label: '督察' },
                  { value: '例會', label: '例會' },
                  { value: '區大', label: '區大' },
                  { value: '臨時會', label: '臨時會' },
                  { value: '簡報', label: '簡報' },
                  { value: '其他', label: '其他(自定義)' },
                ];
                const initDT = formatDatetimeLocalTZ(r.dt, 'Asia/Taipei');
                openModal({
                  title: '編輯打卡紀錄',
                  fields: [
                    { key: 'status', label: '狀態', type: 'select', options: statusOptions },
                    { key: 'datetime', label: '日期時間', type: 'datetime-local', step: 60 },
                    { key: 'locationName', label: '打卡位置', type: 'text' },
                    { key: 'placeMode', label: '地點來源', type: 'select', options: [ { value: 'list', label: '服務社區清單' }, { value: 'custom', label: '自填地點' } ] },
                    { key: 'placeSelect', label: '打卡位置', type: 'select', options: commOptions },
                    { key: 'placeInput', label: '打卡位置', type: 'text', placeholder: '請輸入地點名稱' },
                    { key: 'reason', label: '事由', type: 'select', options: reasonOptions },
                    { key: 'reasonOther', label: '自定義事由', type: 'text' },
                  ],
                  initial: { status: (r.status || '上班').split('-')[0], datetime: initDT, locationName: r.locationName || '', placeMode: 'list', placeSelect: '', placeInput: '', reason: r.reason || '', reasonOther: '' },
                  submitText: '儲存',
                  refreshOnSubmit: false,
                  onSubmit: async (data) => {
                    try {
                      await ensureFirebase();
                      let loc = String(data.locationName||'').trim();
                      const stat = String(data.status||'');
                      if (stat === '外出' || stat === '抵達' || stat === '離開') {
                        const mode = String(data.placeMode||'list');
                        if (mode === 'custom') {
                          loc = String(data.placeInput||'').trim();
                          if (!loc) { alert('請輸入地點名稱'); return false; }
                        } else {
                          const id = String(data.placeSelect||'');
                          const item = (Array.isArray(appState.communities)?appState.communities:[]).find((c)=>String(c.id||'')===id) || null;
                          if (!item) { alert('請選擇打卡位置'); return false; }
                          loc = item.name || '';
                        }
                      }
                      const dtRaw = String(data.datetime||'');
                      const payload = { locationName: loc, status: stat };
                      if (stat === '外出' || stat === '抵達' || stat === '離開') {
                        const rs = String(data.reason||'');
                        payload.reason = (rs === '其他') ? String(data.reasonOther||'') : rs;
                      }
                      if (dtRaw) payload.createdAt = dtRaw;
                      if (db && fns.updateDoc && fns.doc) {
                        await withRetry(() => fns.updateDoc(fns.doc(db, 'checkins', r.id), payload));
                      }
                      try {
                        r.locationName = payload.locationName;
                        r.status = payload.status;
                        if ('reason' in payload) r.reason = payload.reason;
                        if (payload.createdAt) { const nd = new Date(payload.createdAt); if (nd instanceof Date && !isNaN(nd)) r.dt = nd; }
                      } catch {}
                      renderForDate(sel);
                      return true;
                    } catch (e) { alert(`更新失敗：${e?.message || e}`); return false; }
                  },
                  afterRender: ({ body }) => {
                    const st = body.querySelector('[data-key="status"]');
                    const locInput = body.querySelector('[data-key="locationName"]');
                    const locRow = locInput?.closest('.form-row');
                    const modeSel = body.querySelector('[data-key="placeMode"]');
                    const selRow = body.querySelector('[data-key="placeSelect"]')?.closest('.form-row');
                    const inputRow = body.querySelector('[data-key="placeInput"]')?.closest('.form-row');
                    const reasonSel = body.querySelector('[data-key="reason"]');
                    const reasonOtherRow = body.querySelector('[data-key="reasonOther"]')?.closest('.form-row');
                    const toggleMode = () => { const v = modeSel?.value || 'list'; if (selRow) selRow.style.display = (v === 'list') ? '' : 'none'; if (inputRow) inputRow.style.display = (v === 'custom') ? '' : 'none'; };
                    const toggleReason = () => { const v = reasonSel?.value || ''; if (reasonOtherRow) reasonOtherRow.style.display = (v === '其他') ? '' : 'none'; };
                    const toggleStatus = () => {
                      const v = String(st?.value||'');
                      const show = (v === '外出' || v === '抵達' || v === '離開');
                      if (locRow) locRow.style.display = show ? 'none' : '';
                      if (modeSel) modeSel.closest('.form-row').style.display = show ? '' : 'none';
                      if (selRow) selRow.style.display = show && (modeSel?.value === 'list') ? '' : 'none';
                      if (inputRow) inputRow.style.display = show && (modeSel?.value === 'custom') ? '' : 'none';
                      if (reasonSel) reasonSel.closest('.form-row').style.display = show ? '' : 'none';
                      if (reasonOtherRow) reasonOtherRow.style.display = show && (reasonSel?.value === '其他') ? '' : 'none';
                    };
                    toggleMode(); toggleReason(); toggleStatus();
                    modeSel?.addEventListener('change', () => { toggleMode(); toggleStatus(); });
                    reasonSel?.addEventListener('change', () => { toggleReason(); toggleStatus(); });
                    st?.addEventListener('change', toggleStatus);
                  }
                });
              });

              const deleteBtn = document.createElement('button');
              deleteBtn.className = 'btn btn-red'; deleteBtn.type = 'button'; deleteBtn.textContent = '刪除';
              deleteBtn.style.borderRadius = '0'; deleteBtn.style.padding = '4px 8px'; deleteBtn.style.minHeight = '30px'; attachPressInteractions(deleteBtn);
              const canDelete = isAdmin || isSelf;
              deleteBtn.disabled = !canDelete;
              deleteBtn.addEventListener('click', async () => {
                if (deleteBtn.disabled) return;
                const ok = await confirmAction({ title: '確認刪除', text: '確定要刪除此打卡紀錄嗎？', confirmText: '刪除' });
                if (!ok) return;
                try { await ensureFirebase(); if (db && fns.deleteDoc && fns.doc) { await withRetry(() => fns.deleteDoc(fns.doc(db, 'checkins', r.id))); } try { const idx = list.findIndex((x) => x.id === r.id); if (idx >= 0) list.splice(idx, 1); } catch {} renderForDate(sel); } catch (e) { alert(`刪除失敗：${e?.message || e}`); }
              });

              const change = changeById.get(r.id) || null;
              if (change) {
                const st2 = String(change.state || '');
                if (st2 === '送審') {
                  card.classList.add('pending-change');
                  const approveBtn = document.createElement('button');
                  approveBtn.className = 'btn btn-green'; approveBtn.type = 'button'; approveBtn.textContent = '核准'; attachPressInteractions(approveBtn);
                  approveBtn.disabled = !isAdmin;
                  const rejectBtn = document.createElement('button');
                  rejectBtn.className = 'btn btn-darkred'; rejectBtn.type = 'button'; rejectBtn.textContent = '拒絕'; attachPressInteractions(rejectBtn);
                  rejectBtn.disabled = !isAdmin;
                  approveBtn.addEventListener('click', async () => {
                    if (approveBtn.disabled) return;
                    try {
                      await ensureFirebase();
                      const req = change.requested || {};
                      const payload = {};
                      if ('place' in req) payload.locationName = String(req.place||'');
                      if ('status' in req) payload.status = String(req.status||'');
                      if ('datetime' in req) payload.createdAt = String(req.datetime||'');
                      if (db && fns.updateDoc && fns.doc) {
                        await withRetry(() => fns.updateDoc(fns.doc(db, 'checkins', r.id), payload));
                      }
                      if (db && fns.setDoc && fns.doc) {
                        await withRetry(() => fns.setDoc(fns.doc(db, 'changeRequests', change.id), { state: '核准', updatedAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString() }, { merge: true }));
                      }
                      try {
                        if ('locationName' in payload) r.locationName = payload.locationName;
                        if ('status' in payload) r.status = payload.status;
                        if ('createdAt' in payload) { const nd = new Date(payload.createdAt); if (nd instanceof Date && !isNaN(nd)) r.dt = nd; }
                      } catch {}
                      renderForDate(sel);
                    } catch (e) { alert(`核准失敗：${e?.message || e}`); }
                  });
                  rejectBtn.addEventListener('click', async () => {
                    if (rejectBtn.disabled) return;
                    try {
                      await ensureFirebase();
                      if (db && fns.setDoc && fns.doc) {
                        await withRetry(() => fns.setDoc(fns.doc(db, 'changeRequests', change.id), { state: '拒絕', updatedAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString() }, { merge: true }));
                      }
                      renderForDate(sel);
                    } catch (e) { alert(`拒絕失敗：${e?.message || e}`); }
                  });
                  actions.appendChild(approveBtn);
                  actions.appendChild(rejectBtn);
                } else {
                  card.classList.add('changed-soft');
                }
              }

              actions.appendChild(mapBtn);
              actions.appendChild(photoBtn);
              actions.appendChild(editBtn);
              actions.appendChild(deleteBtn);

              card.appendChild(status);
              card.appendChild(when);
              card.appendChild(actions);
            listRoot.appendChild(card);
          });
          }
          renderForDate(todayYmd);
          dateInput.addEventListener('change', () => renderForDate(dateInput.value));
          nameFilter?.addEventListener('change', () => renderForDate(dateInput.value));
        } catch (e) {
          const msg = e?.message || e;
          container.textContent = typeof msg === 'string' ? `載入失敗：${msg}` : "載入失敗";
        }
      })();
      return;
    }
    if (label === "請假") {
      (async () => {
        try {
          await ensureFirebase();
          const coId = appState.leaderCompanyFilter || null;
          const accounts = Array.isArray(appState.accounts) ? appState.accounts : [];
          if (!coId) { container.textContent = "請先選擇公司"; return; }
          const companies = Array.isArray(appState.companies) ? appState.companies : [];
          const coObj = companies.find((c) => String(c.id||'') === String(coId) || String(c.name||'') === String(coId)) || null;
          const coName = coObj?.name || null;
          const targets = accounts.filter((a) => {
            const ids0 = Array.isArray(a.companyIds) ? a.companyIds : (a.companyId ? [a.companyId] : []);
            const ids = ids0.map((x) => String(x||'').trim());
            const idOk = coId ? ids.includes(String(coId)) : false;
            const nameOk = coName ? ids.includes(String(coName)) : false;
            const allowedRoles = ["高階主管","主管","初階主管","行政"];
            const roleOk = allowedRoles.includes(String(a.role||""));
            return roleOk && (idOk || nameOk);
          });
          if (!targets.length) {
            const tzNow = nowInTZ('Asia/Taipei');
            const y = tzNow.getFullYear();
            const m = tzNow.getMonth() + 1;
            const todayYm = `${y}-${String(m).padStart(2,'0')}`;
            container.innerHTML = `
              <div class="block" id="leader-block-leaves">
                <div class="block-header"><span class="block-title">${coName || ''}請假列表</span></div>
                <div class="block-actions"><label for="leaderLeaveMonth"></label> <select id="leaderLeaveNameFilter" class="input"><option value="">全部</option></select> <input id="leaderLeaveMonth" type="month" class="input" /></div>
                <div class="table-wrapper"><div id="leaderLeaveList">該公司無請假項目</div></div>
              </div>
            `;
            const monthInput = container.querySelector('#leaderLeaveMonth');
            if (monthInput) monthInput.value = todayYm;
            return;
          }
          const nameByUid = new Map();
          targets.forEach((a) => {
            const nm = a.name || a.email || "使用者";
            const id1 = String(a.id||''); if (id1) nameByUid.set(id1, nm);
            const id2 = String(a.uid||''); if (id2) nameByUid.set(id2, nm);
          });
          const uids = targets.map((a) => a.uid || a.id).filter(Boolean).map(String);
          const tzNow = nowInTZ('Asia/Taipei');
          const ref = fns.collection(db, "leaveRequests");
          const chunks = []; for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));
          const list = [];
          for (const ch of chunks) {
            const q = fns.query(ref, fns.where("uid", "in", ch));
            const snap = await withRetry(() => fns.getDocs(q));
            snap.forEach((doc) => {
              const data = doc.data() || {};
              let created = data.createdAt;
              let dt = null;
              if (created && typeof created.toDate === 'function') dt = created.toDate(); else if (typeof created === 'string') dt = new Date(created);
              if (!(dt instanceof Date) || isNaN(dt)) dt = new Date();
              const s = data.startAt; const e = data.endAt;
              const sdt = typeof s === 'string' ? new Date(s) : (s && typeof s.toDate === 'function' ? s.toDate() : null);
              const edt = typeof e === 'string' ? new Date(e) : (e && typeof e.toDate === 'function' ? e.toDate() : null);
              const nm = nameByUid.get(String(data.uid || '')) || data.name || '使用者';
              list.push({ id: doc.id, ...data, dt, sdt, edt, name: nm });
            });
          }
          const sigSet = new Set(list.map((x) => `${String(x.uid||'')}|${x.sdt?x.sdt.toISOString():''}|${x.edt?x.edt.toISOString():''}|${String(x.type||'')}|${String(x.reason||'')}`));
          try {
            const raw = localStorage.getItem('pendingLeaves');
            const arr = raw ? JSON.parse(raw) : [];
            const uidSet = new Set(uids.map(String));
            (Array.isArray(arr) ? arr : []).forEach((data) => {
              try {
                const uid = String(data.uid||'');
                if (!uid || !uidSet.has(uid)) return;
                const created = data.createdAt;
                const dt = typeof created === 'string' ? new Date(created) : (created && typeof created.toDate === 'function' ? created.toDate() : new Date());
                const s = data.startAt; const e = data.endAt;
                const sdt = typeof s === 'string' ? new Date(s) : (s && typeof s.toDate === 'function' ? s.toDate() : null);
                const edt = typeof e === 'string' ? new Date(e) : (e && typeof e.toDate === 'function' ? e.toDate() : null);
                const nm = nameByUid.get(uid) || data.name || '使用者';
                const key = `${uid}|${sdt?sdt.toISOString():''}|${edt?edt.toISOString():''}|${String(data.type||'')}|${String(data.reason||'')}`;
                if (sigSet.has(key)) return;
                list.push({ id: `local-${Math.random().toString(36).slice(2)}`, ...data, dt, sdt, edt, name: nm });
                sigSet.add(key);
              } catch {}
            });
          } catch {}
          const y = tzNow.getFullYear();
          const m = tzNow.getMonth() + 1;
          const todayYm = `${y}-${String(m).padStart(2,'0')}`;
          container.innerHTML = `
            <div class="block" id="leader-block-leaves">
              <div class="block-header"><span class="block-title">${coName || ''}請假列表</span></div>
              <div class="block-actions"><label for="leaderLeaveMonth"></label> <select id="leaderLeaveNameFilter" class="input"></select> <input id="leaderLeaveMonth" type="month" class="input" /></div>
              <div class="table-wrapper"><div id="leaderLeaveList"></div></div>
            </div>
          `;
          const nameFilter = container.querySelector('#leaderLeaveNameFilter');
          const nameOptions = [{ value: '', label: '全部' }].concat(targets.map((a) => ({ value: String(a.uid || a.id || ''), label: a.name || a.email || '使用者' })));
          if (nameFilter) { nameFilter.innerHTML = nameOptions.map((o) => `<option value="${o.value}">${o.label}</option>`).join(''); }
          const monthInput = container.querySelector('#leaderLeaveMonth');
          const listRoot = container.querySelector('#leaderLeaveList');
          if (!monthInput || !listRoot) return;
          monthInput.value = todayYm;
          const formatDT = (d) => formatDateTimeTZ(d, 'Asia/Taipei');
          function renderForMonth(ymStr) {
            const selYm = String(ymStr || '').trim();
            const selUid = String(nameFilter?.value || '').trim();
            const monthList = list.filter((r) => {
              const base = r.sdt instanceof Date && !isNaN(r.sdt) ? r.sdt : r.dt;
              const inMonth = formatYmTZ(base, 'Asia/Taipei') === selYm;
              const byName = !selUid || String(r.uid||'') === selUid;
              return inMonth && byName;
            }).sort((a, b) => b.dt - a.dt);
            listRoot.innerHTML = '';
            if (!monthList.length) { listRoot.textContent = '該月無請假項目'; return; }
            monthList.forEach((r) => {
              const card = document.createElement('div');
              card.className = 'record-card';
              card.style.display = 'grid';
              card.style.gridTemplateColumns = '1fr';
              card.style.gap = '8px';
              card.setAttribute('data-id', r.id);
              const status = document.createElement('div');
              const nameText = r.name || '使用者';
              const typeText = r.type || '請假';
              const sStr = r.sdt instanceof Date && !isNaN(r.sdt) ? formatDT(r.sdt) : '未設定';
              const eStr = r.edt instanceof Date && !isNaN(r.edt) ? formatDT(r.edt) : '未設定';
              const reason = r.reason || '';
              const st = r.status || '送審';
              status.innerHTML = `${nameText} 類型：<span class="status-label work">${typeText}</span> 時段：<span class="status-label arrive">${sStr}</span> → <span class="status-label leave">${eStr}</span> 原因：<span class="status-label return">${reason || '無'}</span> 狀態：<span class="status-label ${st==='核准'?'work':'out'}">${st}</span>`;
              const when = document.createElement('div');
              const dtStr = formatDateTimeTZ(r.dt, 'Asia/Taipei');
              when.textContent = `建立：${dtStr}`;
              const actions = document.createElement('div');
              actions.className = 'record-actions';
              const isAdmin = hasFullAccessToTab('leader');
              const curUid = auth?.currentUser?.uid || '';
              const isSelf = curUid && String(r.uid||'') === String(curUid);
              const photoBtn = document.createElement('button');
              photoBtn.className = 'btn btn-darkgrey';
              photoBtn.textContent = '照片';
              photoBtn.dataset.act = 'photo';
              photoBtn.dataset.id = r.id;
              photoBtn.disabled = !r.attachmentData;
              const approveBtn = document.createElement('button');
              approveBtn.className = (r.status && r.status !== '送審') ? 'btn btn-grey' : 'btn btn-green';
              approveBtn.textContent = '核准'; approveBtn.dataset.act = 'approve'; approveBtn.dataset.id = r.id;
              approveBtn.disabled = !isAdmin || (r.status && r.status !== '送審');
              const rejectBtn = document.createElement('button');
              rejectBtn.className = (r.status && r.status !== '送審') ? 'btn btn-grey' : 'btn btn-darkred';
              rejectBtn.textContent = '拒絕'; rejectBtn.dataset.act = 'reject'; rejectBtn.dataset.id = r.id;
              rejectBtn.disabled = !isAdmin || (r.status && r.status !== '送審');
              const editBtn = document.createElement('button'); editBtn.className = 'btn btn-blue'; editBtn.textContent = '編輯'; editBtn.dataset.act = 'edit'; editBtn.dataset.id = r.id; editBtn.disabled = !isAdmin;
              const canDelete = isAdmin || (isSelf && st !== '核准');
              const deleteBtn = document.createElement('button'); deleteBtn.className = 'btn btn-red'; deleteBtn.textContent = '刪除'; deleteBtn.dataset.act = 'delete'; deleteBtn.dataset.id = r.id; deleteBtn.disabled = !canDelete;
              actions.appendChild(photoBtn);
              actions.appendChild(approveBtn);
              actions.appendChild(rejectBtn);
              actions.appendChild(editBtn);
              actions.appendChild(deleteBtn);
              card.appendChild(status);
              card.appendChild(when);
              card.appendChild(actions);
              listRoot.appendChild(card);
            });
          }
          renderForMonth(todayYm);
          monthInput.addEventListener('change', () => renderForMonth(monthInput.value));
          nameFilter?.addEventListener('change', () => renderForMonth(monthInput.value));
          listRoot.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const act = btn.dataset.act || '';
            const id = btn.dataset.id || '';
            const rec = list.find((x) => x.id === id);
            if (!rec) return;
            const isAdmin = hasFullAccessToTab('leader');
            try {
              await ensureFirebase();
              if (act === 'photo') {
                if (!rec.attachmentData) { alert('此申請沒有上傳照片'); return; }
                openModal({
                  title: '上傳照片',
                  fields: [],
                  submitText: '',
                  afterRender: ({ body }) => {
                    try {
                      const img = document.createElement('img');
                      img.src = rec.attachmentData;
                      img.alt = '上傳照片';
                      img.style.maxWidth = '100%';
                      img.style.height = 'auto';
                      img.style.borderRadius = '8px';
                      body.appendChild(img);
                    } catch {}
                  },
                  refreshOnSubmit: false,
                });
              } else if (act === 'approve' || act === 'reject') {
                if (!isAdmin) { alert('權限不足：不可變更狀態'); return; }
                const newStatus = act === 'approve' ? '核准' : '拒絕';
                await withRetry(() => fns.setDoc(fns.doc(db, 'leaveRequests', id), { status: newStatus, updatedAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString() }, { merge: true }));
                try { rec.status = newStatus; } catch {}
                renderForMonth(monthInput.value);
              } else if (act === 'edit') {
                if (!isAdmin) { alert('權限不足：不可編輯'); return; }
                openModal({
                  title: '變更狀態',
                  fields: [ { key: 'status', label: '狀態', type: 'select', options: [ { value: '', label: '待核准' }, { value: '核准', label: '核准' }, { value: '拒絕', label: '拒絕' } ] } ],
                  submitText: '確認',
                  onSubmit: async (data) => {
                    try {
                      const raw = String(data.status||'').trim();
                      const nv = raw || '送審';
                      await withRetry(() => fns.setDoc(fns.doc(db, 'leaveRequests', id), { status: nv, updatedAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString() }, { merge: true }));
                      try { rec.status = nv; } catch {}
                      renderForMonth(monthInput.value);
                      return true;
                    } catch (err) { alert(`更新失敗：${err?.message || err}`); return false; }
                  },
                  refreshOnSubmit: false,
                });
              } else if (act === 'delete') {
                const curUid = auth?.currentUser?.uid || '';
                const isSelf = curUid && String(rec.uid||'') === String(curUid);
                const canDelete = isAdmin || (isSelf && rec.status !== '核准');
                if (!canDelete) { alert('不可刪除此申請'); return; }
                const ok = await confirmAction({ title: '確認刪除', text: '確定要刪除此請假申請嗎？', confirmText: '刪除' });
                if (!ok) return;
                if (id.startsWith('local-')) {
                  try {
                    const raw = localStorage.getItem('pendingLeaves');
                    const arr = raw ? JSON.parse(raw) : [];
                    const keyOf = (d) => {
                      try {
                        const uid = String(d.uid||'');
                        const s = d.startAt; const e = d.endAt;
                        const sdt = typeof s === 'string' ? new Date(s) : (s && typeof s.toDate === 'function' ? s.toDate() : null);
                        const edt = typeof e === 'string' ? new Date(e) : (e && typeof e.toDate === 'function' ? e.toDate() : null);
                        const sISO = sdt instanceof Date && !isNaN(sdt) ? sdt.toISOString() : '';
                        const eISO = edt instanceof Date && !isNaN(edt) ? edt.toISOString() : '';
                        const t = String(d.type||''); const r = String(d.reason||'');
                        return `${uid}|${sISO}|${eISO}|${t}|${r}`;
                      } catch { return ''; }
                    };
                    const targetKey = keyOf(rec);
                    const out = (Array.isArray(arr) ? arr : []).filter((d) => keyOf(d) !== targetKey);
                    localStorage.setItem('pendingLeaves', JSON.stringify(out));
                  } catch {}
                } else {
                  await withRetry(() => fns.deleteDoc(fns.doc(db, 'leaveRequests', id)));
                }
                try { const i = list.findIndex((x) => x.id === id); if (i >= 0) list.splice(i, 1); } catch {}
                renderForMonth(monthInput.value);
                try { if (typeof refreshSubtabBadges === 'function') await refreshSubtabBadges(); } catch {}
              }
            } catch (err) { alert(`操作失敗：${err?.message || err}`); }
          });
        } catch (e) {
          const msg = e?.message || e;
          container.textContent = typeof msg === 'string' ? `載入失敗：${msg}` : "載入失敗";
        }
      })();
      return;
    }
    if (label === "計點") {
      (async () => {
        try {
          await ensureFirebase();
          const coId = appState.leaderCompanyFilter || null;
          const accounts = Array.isArray(appState.accounts) ? appState.accounts : [];
          if (!coId) { container.textContent = "請先選擇公司"; return; }
          const companies = Array.isArray(appState.companies) ? appState.companies : [];
          const coObj = companies.find((c) => String(c.id||'') === String(coId) || String(c.name||'') === String(coId)) || null;
          const coName = coObj?.name || null;
          const targets = accounts.filter((a) => {
            const ids0 = Array.isArray(a.companyIds) ? a.companyIds : (a.companyId ? [a.companyId] : []);
            const ids = ids0.map((x) => String(x||'').trim());
            const idOk = coId ? ids.includes(String(coId)) : false;
            const nameOk = coName ? ids.includes(String(coName)) : false;
            const allowedRoles = ["高階主管","主管","初階主管","行政"];
            const roleOk = allowedRoles.includes(String(a.role||""));
            return roleOk && (idOk || nameOk);
          });
          if (!targets.length) {
            const tzNow = nowInTZ('Asia/Taipei');
            const html = `
              <div class="block" id="leader-block-appeals">
                <div class="block-header"><span class="block-title">${coName || ''}申訴列表</span></div>
                <div class="block-actions"><select id="leaderPointsNameFilter" class="input"><option value="">全部</option></select><input id="leaderPointsDateFilter" type="month" class="input" /></div>
                <div class="table-wrapper">
                  <table class="table" aria-label="申訴列表">
                    <thead>
                      <tr>
                        <th>姓名</th>
                        <th>日期</th>
                        <th>事由</th>
                        <th>狀態</th>
                        <th>計點</th>
                        <th>申訴說明</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody id="leaderAppealsTbody"><tr><td colspan="7">該公司無申訴紀錄</td></tr></tbody>
                  </table>
                </div>
              </div>`;
            container.innerHTML = html;
            const dateInput = container.querySelector('#leaderPointsDateFilter');
            const tzNow2 = tzNow;
            const ym = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            if (dateInput) dateInput.value = ym(tzNow2);
            return;
          }
          const uids = targets.map((a) => a.uid || a.id).filter(Boolean).map(String);
          const ref = fns.collection(db, "checkins");
          const chunks = []; for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));
          const records = [];
          for (const ch of chunks) {
            const q = fns.query(ref, fns.where("uid", "in", ch));
            const snap = await withRetry(() => fns.getDocs(q));
            snap.forEach((doc) => {
              const data = doc.data() || {};
              let created = data.createdAt;
              let dt = null;
              if (created && typeof created.toDate === 'function') dt = created.toDate(); else if (typeof created === 'string') dt = new Date(created);
              if (!dt) dt = new Date();
              const nm = data.name || nameByUid2.get(String(data.uid || '')) || '使用者';
              records.push({ id: doc.id, ...data, dt, name: nm });
            });
          }
          let rules = appState.pointsRules || [];
          try {
            const rref = fns.collection(db, 'pointsRules');
            const rsnap = await withRetry(() => fns.getDocs(rref));
            const list = [];
            rsnap.forEach((doc) => { const d = doc.data() || {}; list.push({ id: doc.id, ...d }); });
            rules = list;
            appState.pointsRules = list;
          } catch {}
          const html = `
            <div class="block" id="leader-block-points-month">
              <div class="block-header centered"><button id="leaderPointsPrevMonth" class="btn btn-sm" type="button">◀</button><span class="block-title" id="leaderPointsMonthTitle">${coName || ''}當月計點加總</span><button id="leaderPointsNextMonth" class="btn btn-sm" type="button">▶</button></div>
              <div class="table-wrapper">
                <table class="table" aria-label="當月計點加總">
                  <thead>
                    <tr>
                      <th>姓名</th>
                      <th>總計點</th>
                    </tr>
                  </thead>
                  <tbody id="leaderPointsMonthTbody"><tr><td colspan="2">載入中...</td></tr></tbody>
                </table>
              </div>
            </div>
            <div class="block" id="leader-block-appeals">
              <div class="block-header"><span class="block-title">${coName || ''}申訴列表</span></div>
              <div class="block-actions"><select id="leaderPointsNameFilter" class="input"></select><input id="leaderPointsDateFilter" type="month" class="input" /></div>
              <div class="table-wrapper">
                <table class="table" aria-label="申訴列表">
                  <thead>
                    <tr>
                      <th>姓名</th>
                      <th>日期</th>
                      <th>事由</th>
                      <th>狀態</th>
                      <th>計點</th>
                      <th>申訴說明</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody id="leaderAppealsTbody"><tr><td colspan="7">該公司無申訴紀錄</td></tr></tbody>
                </table>
              </div>
            </div>
            <div class="block" id="leader-block-points-today">
              <div class="block-header"><span class="block-title">${coName || ''}當日計點列表</span></div>
              <div class="block-actions"><select id="leaderPointsTodayName" class="input"><option value="">全部</option></select><input id="leaderPointsTodayDate" type="date" class="input" /></div>
              <div class="table-wrapper">
                <table class="table" aria-label="當日計點列表">
                  <thead>
                    <tr>
                      <th>姓名</th>
                      <th>時間</th>
                      <th>事由</th>
                      <th>狀態</th>
                      <th>計點</th>
                    </tr>
                  </thead>
                  <tbody id="leaderPointsTodayTbody"><tr><td colspan="5">載入中...</td></tr></tbody>
                </table>
              </div>
            </div>`;
          container.innerHTML = html;
          const nameFilter = container.querySelector('#leaderPointsNameFilter');
          const dateInput = container.querySelector('#leaderPointsDateFilter');
          const tzNow = nowInTZ('Asia/Taipei');
          const monthTitleEl = container.querySelector('#leaderPointsMonthTitle');
          const monthPrevBtn = container.querySelector('#leaderPointsPrevMonth');
          const monthNextBtn = container.querySelector('#leaderPointsNextMonth');
          const monthTbody = container.querySelector('#leaderPointsMonthTbody');
          const formatDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          const ym = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const nameOptions = [{ value: '', label: '全部' }].concat(targets.map((a) => ({ value: String(a.uid || a.id || ''), label: a.name || a.email || '使用者' })));
          if (nameFilter) { nameFilter.innerHTML = nameOptions.map((o) => `<option value="${o.value}">${o.label}</option>`).join(''); }
          const calcPointsMonth = (rec) => {
            const statusFlag = (rec.inRadius === true) ? '正常' : '異常';
            const statusText = String(rec.status || '').trim();
            const baseStatus = statusText.split('-')[0];
            const reason = baseStatus || statusText;
            const found = rules.find((r) => String(r.reason||'') === reason && String(r.status||'') === statusFlag) || null;
            return found ? Number(found.points || 0) : 0;
          };
          let viewMonth = new Date(tzNow.getFullYear(), tzNow.getMonth(), 1);
          const monthLabel = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          function renderMonthTotals() {
            if (!monthTbody) return;
            const y = viewMonth.getFullYear();
            const m = viewMonth.getMonth();
            const start = new Date(y, m, 1);
            const end = new Date(y, m + 1, 1);
            const isCurr = (tzNow.getFullYear() === y) && (tzNow.getMonth() === m);
            const daysLimit = isCurr ? tzNow.getDate() : new Date(y, m + 1, 0).getDate();
            const daySets = new Map();
            records.forEach((rec) => {
              if (rec.dt >= start && rec.dt < end) {
                const k = `${rec.dt.getFullYear()}-${String(rec.dt.getMonth()+1).padStart(2,'0')}-${String(rec.dt.getDate()).padStart(2,'0')}`;
                const u = String(rec.uid||'');
                let s = daySets.get(u); if (!s) { s = new Set(); daySets.set(u, s); }
                s.add(k);
              }
            });
            let companyTotal = 0;
            const rows = targets.map((a) => {
              const uid = String(a.uid || a.id || '');
              const nm = a.name || a.email || '使用者';
              const pointsSum = records.reduce((sum, rec) => {
                const ru = String(rec.uid || '');
                return (ru === uid && rec.dt >= start && rec.dt < end) ? (sum + calcPointsMonth(rec)) : sum;
              }, 0);
              const presentDays = (daySets.get(uid)?.size) || 0;
              const missingDays = Math.max(0, daysLimit - presentDays);
              const total = pointsSum + (-1 * missingDays);
              companyTotal += total;
              return `<tr><td>${nm}</td><td>${total}</td></tr>`;
            }).join('');
            if (monthTitleEl) monthTitleEl.textContent = `${coName || ''} ${monthLabel(viewMonth)} 計點加總`;
            monthTbody.innerHTML = rows || `<tr><td colspan="2">該月無計點紀錄</td></tr>`;
          }
          renderMonthTotals();
          monthPrevBtn?.addEventListener('click', () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); renderMonthTotals(); });
          monthNextBtn?.addEventListener('click', () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); renderMonthTotals(); });
          const nameByUid = new Map();
          targets.forEach((a) => {
            const nm = a.name || a.email || '使用者';
            const id1 = String(a.id||''); if (id1) nameByUid.set(id1, nm);
            const id2 = String(a.uid||''); if (id2) nameByUid.set(id2, nm);
          });
          const photoByUid = new Map();
          targets.forEach((a) => {
            const p = a.photoUrl || '';
            const id1 = String(a.id||''); if (id1) photoByUid.set(id1, p);
            const id2 = String(a.uid||''); if (id2) photoByUid.set(id2, p);
          });
          const appeals = [];
          const aref = fns.collection(db, 'pointAppeals');
          const chunks2 = []; for (let i = 0; i < uids.length; i += 10) chunks2.push(uids.slice(i, i + 10));
          for (const ch of chunks2) {
            const qa = fns.query(aref, fns.where('uid', 'in', ch));
            const asnap = await withRetry(() => fns.getDocs(qa));
            asnap.forEach((doc) => {
              const data = doc.data() || {};
              let created = data.createdAt;
              let dt = null;
              if (created && typeof created.toDate === 'function') dt = created.toDate(); else if (typeof created === 'string') dt = new Date(created);
              if (!(dt instanceof Date) || isNaN(dt)) dt = new Date();
              const nm = nameByUid.get(String(data.uid||'')) || data.name || '使用者';
              appeals.push({ id: doc.id, ...data, dt, name: nm });
            });
          }
          const tbody = container.querySelector('#leaderAppealsTbody');
          function renderAppeals() {
            if (!tbody) return;
            const v = String(dateInput?.value || '');
            const y = Number(v.split('-')[0] || tzNow.getFullYear());
            const m = Number((v.split('-')[1] || String(tzNow.getMonth()+1)).padStart(2,'0')) - 1;
            const selUid = String(nameFilter?.value || '').trim();
            const start = new Date(y, m, 1);
            const end = new Date(y, m + 1, 1);
            const rows = appeals
              .filter((a) => a.dt >= start && a.dt < end && (!selUid || String(a.uid||'') === selUid))
              .sort((a,b) => b.dt - a.dt)
              .map((a) => {
                const dtStr = formatDate(a.dt);
                const reason = a.reason || '';
                const statusFlag = a.status || '';
                const points = (a.points != null) ? String(a.points) : '';
                const text = a.appealText || '';
                const state = a.state || '';
                const isAdmin = hasFullAccessToTab('leader');
                const processed = state && state !== '送審';
                const approveCls = processed ? 'btn btn-grey' : 'btn btn-green';
                const rejectCls = processed ? 'btn btn-grey' : 'btn btn-darkred';
                const approveDisabled = (!isAdmin || processed) ? 'disabled' : '';
                const rejectDisabled = (!isAdmin || processed) ? 'disabled' : '';
                const editDisabled = (!isAdmin) ? 'disabled' : '';
                const deleteDisabled = (!isAdmin) ? 'disabled' : '';
                return `<tr data-id="${a.id}"><td>${a.name}</td><td>${dtStr}</td><td>${reason}</td><td>${statusFlag}</td><td>${points}</td><td>${text}</td><td class="cell-actions"><button class="${approveCls}" data-act="approve" data-id="${a.id}" ${approveDisabled}>核准</button> <button class="${rejectCls}" data-act="reject" data-id="${a.id}" ${rejectDisabled}>拒絕</button> <button class="btn btn-blue" data-act="edit" data-id="${a.id}" ${editDisabled}>編輯</button> <button class="btn btn-red" data-act="delete" data-id="${a.id}" ${deleteDisabled}>刪除</button></td></tr>`;
              }).join('');
            tbody.innerHTML = rows || `<tr><td colspan="7">該月無申訴紀錄</td></tr>`;
          }
          if (dateInput) dateInput.value = ym(tzNow);
          renderAppeals();
          dateInput?.addEventListener('change', () => { renderAppeals(); });
          nameFilter?.addEventListener('change', () => { renderAppeals(); });
          const ptbody = container.querySelector('#leaderPointsTodayTbody');
          const formatDT = (d) => formatDateTimeTZ(d, 'Asia/Taipei');
          const calcPoints = (rec) => {
            const statusFlag = (rec.inRadius === true) ? '正常' : '異常';
            const statusText = String(rec.status || '').trim();
            const baseStatus = statusText.split('-')[0];
            const reason = baseStatus || statusText;
            const found = rules.find((r) => String(r.reason||'') === reason && String(r.status||'') === statusFlag) || null;
            return { statusFlag, reason, points: found ? Number(found.points || 0) : 0 };
          };
          const tzNow3 = nowInTZ('Asia/Taipei');
          const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const y3 = tzNow3.getFullYear();
          const m3 = tzNow3.getMonth();
          const d3 = tzNow3.getDate();
          const allTargets = accounts.filter((a) => {
            const ids0 = Array.isArray(a.companyIds) ? a.companyIds : (a.companyId ? [a.companyId] : []);
            const ids = ids0.map((x) => String(x||'').trim());
            const idOk = coId ? ids.includes(String(coId)) : false;
            const nameOk = coName ? ids.includes(String(coName)) : false;
            const allowedRoles = ["高階主管","主管","初階主管","行政"];
            const roleOk = allowedRoles.includes(String(a.role||""));
            return roleOk && (idOk || nameOk);
          });
          const nameAllByUid = new Map();
          allTargets.forEach((a) => {
            const nm = a.name || a.email || '使用者';
            const id1 = String(a.id||''); if (id1) nameAllByUid.set(id1, nm);
            const id2 = String(a.uid||''); if (id2) nameAllByUid.set(id2, nm);
          });
          const uidsAll = allTargets.map((a) => a.uid || a.id).filter(Boolean).map(String);
          const chunksAll = []; for (let i = 0; i < uidsAll.length; i += 10) chunksAll.push(uidsAll.slice(i, i + 10));
          const recordsAll = [];
          for (const ch of chunksAll) {
            const q = fns.query(fns.collection(db, 'checkins'), fns.where('uid', 'in', ch));
            const snapAll = await withRetry(() => fns.getDocs(q));
            snapAll.forEach((doc) => {
              const data = doc.data() || {};
              let created = data.createdAt;
              let dt = null;
              if (created && typeof created.toDate === 'function') dt = created.toDate(); else if (typeof created === 'string') dt = new Date(created);
              if (!dt) dt = new Date();
              const nm = data.name || nameAllByUid.get(String(data.uid || '')) || '使用者';
              recordsAll.push({ id: doc.id, ...data, dt, name: nm });
            });
          }
          const nameSel = container.querySelector('#leaderPointsTodayName');
          const dateSel = container.querySelector('#leaderPointsTodayDate');
          const nameOptionsToday = [{ value: '', label: '全部' }].concat(allTargets.map((a) => ({ value: String(a.uid || a.id || ''), label: a.name || a.email || '使用者' })));
          if (nameSel) nameSel.innerHTML = nameOptionsToday.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
          if (dateSel) dateSel.value = ymd(tzNow3);
          function renderPointsToday() {
            if (!ptbody) return;
            const v = String(dateSel?.value || '');
            const parts = v.split('-');
            const y = Number(parts[0] || y3);
            const m = Number((parts[1] || String(m3+1)).padStart(2,'0')) - 1;
            const d = Number((parts[2] || String(d3)).padStart(2,'0'));
            const selUid = String(nameSel?.value || '').trim();
            const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const uidsSel = selUid ? [selUid] : uidsAll;
            const uidsSet = new Set(uidsSel.map(String));
            const recs = recordsAll
              .filter((rec) => rec.dt.getFullYear() === y && rec.dt.getMonth() === m && rec.dt.getDate() === d && (uidsSet.has(String(rec.uid||''))));
            const present = new Set(recs.map((r) => String(r.uid||'')));
            const rowsReal = recs
              .sort((a,b)=> (a.name||'').localeCompare(b.name||'') || (b.dt - a.dt))
              .map((rec) => {
                const { statusFlag, reason, points } = calcPoints(rec);
                return `<tr><td>${rec.name || ''}</td><td>${formatDT(rec.dt)}</td><td>${reason}</td><td>${statusFlag}</td><td>${points}</td></tr>`;
              });
            const rowsMissing = uidsSel
              .filter((uid) => !present.has(String(uid)))
              .map((uid) => {
                const nm = nameAllByUid.get(String(uid)) || '使用者';
                return `<tr><td>${nm}</td><td>${dateStr}</td><td>未打卡</td><td>異常</td><td>-1</td></tr>`;
              });
            const rows = rowsReal.concat(rowsMissing).join('');
            ptbody.innerHTML = rows || `<tr><td colspan="5">該公司當日無計點紀錄</td></tr>`;
          }
          renderPointsToday();
          nameSel?.addEventListener('change', renderPointsToday);
          dateSel?.addEventListener('change', renderPointsToday);
          tbody?.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const act = btn.dataset.act || '';
            const id = btn.dataset.id || '';
            const rec = appeals.find((x) => x.id === id);
            if (!rec) return;
            const isAdmin = hasFullAccessToTab('leader');
            try {
              await ensureFirebase();
              if (act === 'approve' || act === 'reject') {
                if (!isAdmin) { alert('權限不足：不可變更狀態'); return; }
                const newState = act === 'approve' ? '核准' : '拒絕';
                const payload = { state: newState, updatedAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString() };
                if (newState === '核准') payload.points = 0;
                await withRetry(() => fns.setDoc(fns.doc(db, 'pointAppeals', id), payload, { merge: true }));
                try { rec.state = newState; if (newState === '核准') rec.points = 0; } catch {}
                renderAppeals();
                try { await refreshSubtabBadges(); } catch {}
              } else if (act === 'edit') {
                if (!isAdmin) { alert('權限不足：不可編輯'); return; }
                openModal({
                  title: '變更審核狀態',
                  fields: [ { key: 'state', label: '審核狀態', type: 'select', options: [ { value: '', label: '待核准' }, { value: '核准', label: '核准' }, { value: '拒絕', label: '拒絕' } ] } ],
                  submitText: '確認',
                  onSubmit: async (data) => {
                    try {
                      const raw = String(data.state||'').trim();
                      const nv = raw || '送審';
                      const payload = { state: nv, updatedAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString() };
                      if (nv === '核准') payload.points = 0;
                      await withRetry(() => fns.setDoc(fns.doc(db, 'pointAppeals', id), payload, { merge: true }));
                      try { rec.state = nv; if (nv === '核准') rec.points = 0; } catch {}
                      renderAppeals();
                      try { await refreshSubtabBadges(); } catch {}
                      return true;
                    } catch (err) { alert(`更新失敗：${err?.message || err}`); return false; }
                  },
                  refreshOnSubmit: false,
                });
              } else if (act === 'delete') {
                if (!isAdmin) { alert('權限不足：不可刪除'); return; }
                const ok = await confirmAction({ title: '確認刪除', text: '確定要刪除此計點申訴嗎？', confirmText: '刪除' });
                if (!ok) return;
                await withRetry(() => fns.deleteDoc(fns.doc(db, 'pointAppeals', id)));
                try { const i = appeals.findIndex((x) => x.id === id); if (i >= 0) appeals.splice(i, 1); } catch {}
                renderAppeals();
                try { await refreshSubtabBadges(); } catch {}
              }
            } catch (err) { alert(`操作失敗：${err?.message || err}`); }
          });
        } catch (e) {
          const msg = e?.message || e;
          container.textContent = typeof msg === 'string' ? `載入失敗：${msg}` : "載入失敗";
        }
      })();
      return;
    }
    if (label === "地圖") {
      (async () => {
        try {
          await ensureFirebase();
          const maps = await ensureGoogleMaps();
          const coId = appState.leaderCompanyFilter || null;
          const accounts = Array.isArray(appState.accounts) ? appState.accounts : [];
          if (!coId) { container.textContent = "請先選擇公司"; return; }
          const companies = Array.isArray(appState.companies) ? appState.companies : [];
          const coObj = companies.find((c) => String(c.id||'') === String(coId) || String(c.name||'') === String(coId)) || null;
          if (!coObj || !coObj.coords) { container.textContent = "公司未設定座標"; return; }
          const allowedRoles = ["高階主管","主管","初階主管","行政"];
          const targets = accounts.filter((a) => {
            const ids0 = Array.isArray(a.companyIds) ? a.companyIds : (a.companyId ? [a.companyId] : []);
            const ids = ids0.map((x) => String(x||'').trim());
            const idOk = ids.includes(String(coId)) || ids.includes(String(coObj.name||''));
            const roleOk = allowedRoles.includes(String(a.role||""));
            return idOk && roleOk;
          });
          const [latStr, lngStr] = String(coObj.coords).split(',').map((s)=>s.trim());
          const center = { lat: Number(latStr), lng: Number(lngStr) };
          const radius = Number(coObj.radiusMeters || 100);
          const html = `
            <div id="leaderMapSplit" style="display:grid; grid-template-rows: auto 1fr auto; height: 60vh; gap: 12px;">
              <div class="block-header centered"><span class="block-title">${coObj?.name || ''}人員地圖</span></div>
              <div id="leaderMapView" style="width:100%; height:100%; border-radius:12px; overflow:hidden;"></div>
              <div class="block" id="leaderStatusBlock">
                <div class="block-header"><span class="block-title">人員當日打卡狀況</span></div>
                <div id="leaderStatusView" class="table-wrapper" style="width:100%; max-height: 20vh; overflow: auto;">
                  <table class="table" aria-label="人員當日打卡狀況">
                    <thead>
                      <tr>
                        <th>大頭照</th>
                        <th>姓名</th>
                        <th>時間</th>
                        <th>地點</th>
                        <th>狀態</th>
                        <th>範圍</th>
                      </tr>
                    </thead>
                    <tbody id="leaderStatusTbody"><tr><td colspan="6">載入中...</td></tr></tbody>
                  </table>
                </div>
              </div>
            </div>`;
          container.innerHTML = html;
          
          const mapRoot = document.getElementById('leaderMapView');
          const tbody = document.getElementById('leaderStatusTbody');
          const map = new maps.Map(mapRoot, { center, zoom: 15, mapTypeId: 'roadmap', disableDefaultUI: true });
          const circle = new maps.Circle({ center, radius, strokeColor: '#ff0000', strokeOpacity: 0.8, strokeWeight: 2, fillColor: '#ff0000', fillOpacity: 0.1, map });
          mapRoot.style.position = 'relative';
          const btnCenter = document.createElement('button');
          btnCenter.type = 'button';
          btnCenter.className = 'btn btn-grey';
          btnCenter.textContent = '公司';
          btnCenter.style.position = 'absolute';
          btnCenter.style.top = '8px';
          btnCenter.style.right = '8px';
          btnCenter.style.zIndex = '10';
          btnCenter.style.padding = '6px 10px';
          btnCenter.style.borderRadius = '8px';
          btnCenter.setAttribute('aria-label', '回到公司中心');
          mapRoot.appendChild(btnCenter);
          let initialZoom = 15;
          btnCenter.addEventListener('click', () => {
            try { map.panTo(center); if (typeof initialZoom === 'number') map.setZoom(initialZoom); } catch {}
          });
          const nameByUid = new Map();
          targets.forEach((a) => {
            const nm = a.name || a.email || '使用者';
            const id1 = String(a.id||''); if (id1) nameByUid.set(id1, nm);
            const id2 = String(a.uid||''); if (id2) nameByUid.set(id2, nm);
          });
          const photoByUid = new Map();
          targets.forEach((a) => {
            const p = a.photoUrl || '';
            const id1 = String(a.id||''); if (id1) photoByUid.set(id1, p);
            const id2 = String(a.uid||''); if (id2) photoByUid.set(id2, p);
          });
          const uids = targets.map((a) => a.uid || a.id).filter(Boolean).map(String);
          const ref = fns.collection(db, 'checkins');
          const chunks = []; for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));
          const all = [];
          for (const ch of chunks) {
            const q = fns.query(ref, fns.where('uid', 'in', ch));
            const snap = await withRetry(() => fns.getDocs(q));
            snap.forEach((doc) => { const d = doc.data() || {}; all.push({ id: doc.id, ...d }); });
          }
          const lastByUid = new Map();
          all.forEach((r) => {
            let created = r.createdAt; let dt = null;
            if (created && typeof created.toDate === 'function') dt = created.toDate(); else if (typeof created === 'string') dt = new Date(created);
            if (!(dt instanceof Date) || isNaN(dt)) return;
            const uid = String(r.uid||''); if (!uid) return;
            const prev = lastByUid.get(uid);
            if (!prev || (prev.dt < dt)) lastByUid.set(uid, { ...r, dt });
          });
          const markers = [];
          const markerByUid = new Map();
          const size = 36;
          for (const [uid, r] of Array.from(lastByUid.entries())) {
            const nm = nameByUid.get(uid) || r.name || '使用者';
            const lat = r.lat, lng = r.lng;
            if (typeof lat === 'number' && typeof lng === 'number') {
              const pos = { lat, lng };
              const color = r.inRadius ? '#22c55e' : '#ef4444';
              const src = photoByUid.get(uid) || r.photoData || '';
              let url = null;
              try {
                const canvas = document.createElement('canvas');
                canvas.width = size; canvas.height = size;
                const ctx = canvas.getContext('2d');
                const img = new Image();
                if (src) { img.crossOrigin = 'anonymous'; img.src = src; await new Promise((res) => { img.onload = res; img.onerror = res; }); }
                ctx.save();
                ctx.beginPath(); ctx.arc(size/2, size/2, (size/2)-2, 0, Math.PI*2); ctx.closePath(); ctx.clip();
                if (src && img.width && img.height) { ctx.drawImage(img, 0, 0, size, size); } else { ctx.fillStyle = '#9CA3AF'; ctx.fillRect(0, 0, size, size); ctx.fillStyle = '#ffffff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const initial = String(nm||'').trim().charAt(0) || '用'; ctx.fillText(initial, size/2, size/2); }
                ctx.restore();
                ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(size/2, size/2, (size/2)-1.5, 0, Math.PI*2); ctx.stroke();
                url = canvas.toDataURL();
              } catch {}
              const icon = url ? { url, scaledSize: new maps.Size(size, size), anchor: new maps.Point(size/2, size/2) } : { path: maps.SymbolPath.CIRCLE, scale: 6, fillColor: color, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 1 };
              const marker = new maps.Marker({ position: pos, map, title: nm, icon });
              markers.push(marker);
              markerByUid.set(uid, marker);
            }
          }
          try {
            const vw = mapRoot && (mapRoot.clientWidth || mapRoot.offsetWidth) || 600;
            const vh = mapRoot && (mapRoot.clientHeight || mapRoot.offsetHeight) || 300;
            const minDim = Math.max(1, Math.min(vw, vh));
            const targetPx = minDim * 0.4;
            const latRad = (center.lat || 0) * Math.PI / 180;
            const metersPerPixel = (2 * radius) / targetPx;
            const zoom = Math.log2((156543.03392 * Math.cos(latRad)) / metersPerPixel);
            const z = Math.max(0, Math.min(30, zoom));
            map.setCenter(center);
            map.setOptions({ maxZoom: 30 });
            map.setZoom(z);
            initialZoom = z;
          } catch {}
          const formatDT = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          const rows = [];
          targets.forEach((a) => {
            const uid = String(a.uid || a.id || '');
            if (!uid) return;
            const r = lastByUid.get(uid) || null;
            const nm = nameByUid.get(uid) || a.name || a.email || '使用者';
            const tzNow = nowInTZ('Asia/Taipei');
            const todayYmd = `${tzNow.getFullYear()}-${String(tzNow.getMonth()+1).padStart(2,'0')}-${String(tzNow.getDate()).padStart(2,'0')}`;
            const recYmd = (r && r.dt instanceof Date) ? `${r.dt.getFullYear()}-${String(r.dt.getMonth()+1).padStart(2,'0')}-${String(r.dt.getDate()).padStart(2,'0')}` : '';
            const hasToday = r && recYmd === todayYmd;
            const when = hasToday ? formatDT(r.dt) : '';
            const place = hasToday ? (r.locationName || '') : '';
            const status = hasToday ? (r.status || '') : '尚未打卡';
            const baseSt = String(status).split('-')[0];
            const stCls = (baseSt === '上班') ? 'work' : (baseSt === '下班') ? 'off' : (baseSt === '外出') ? 'out' : (baseSt === '抵達') ? 'arrive' : (baseSt === '離開') ? 'leave' : (baseSt === '返回') ? 'return' : '';
            const flagHtml = hasToday ? (r.inRadius ? '<span class="status-flag good">正常</span>' : '<span class="status-flag bad">異常</span>') : '<span class="status-flag bad">異常</span>';
            const src = photoByUid.get(uid) || (r ? r.photoData : '') || '';
            const imgCell = src ? `<button class="avatar-btn" type="button" data-src="${src}" data-name="${nm}" style="background:transparent;border:none;padding:0;"><img src="${src}" alt="頭像" class="user-photo"/></button>` : '';
            rows.push(`<tr data-uid="${uid}"><td data-col="avatar">${imgCell}</td><td data-col="name">${nm}</td><td>${when}</td><td><span class="status-label ${stCls}">${place}</span></td><td><span class="status-label ${stCls}">${status}</span></td><td>${flagHtml}</td></tr>`);
          });
          tbody.innerHTML = rows.join('') || `<tr><td colspan="6">無資料</td></tr>`;

          
          tbody.addEventListener('click', (e) => {
            const btn = e.target.closest('button.avatar-btn');
            if (btn) {
              const tr = btn.closest('tr');
              const uid = tr && tr.dataset.uid;
              if (!uid) return;
              const r = lastByUid.get(uid);
              if (!r || typeof r.lat !== 'number' || typeof r.lng !== 'number') return;
              const pos = { lat: r.lat, lng: r.lng };
              try { map.panTo(pos); const z = map.getZoom(); if (typeof z === 'number') map.setZoom(Math.max(16, z)); else map.setZoom(16); } catch {}
              const m = markerByUid.get(uid);
              try { if (m && maps.Animation) { m.setAnimation(maps.Animation.BOUNCE); setTimeout(() => { try { m.setAnimation(null); } catch {} }, 1200); } } catch {}
              homeMapOverlay?.classList.remove('hidden');
              lastCoords = { latitude: r.lat, longitude: r.lng };
              updateHomeMap();
              return;
            }
            const td = e.target.closest('td');
            if (!td) return;
            const col = td.dataset.col || '';
            if (col !== 'name') return;
            const tr = td.closest('tr');
            const uid = tr && tr.dataset.uid;
            if (!uid) return;
            const r = lastByUid.get(uid);
            if (!r || typeof r.lat !== 'number' || typeof r.lng !== 'number') return;
            const pos = { lat: r.lat, lng: r.lng };
            try { map.panTo(pos); const z = map.getZoom(); if (typeof z === 'number') map.setZoom(Math.max(16, z)); else map.setZoom(16); } catch {}
            const m = markerByUid.get(uid);
            try { if (m && maps.Animation) { m.setAnimation(maps.Animation.BOUNCE); setTimeout(() => { try { m.setAnimation(null); } catch {} }, 1200); } } catch {}
            homeMapOverlay?.classList.remove('hidden');
            lastCoords = { latitude: r.lat, longitude: r.lng };
            updateHomeMap();
          });
        } catch (e) {
          const msg = e?.message || e; container.textContent = typeof msg === 'string' ? `載入失敗：${msg}` : "載入失敗";
        }
      })();
      return;
    }
    if (label === "補卡") {
      (async () => {
        try {
          await ensureFirebase();
          const coId = appState.leaderCompanyFilter || null;
          const accounts = Array.isArray(appState.accounts) ? appState.accounts : [];
          if (!coId) { container.textContent = "請先選擇公司"; return; }
          const companies = Array.isArray(appState.companies) ? appState.companies : [];
          const coObj = companies.find((c) => String(c.id||'') === String(coId) || String(c.name||'') === String(coId)) || null;
          const coName = coObj?.name || null;
          const targets = accounts.filter((a) => {
            const ids0 = Array.isArray(a.companyIds) ? a.companyIds : (a.companyId ? [a.companyId] : []);
            const ids = ids0.map((x) => String(x||'').trim());
            const idOk = coId ? ids.includes(String(coId)) : false;
            const nameOk = coName ? ids.includes(String(coName)) : false;
            const allowedRoles = ["高階主管","主管","初階主管","行政"];
            const roleOk = allowedRoles.includes(String(a.role||""));
            return roleOk && (idOk || nameOk);
          });
          if (!targets.length) {
            const tzNow = nowInTZ('Asia/Taipei');
            const html = `
              <div class="block" id="leader-block-makeups">
                <div class="block-header"><span class="block-title">${coName || ''}補卡列表</span></div>
                <div class="block-actions"><select id="leaderMakeupNameFilter" class="input"><option value="">全部</option></select><input id="leaderMakeupDateFilter" type="date" class="input" /></div>
                <div class="table-wrapper">
                  <table class="table" aria-label="補卡列表">
                    <thead>
                      <tr>
                        <th>姓名</th>
                        <th>日期時間</th>
                        <th>地點</th>
                        <th>狀態</th>
                        <th>審核</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody id="leaderMakeupsTbody"><tr><td colspan="6">該公司無補卡紀錄</td></tr></tbody>
                  </table>
                </div>
              </div>`;
            container.innerHTML = html;
            const dateInput = container.querySelector('#leaderMakeupDateFilter');
            const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            if (dateInput) dateInput.value = ymd(tzNow);
            return;
          }
          const nameByUid = new Map();
          targets.forEach((a) => {
            const nm = a.name || a.email || '使用者';
            const id1 = String(a.id||''); if (id1) nameByUid.set(id1, nm);
            const id2 = String(a.uid||''); if (id2) nameByUid.set(id2, nm);
          });
          const uids = targets.map((a) => a.uid || a.id).filter(Boolean).map(String);
          const ref = fns.collection(db, 'makeupRequests');
          const chunks = []; for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));
          const makeups = [];
          for (const ch of chunks) {
            const q = fns.query(ref, fns.where('uid', 'in', ch));
            const snap = await withRetry(() => fns.getDocs(q));
            snap.forEach((doc) => {
              const data = doc.data() || {};
              let created = data.createdAt;
              let dt = null;
              if (created && typeof created.toDate === 'function') dt = created.toDate(); else if (typeof created === 'string') dt = new Date(created);
              if (!(dt instanceof Date) || isNaN(dt)) dt = new Date();
              const nm = nameByUid.get(String(data.uid||'')) || data.name || '使用者';
              makeups.push({ id: doc.id, ...data, dt, name: nm });
            });
          }
          const html = `
            <div class="block" id="leader-block-makeups">
              <div class="block-header"><span class="block-title">${coName || ''}補卡列表</span></div>
              <div class="block-actions"><select id="leaderMakeupNameFilter" class="input"></select><input id="leaderMakeupDateFilter" type="date" class="input" /></div>
              <div class="table-wrapper">
                <table class="table" aria-label="補卡列表">
                  <thead>
                    <tr>
                      <th>姓名</th>
                      <th>日期時間</th>
                      <th>地點</th>
                      <th>狀態</th>
                      <th>審核</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody id="leaderMakeupsTbody"><tr><td colspan="6">該公司無補卡紀錄</td></tr></tbody>
                </table>
              </div>
            </div>`;
          container.innerHTML = html;
          const nameFilter = container.querySelector('#leaderMakeupNameFilter');
          const dateInput = container.querySelector('#leaderMakeupDateFilter');
          const tzNow = nowInTZ('Asia/Taipei');
          const formatDT = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const nameOptions = [{ value: '', label: '全部' }].concat(targets.map((a) => ({ value: String(a.uid || a.id || ''), label: a.name || a.email || '使用者' })));
          if (nameFilter) { nameFilter.innerHTML = nameOptions.map((o) => `<option value="${o.value}">${o.label}</option>`).join(''); }
          const tbody = container.querySelector('#leaderMakeupsTbody');
          function renderMakeups() {
            if (!tbody) return;
            const v = String(dateInput?.value || '');
            const y = Number(v.split('-')[0] || tzNow.getFullYear());
            const m = Number((v.split('-')[1] || String(tzNow.getMonth()+1)).padStart(2,'0')) - 1;
            const d = Number((v.split('-')[2] || String(tzNow.getDate())).padStart(2,'0'));
            const selUid = String(nameFilter?.value || '').trim();
            const start = new Date(y, m, d);
            const end = new Date(y, m, d + 1);
            const rows = makeups
              .filter((a) => a.dt >= start && a.dt < end && (!selUid || String(a.uid||'') === selUid))
              .sort((a,b) => b.dt - a.dt)
              .map((a) => {
                const dtStr = formatDT(a.dt);
                const place = a.place || '';
                const status = a.status || '';
                const state = a.state || '送審';
                const isAdmin = hasFullAccessToTab('leader');
                const processed = state && state !== '送審';
                const approveCls = processed ? 'btn btn-grey' : 'btn btn-green';
                const rejectCls = processed ? 'btn btn-grey' : 'btn btn-darkred';
                const approveDisabled = (!isAdmin || processed) ? 'disabled' : '';
                const rejectDisabled = (!isAdmin || processed) ? 'disabled' : '';
                const editDisabled = (!isAdmin) ? 'disabled' : '';
                const deleteDisabled = (!isAdmin) ? 'disabled' : '';
                return `<tr data-id="${a.id}"><td>${a.name}</td><td>${dtStr}</td><td>${place}</td><td>${status}</td><td>${state}</td><td class="cell-actions"><button class="${approveCls}" data-act="approve" data-id="${a.id}" ${approveDisabled}>核准</button> <button class="${rejectCls}" data-act="reject" data-id="${a.id}" ${rejectDisabled}>拒絕</button> <button class="btn btn-blue" data-act="edit" data-id="${a.id}" ${editDisabled}>編輯</button> <button class="btn btn-red" data-act="delete" data-id="${a.id}" ${deleteDisabled}>刪除</button></td></tr>`;
              }).join('');
            tbody.innerHTML = rows || `<tr><td colspan="6">該日無補卡紀錄</td></tr>`;
          }
          if (dateInput) dateInput.value = ymd(tzNow);
          renderMakeups();
          dateInput?.addEventListener('change', () => { renderMakeups(); });
          nameFilter?.addEventListener('change', () => { renderMakeups(); });
          tbody?.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const act = btn.dataset.act || '';
            const id = btn.dataset.id || '';
            const rec = makeups.find((x) => x.id === id);
            if (!rec) return;
            const isAdmin = hasFullAccessToTab('leader');
            try {
              await ensureFirebase();
              if (act === 'approve' || act === 'reject') {
                if (!isAdmin) { alert('權限不足：不可變更狀態'); return; }
                const newState = act === 'approve' ? '核准' : '拒絕';
                const payload = { state: newState, updatedAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString() };
                await withRetry(() => fns.setDoc(fns.doc(db, 'makeupRequests', id), payload, { merge: true }));
                try { rec.state = newState; } catch {}
                renderMakeups();
              } else if (act === 'edit') {
                if (!isAdmin) { alert('權限不足：不可編輯'); return; }
                openModal({
                  title: '變更審核狀態',
                  fields: [ { key: 'state', label: '審核狀態', type: 'select', options: [ { value: '', label: '待核准' }, { value: '核准', label: '核准' }, { value: '拒絕', label: '拒絕' } ] } ],
                  submitText: '確認',
                  onSubmit: async (data) => {
                    try {
                      const raw = String(data.state||'').trim();
                      const nv = raw || '送審';
                      const payload = { state: nv, updatedAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString() };
                      await withRetry(() => fns.setDoc(fns.doc(db, 'makeupRequests', id), payload, { merge: true }));
                      try { rec.state = nv; } catch {}
                      renderMakeups();
                      return true;
                    } catch (err) { alert(`更新失敗：${err?.message || err}`); return false; }
                  },
                  refreshOnSubmit: false,
                });
              } else if (act === 'delete') {
                if (!isAdmin) { alert('權限不足：不可刪除'); return; }
                const ok = await confirmAction({ title: '確認刪除', text: '確定要刪除此補卡申請嗎？', confirmText: '刪除' });
                if (!ok) return;
                await withRetry(() => fns.deleteDoc(fns.doc(db, 'makeupRequests', id)));
                try { const i = makeups.findIndex((x) => x.id === id); if (i >= 0) makeups.splice(i, 1); } catch {}
                renderMakeups();
              }
            } catch (err) { alert(`操作失敗：${err?.message || err}`); }
          });
        } catch (e) {
          const msg = e?.message || e;
          container.textContent = typeof msg === 'string' ? `載入失敗：${msg}` : "載入失敗";
        }
      })();
      return;
    }
    if (label === "班表") {
      const html = `
        <div class="roster-layout" role="region" aria-label="班表">
          <div class="roster-row roster-a">
            <label for="rosterOfficerSelect" class="roster-label">幹部名單：</label>
            <select id="rosterOfficerSelect" class="roster-select">
              <option value="">請選擇幹部</option>
            </select>
          </div>
          <div class="roster-row roster-b">
            <div id="rosterCalendar" class="roster-calendar" aria-live="polite"></div>
          </div>
          <div class="roster-row roster-c">
            <div id="rosterInfo" class="roster-info"></div>
          </div>
        </div>`;
      container.innerHTML = html;
      const info = document.getElementById("rosterInfo");
      const dt = new Date();
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
      if (info) info.textContent = `日期：${dateStr}`;
      const sel = document.getElementById("rosterOfficerSelect");
      if (sel) {
        const coId = appState.leaderCompanyFilter || null;
        const allowedRoles = ["系統管理員","管理層","高階主管","初階主管","行政"];
        const officers = appState.accounts.filter((a) => {
          const isOfficer = allowedRoles.includes(String(a.role||""));
          if (!coId) return isOfficer;
          const ids = Array.isArray(a.companyIds) ? a.companyIds : (a.companyId ? [a.companyId] : []);
          return isOfficer && ids.includes(coId);
        });
        const opts = officers.length ? officers : appState.accounts.slice(0, 10);
        opts.forEach((a) => {
          const opt = document.createElement("option");
          opt.value = a.id;
          opt.textContent = a.name || a.email || a.id;
          sel.appendChild(opt);
        });
      }

      // 月曆：預設當月，提供上一月/下一月切換
      const calendarRoot = document.getElementById("rosterCalendar");
      if (calendarRoot) {
        let viewDate = new Date(dt.getFullYear(), dt.getMonth(), 1);

        const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];

        function monthLabel(date) {
          return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, "0")}月`;
        }
        function daysInMonth(date) {
          const y = date.getFullYear();
          const m = date.getMonth();
          return new Date(y, m + 1, 0).getDate();
        }
        function firstWeekday(date) {
          return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
        }
        function renderMonth(date) {
          const totalDays = daysInMonth(date);
          const startPad = firstWeekday(date);
          const cells = [];
          for (let i = 0; i < startPad; i++) cells.push("");
          for (let d = 1; d <= totalDays; d++) cells.push(String(d));
          while (cells.length % 7 !== 0) cells.push("");

          const rows = [];
          for (let i = 0; i < cells.length; i += 7) {
            rows.push(cells.slice(i, i + 7));
          }

          const today = new Date();
          const isSameMonth = today.getFullYear() === date.getFullYear() && today.getMonth() === date.getMonth();

          function titleHtml(date) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, "0");
            return `
              <div class="cal-year">${y}</div>
              <div class="cal-month">年${m}</div>
              <div class="cal-text">月</div>
            `;
          }
          const headerHtml = `
            <div class="roster-cal-header" role="group" aria-label="月曆導航">
              <div class="roster-cal-nav">
                <button id="rosterPrevMonth" class="roster-cal-nav-btn" aria-label="上一月">◀</button>
                <button id="rosterNextMonth" class="roster-cal-nav-btn" aria-label="下一月">▶</button>
              </div>
              <div class="roster-cal-title" aria-live="polite">${titleHtml(date)}</div>
            </div>
          `;
          // 改為包含前月、次月日期的格子
          const prevMonthLast = daysInMonth(new Date(date.getFullYear(), date.getMonth(), 0));
          const cellsObjs = [];
          for (let i = 0; i < startPad; i++) {
            cellsObjs.push({ day: prevMonthLast - startPad + 1 + i, kind: "prev" });
          }
          for (let d = 1; d <= totalDays; d++) {
            cellsObjs.push({ day: d, kind: "curr" });
          }
          let nextDay = 1;
          while (cellsObjs.length % 7 !== 0) {
            cellsObjs.push({ day: nextDay++, kind: "next" });
          }
          const rowsObjs = [];
          for (let i = 0; i < cellsObjs.length; i += 7) {
            rowsObjs.push(cellsObjs.slice(i, i + 7));
          }

          const tableHtml = `
            <table class="roster-cal-table" aria-label="${monthLabel(date)}">
              <thead><tr>${weekdayLabels.map((w) => `<th scope="col">${w}</th>`).join("")}</tr></thead>
              <tbody>
                ${rowsObjs
                  .map(
                    (r) =>
                      `<tr>${r
                        .map((cell, idx) => {
                          const isToday = cell.kind === "curr" && isSameMonth && today.getDate() === cell.day;
                          const cellCls = [
                            "roster-cal-cell",
                            cell.kind,
                            isToday ? "today" : ""
                          ].filter(Boolean).join(" ");
                          if (cell.kind !== "curr") {
                            return `<td class="${cellCls}"><span class="roster-cal-day-disabled">${cell.day}</span></td>`;
                          }
                          return `<td class="${cellCls}"><button type="button" class="roster-cal-day" data-day="${cell.day}">${cell.day}</button></td>`;
                        })
                        .join("")}</tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          `;
          calendarRoot.innerHTML = headerHtml + tableHtml;

          // 渲染後套用選取框（若同月）
          if (viewDate.getFullYear() === dt.getFullYear() && viewDate.getMonth() === dt.getMonth()) {
            const btnSel = calendarRoot.querySelector(`.roster-cal-day[data-day="${String(selectedDay)}"]`);
            if (btnSel) btnSel.closest("td")?.classList.add("selected");
          }

          // 日期按鈕事件：更新右側資訊與選取效果
          calendarRoot.addEventListener("click", (e) => {
            const btn = e.target.closest(".roster-cal-day");
            if (!btn) return;
            const day = btn.dataset.day;
            if (!day) return;
            // 更新選取框
            calendarRoot.querySelectorAll(".roster-cal-cell.selected").forEach((cell) => cell.classList.remove("selected"));
            btn.closest("td")?.classList.add("selected");
            const y = viewDate.getFullYear();
            const m = viewDate.getMonth();
            const d = new Date(y, m, parseInt(day, 10));
            selectedDay = d.getDate();
            const ymd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            const infoEl = document.getElementById("rosterInfo");
            if (infoEl) infoEl.textContent = `日期：${ymd}`;
          });
          const prevBtn = document.getElementById("rosterPrevMonth");
          const nextBtn = document.getElementById("rosterNextMonth");
          prevBtn?.addEventListener("click", () => {
            viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
            renderMonth(viewDate);
          });
          nextBtn?.addEventListener("click", () => {
            viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
            renderMonth(viewDate);
          });
          sel?.addEventListener("change", () => { renderMonth(viewDate); });
        }

        renderMonth(viewDate);
      }
    }
  }

  setActiveTab(activeMainTab);
  try { refreshSubtabBadges(); } catch {}

  // 內部功能：定位與打卡
  function initGeolocation() {
    if (!("geolocation" in navigator)) {
      if (locationInfo) locationInfo.textContent = "此裝置不支援定位";
      return;
    }
  navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (locationInfo) locationInfo.textContent = `目前位置：${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        // 記錄座標並更新首頁地圖（若在首頁）
        lastCoords = { latitude, longitude };
        updateHomeMap();
      },
      (err) => {
        if (locationInfo) locationInfo.textContent = `定位失敗：${err?.message || err}`;
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function doCheckin(user, role) {
    try {
      // 再次取得位置（若可）
      let lat, lng;
      if ("geolocation" in navigator) {
        await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              lat = pos.coords.latitude;
              lng = pos.coords.longitude;
              resolve();
            },
            () => resolve(),
            { enableHighAccuracy: true, timeout: 8000 }
          );
        });
      }

      const ref = fns.collection(db, "checkins");
      const docRef = await withRetry(() => fns.addDoc(ref, {
        uid: user.uid,
        name: user.displayName || user.email || "使用者",
        role,
        lat: lat ?? null,
        lng: lng ?? null,
        createdAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString(),
      }));
      if (checkinResult) checkinResult.textContent = `打卡成功：${docRef.id}`;
    } catch (err) {
      if (checkinResult) checkinResult.textContent = `打卡失敗：${err?.message || err}`;
    }
  }

// ===== 5) 事件綁定（即使首次載入尚未初始化，也能觸發） =====
// 以 REST 方式建立 Firebase Auth 帳號（不會切換目前登入狀態）
async function createAuthUserViaRest(email, password) {
  const apiKey = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) || null;
  if (!apiKey) throw new Error("缺少 Firebase apiKey");
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: false }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || "建立使用者失敗";
    throw new Error(msg);
  }
  return { uid: data.localId };
}
emailSignInBtn?.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    alert("請輸入電子郵件與密碼");
    return;
  }
  if (!isConfigReady()) {
    alert("尚未設定 Firebase 金鑰，請於 app.js 補齊。");
    return;
  }
  if (!auth || !fns.signInWithEmailAndPassword) {
    await ensureFirebase();
  }
  try {
    await fns.signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    alert(`登入失敗：${err?.message || err}`);
  }
});

// 已移除「初始化管理員」按鈕及其功能

// 啟動：若設定已就緒，先行初始化以載入使用者狀態
(async () => {
  if (isConfigReady()) {
    await ensureFirebase();
  }
})();
// 網路時間初始化
(async () => { try { await initNetworkTime(); } catch {} })();
(async () => { try { await ensureServiceWorker(); } catch {} })();
// 解除推播訂閱
(async () => {
  try {
    const reg = await (navigator.serviceWorker?.getRegistration?.() || Promise.resolve(null));
    if (reg && reg.pushManager && reg.pushManager.getSubscription) {
      const sub = await reg.pushManager.getSubscription();
      if (sub) { try { await sub.unsubscribe(); } catch {} }
    }
  } catch {}
})();
// 子分頁定義（頁中上）
const SUB_TABS = {
  home: [],
  checkin: ["紀錄", "請假", "計點"],
  leader: ["地圖", "紀錄", "請假", "計點", "補卡"],
  personnel: ["班表"],
  manage: ["總覽", "地圖", "記錄", "請假", "計點"],
  feature: ["公告", "文件", "工具"],
  settings: ["一般", "帳號", "社區", "外部", "角色", "規則", "系統", "推播"],
};

function ensureNotificationPermission() {
  return Promise.resolve(false);
}

function ensureServiceWorker() {
  try {
    if (!('serviceWorker' in navigator)) return Promise.resolve(false);
    return navigator.serviceWorker.getRegistration().then((r) => {
      if (r) return true;
      return navigator.serviceWorker.register('sw.js').then(() => true).catch(() => false);
    });
  } catch { return Promise.resolve(false); }
}

async function refreshSubtabBadges() {
  const btns = Array.from(subTabsEl.querySelectorAll('.subtab-btn'));
  if (activeMainTab === 'checkin') {
    for (const b of btns) { const badge = b.querySelector('.subtab-badge'); if (badge) badge.remove(); }
  }
  let leavePending = 0;
  let appealPending = 0;
  let makeupPending = 0;
  let changePending = 0;
  let leaveTw = 0, leaveTy = 0;
  let appealTw = 0, appealTy = 0;
  let makeupTw = 0, makeupTy = 0;
  let changeTw = 0, changeTy = 0;
  try {
    await ensureNetworkTime();
    await ensureFirebase();
    const u = auth?.currentUser || null;
    const role = String(appState.currentUserRole || '');
    const isAdmin = role === '系統管理員';
    const isManager = /主管|管理/.test(role);
    const canAll = isAdmin || isManager;
    if (db && fns.getDocs && fns.collection) {
      const companies = Array.isArray(appState.companies) ? appState.companies : [];
      const accounts = Array.isArray(appState.accounts) ? appState.accounts : [];
      const twCo = companies.find((c) => /台北/.test(String(c.name||''))) || null;
      const tyCo = companies.find((c) => /桃園/.test(String(c.name||''))) || null;
      const uidsByCo = (co) => {
        const ids0 = accounts.filter((a) => {
          const ids = Array.isArray(a.companyIds) ? a.companyIds : (a.companyId ? [a.companyId] : []);
          const idsS = ids.map((x) => String(x||'').trim());
          return co ? (idsS.includes(String(co.id)) || idsS.includes(String(co.name||''))) : false;
        }).map((a) => String(a.uid || a.id || '')).filter(Boolean);
        return new Set(ids0);
      };
      const twUids = uidsByCo(twCo);
      const tyUids = uidsByCo(tyCo);

      const qLeave = canAll
        ? fns.query(fns.collection(db, 'leaveRequests'), fns.where('status', '==', '送審'))
        : (u ? fns.query(fns.collection(db, 'leaveRequests'), fns.where('uid', '==', u.uid), fns.where('status', '==', '送審')) : null);
      if (qLeave) {
        const snap = await withRetry(() => fns.getDocs(qLeave));
        leavePending = snap.size || 0;
        const cloudLeavesSig = new Set();
        const normDate = (v) => { try { if (typeof v === 'string') { const d = new Date(v); return (d instanceof Date && !isNaN(d)) ? d.toISOString() : ''; } else if (v && typeof v.toDate === 'function') { const d = v.toDate(); return (d instanceof Date && !isNaN(d)) ? d.toISOString() : ''; } } catch {} return ''; };
        if (twUids.size || tyUids.size) {
          snap.forEach((doc) => { const d = doc.data() || {}; const uid = String(d.uid||''); const s = normDate(d.startAt); const e = normDate(d.endAt); const t = String(d.type||''); const r = String(d.reason||''); const key = `${uid}|${s}|${e}|${t}|${r}`; cloudLeavesSig.add(key); if (twUids.has(uid)) leaveTw += 1; else if (tyUids.has(uid)) leaveTy += 1; });
        }
        try {
          const raw = localStorage.getItem('pendingLeaves');
          const arr = raw ? JSON.parse(raw) : [];
          (Array.isArray(arr) ? arr : []).forEach((d) => {
            const uid = String(d.uid||'');
            if (!uid) return;
            const s = normDate(d.startAt);
            const e = normDate(d.endAt);
            const t = String(d.type||'');
            const r = String(d.reason||'');
            const key = `${uid}|${s}|${e}|${t}|${r}`;
            if (cloudLeavesSig.has(key)) return;
            leavePending += 1;
            if (twUids.has(uid)) leaveTw += 1; else if (tyUids.has(uid)) leaveTy += 1;
            cloudLeavesSig.add(key);
          });
        } catch {}
      }
      const qAppeal = canAll
        ? fns.query(fns.collection(db, 'pointAppeals'), fns.where('state', '==', '送審'))
        : (u ? fns.query(fns.collection(db, 'pointAppeals'), fns.where('uid', '==', u.uid), fns.where('state', '==', '送審')) : null);
      if (qAppeal) {
        const snap2 = await withRetry(() => fns.getDocs(qAppeal));
        appealPending = snap2.size || 0;
        if (twUids.size || tyUids.size) {
          snap2.forEach((doc) => { const d = doc.data() || {}; const uid = String(d.uid||''); if (twUids.has(uid)) appealTw += 1; else if (tyUids.has(uid)) appealTy += 1; });
        }
      }
      const qMakeup = canAll
        ? fns.query(fns.collection(db, 'makeupRequests'), fns.where('state', '==', '送審'))
        : (u ? fns.query(fns.collection(db, 'makeupRequests'), fns.where('uid', '==', u.uid), fns.where('state', '==', '送審')) : null);
      if (qMakeup) {
        const snap3 = await withRetry(() => fns.getDocs(qMakeup));
        makeupPending = snap3.size || 0;
        if (twUids.size || tyUids.size) {
          snap3.forEach((doc) => { const d = doc.data() || {}; const uid = String(d.uid||''); if (twUids.has(uid)) makeupTw += 1; else if (tyUids.has(uid)) makeupTy += 1; });
        }
      }
      const qChanges = canAll
        ? fns.query(fns.collection(db, 'changeRequests'), fns.where('state', '==', '送審'))
        : (u ? fns.query(fns.collection(db, 'changeRequests'), fns.where('uid', '==', u.uid), fns.where('state', '==', '送審')) : null);
      if (qChanges) {
        const snap4 = await withRetry(() => fns.getDocs(qChanges));
        changePending = snap4.size || 0;
        if (twUids.size || tyUids.size) {
          snap4.forEach((doc) => { const d = doc.data() || {}; const uid = String(d.uid||''); if (twUids.has(uid)) changeTw += 1; else if (tyUids.has(uid)) changeTy += 1; });
        }
      }
    }
  } catch {}
  const toNotify = [];
  for (const b of btns) {
    const label = b.dataset.subtab || '';
    const selectedCoId = appState.leaderCompanyFilter || '';
    const companies = Array.isArray(appState.companies) ? appState.companies : [];
    const selCo = companies.find((c) => String(c.id||'') === String(selectedCoId));
    const isLeader = (activeMainTab === 'leader');
    let num = 0;
    let badge = b.querySelector('.subtab-badge');
    if (activeMainTab === 'checkin') { if (badge) badge.remove(); continue; }
    if (label === '請假') {
      if (isLeader && selCo) {
        const isTw = /台北/.test(String(selCo.name||''));
        const isTy = /桃園/.test(String(selCo.name||''));
        num = isTw ? leaveTw : (isTy ? leaveTy : leavePending);
      } else {
        num = leavePending;
      }
    } else if (label === '計點') {
      if (isLeader && selCo) {
        const isTw = /台北/.test(String(selCo.name||''));
        const isTy = /桃園/.test(String(selCo.name||''));
        num = isTw ? appealTw : (isTy ? appealTy : appealPending);
      } else {
        num = appealPending;
      }
    } else if (label === '補卡') {
      if (isLeader && selCo) {
        const isTw = /台北/.test(String(selCo.name||''));
        const isTy = /桃園/.test(String(selCo.name||''));
        num = isTw ? makeupTw : (isTy ? makeupTy : makeupPending);
      } else {
        num = makeupPending;
      }
    } else if (label === '紀錄') {
      if (isLeader && selCo) {
        const isTw = /台北/.test(String(selCo.name||''));
        const isTy = /桃園/.test(String(selCo.name||''));
        num = isTw ? changeTw : (isTy ? changeTy : changePending);
      } else {
        num = changePending;
      }
    }
    const count = Number(num) || 0;
    const prevKey = label + ':' + (isLeader && selCo ? String(selCo.id||'') : 'all');
    const prevCounts = appState.badgesPrev || (appState.badgesPrev = {});
    if (!count) { if (badge) badge.remove(); prevCounts[prevKey] = 0; continue; }
    if (!badge) { badge = document.createElement('span'); badge.className = 'subtab-badge'; b.appendChild(badge); }
    badge.textContent = String(num);
    const prev = Number(prevCounts[prevKey] || 0);
    if (count > 0 && count !== prev) { toNotify.push({ label, count }); }
    prevCounts[prevKey] = count;
  }
  try {
    const leaderTabBtn = document.querySelector('.tab-btn[data-tab="leader"]');
    if (leaderTabBtn) {
      const recordTw = Number(changeTw || 0);
      const recordTy = Number(changeTy || 0);
      let badge = leaderTabBtn.querySelector('.subtab-badge');
      if (recordTw > 0 || recordTy > 0) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'subtab-badge'; leaderTabBtn.appendChild(badge); }
        badge.textContent = `台北${recordTw}|桃園${recordTy}`;
        const tip = `紀錄 台北:${recordTw} 桃園:${recordTy}`;
        badge.title = tip;
        badge.setAttribute('aria-label', tip);
      } else {
        const companies2 = Array.isArray(appState.companies) ? appState.companies : [];
        const selectedCoId2 = appState.leaderCompanyFilter || '';
        const selCo2 = companies2.find((c) => String(c.id||'') === String(selectedCoId2)) || null;
        const isTw2 = selCo2 ? /台北/.test(String(selCo2.name||'')) : false;
        const isTy2 = selCo2 ? /桃園/.test(String(selCo2.name||'')) : false;
        const leaveCount2 = selCo2 ? (isTw2 ? leaveTw : (isTy2 ? leaveTy : leavePending)) : 0;
        const appealCount2 = selCo2 ? (isTw2 ? appealTw : (isTy2 ? appealTy : appealPending)) : 0;
        const makeupCount2 = selCo2 ? (isTw2 ? makeupTw : (isTy2 ? makeupTy : makeupPending)) : 0;
        const totalPending = Number(leaveCount2 || 0) + Number(appealCount2 || 0) + Number(makeupCount2 || 0);
        const hasMapAnomaly = !!document.querySelector('#leaderStatusTbody .status-flag.bad');
        if (!totalPending && !hasMapAnomaly) { if (badge) badge.remove(); }
        else {
          if (!badge) { badge = document.createElement('span'); badge.className = 'subtab-badge'; leaderTabBtn.appendChild(badge); }
          badge.textContent = totalPending > 0 ? String(totalPending) : '';
          const breakdown = `請假:${Number(leaveCount2||0)} 計點:${Number(appealCount2||0)} 補卡:${Number(makeupCount2||0)}`;
          const tip = totalPending > 0 ? breakdown : '地圖異常';
          badge.title = tip;
          badge.setAttribute('aria-label', tip);
        }
      }
    }
  } catch {}
  if (toNotify.length) {}
}

let activeSubTab = null;
// ===== 首頁狀態切換（F–K） =====
function setHomeStatus(key, label) {
  const classes = [
    "status-work",
    "status-off",
    "status-out",
    "status-arrive",
    "status-leave",
    "status-return",
    "status-leave-request",
  ];
  document.body.classList.remove(...classes);
  document.body.classList.add(`status-${key}`);
  if (homeStatusEl) {
    const t = label || "";
    const base = String(t).split('-')[0];
    const cls = (() => {
      switch (base) {
        case "上班": return "work";
        case "下班": return "off";
        case "外出": return "out";
        case "抵達": return "arrive";
        case "離開": return "leave";
        case "返回": return "return";
        default: return "";
      }
    })();
    homeStatusEl.innerHTML = `<span class="status-label ${cls}">${t}</span>`;
  }
}

btnStart?.addEventListener("click", async () => {
  const type = await openCheckinTypeSelector();
  if (!type) return;
  if (type === "work") {
    await startCheckinFlow("work", "上班");
  } else if (type === "out") {
    await startCheckinFlow("out", "外出");
  }
});

// ===== 上班打卡完整流程（位置 → 地圖 → 自拍 → 儲存） =====
async function startCheckinFlow(statusKey = "work", statusLabel = "上班") {
  try {
    try { await ensureNetworkTime(); } catch {}
    if (navigator.onLine === false) { alert('無網路，打卡失敗'); return; }
    const userRole = appState.currentUserRole || "保全";
    const adminRoles = new Set(["系統管理員", "管理層", "高階主管", "初階主管", "行政"]);
    const staffRoles = new Set(["總幹事", "秘書", "清潔", "機電", "保全"]);
    let options = [];
    let sourceType = "company";
    const uid = appState.currentUserId || null;
    const userAccount = uid ? (appState.accounts.find((a) => a.id === uid) || null) : null;
    const isOut = statusKey === "out";
    const isOutFollow = statusKey === "arrive" || statusKey === "leave";
    if (isOut) {
      const allowedCommunityIds = (userAccount && Array.isArray(userAccount.serviceCommunities)) ? new Set(userAccount.serviceCommunities) : null;
      let communities = [];
      if (staffRoles.has(userRole)) {
        if (allowedCommunityIds && allowedCommunityIds.size > 0) {
          communities = appState.communities.filter((c) => allowedCommunityIds.has(c.id));
        } else {
          communities = [];
        }
      } else {
        if (allowedCommunityIds && allowedCommunityIds.size > 0) {
          communities = appState.communities.filter((c) => allowedCommunityIds.has(c.id));
        } else if (userAccount && Array.isArray(userAccount.companyIds) && userAccount.companyIds.length > 0) {
          const coSet = new Set(userAccount.companyIds);
          communities = appState.communities.filter((c) => coSet.has(c.companyId));
        } else if (userAccount?.companyId) {
          communities = appState.communities.filter((c) => c.companyId === userAccount.companyId);
        } else {
          communities = appState.communities.slice();
        }
      }
      communities = communities.slice().sort((a,b)=>{
        const ao = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
        const bo = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return String(a.name||"").localeCompare(String(b.name||""), "zh-Hant");
      });
      options = communities.map((c) => ({ value: c.id, label: c.name }));
      sourceType = "community";
    } else {
      if (adminRoles.has(userRole)) {
        if (userAccount && Array.isArray(userAccount.companyIds) && userAccount.companyIds.length > 0) {
          const set = new Set(userAccount.companyIds);
          const list = appState.companies.filter((c) => set.has(c.id)).slice().sort((a,b)=>{
            const ao = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
            const bo = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
            if (ao !== bo) return ao - bo;
            return String(a.name||"").localeCompare(String(b.name||""), "zh-Hant");
          });
          options = list.map((c) => ({ value: c.id, label: c.name }));
        } else if (userAccount?.companyId) {
          const co = appState.companies.find((c) => c.id === userAccount.companyId) || null;
          options = co ? [{ value: co.id, label: co.name }] : [];
        }
        if (!options.length) options = optionList(appState.companies);
        sourceType = "company";
      } else {
        const allowedCommunityIds = (userAccount && Array.isArray(userAccount.serviceCommunities)) ? new Set(userAccount.serviceCommunities) : null;
        let communities = [];
        if (staffRoles.has(userRole)) {
          if (allowedCommunityIds && allowedCommunityIds.size > 0) {
            communities = appState.communities.filter((c) => allowedCommunityIds.has(c.id));
          } else {
            communities = [];
          }
        } else {
          if (allowedCommunityIds && allowedCommunityIds.size > 0) {
            communities = appState.communities.filter((c) => allowedCommunityIds.has(c.id));
          } else if (userAccount && Array.isArray(userAccount.companyIds) && userAccount.companyIds.length > 0) {
            const coSet = new Set(userAccount.companyIds);
            communities = appState.communities.filter((c) => coSet.has(c.companyId));
          } else if (userAccount?.companyId) {
            communities = appState.communities.filter((c) => c.companyId === userAccount.companyId);
          } else {
            communities = appState.communities.slice();
          }
        }
        communities = communities.slice().sort((a,b)=>{
          const ao = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
          const bo = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return String(a.name||"").localeCompare(String(b.name||""), "zh-Hant");
        });
        options = communities.map((c) => ({ value: c.id, label: c.name }));
        sourceType = "community";
      }
    }

    let selectedLocation = null;
    if (isOutFollow) {
      const cur = getCurrentOutTrip(uid);
      if (!cur) { alert("尚未記錄外出，無法進行此打卡"); return; }
      selectedLocation = cur;
    } else {
      if (staffRoles.has(userRole) && options.length === 0) { alert("此帳號尚未設定服務社區，請聯絡管理員"); return; }
      const selectedLocationPromise = new Promise((resolve) => {
      const reasonOptions = [
        { value: '督察', label: '督察' },
        { value: '例會', label: '例會' },
        { value: '區大', label: '區大' },
        { value: '臨時會', label: '臨時會' },
        { value: '簡報', label: '簡報' },
        { value: '其他', label: '其他(自定義)' },
      ];
      const fields = [];
      if (isOut) {
        fields.push({ key: 'placeMode', label: '地點來源', type: 'select', options: [ { value: 'list', label: '服務社區清單' }, { value: 'custom', label: '自填地點' } ] });
        fields.push({ key: 'placeSelect', label: '打卡位置', type: 'select', options: options });
        fields.push({ key: 'placeInput', label: '打卡位置', type: 'text', placeholder: '請輸入地點名稱' });
        fields.push({ key: 'reason', label: '事由', type: 'select', options: reasonOptions });
        fields.push({ key: 'reasonOther', label: '自定義事由', type: 'text' });
      } else {
        fields.push({ key: 'place', label: '打卡位置', type: 'select', options: options });
      }
      openModal({
        title: '選擇打卡位置',
        fields,
        submitText: '確認',
        onSubmit: async (data) => {
          let item = null;
          let outReason = '';
          if (isOut) {
            const mode = String(data.placeMode || 'list');
            if (String(data.reason || '') === '其他') outReason = String(data.reasonOther || ''); else outReason = String(data.reason || '');
            if (mode === 'custom') {
              const name = String(data.placeInput || '').trim();
              if (!name) { alert('請輸入地點名稱'); return false; }
              item = { id: null, type: 'custom', name, coords: '', address: '', radiusMeters: null, reason: outReason };
            } else {
              const id = String(data.placeSelect || '');
              item = appState.communities.find((c) => c.id === id) || null;
              if (!item) { alert('無法識別選擇的位置'); return false; }
              item = { id: item.id, type: 'community', name: item.name || '', coords: item.coords || '', address: item.address || '', radiusMeters: item.radiusMeters ?? null, reason: outReason };
            }
          } else {
            const id = data.place;
            if (sourceType === 'company') {
              item = appState.companies.find((c) => c.id === id) || null;
            } else {
              item = appState.communities.find((c) => c.id === id) || null;
            }
            if (!item) { alert('無法識別選擇的位置'); return false; }
            item = { id: item.id, type: sourceType, name: item.name || '', coords: item.coords || '', address: item.address || '', radiusMeters: item.radiusMeters ?? null };
          }
          resolve(item);
          return true;
        },
        afterRender: ({ body }) => {
          if (!isOut) return;
          const modeSel = body.querySelector('[data-key="placeMode"]');
          const selRow = body.querySelector('[data-key="placeSelect"]')?.parentElement;
          const inputRow = body.querySelector('[data-key="placeInput"]')?.parentElement;
          const reasonSel = body.querySelector('[data-key="reason"]');
          const reasonOtherRow = body.querySelector('[data-key="reasonOther"]')?.parentElement;
          const toggleMode = () => { const v = modeSel?.value || 'list'; if (selRow) selRow.style.display = (v === 'list') ? '' : 'none'; if (inputRow) inputRow.style.display = (v === 'custom') ? '' : 'none'; };
          const toggleReason = () => { const v = reasonSel?.value || ''; if (reasonOtherRow) reasonOtherRow.style.display = (v === '其他') ? '' : 'none'; };
          toggleMode(); toggleReason();
          modeSel?.addEventListener('change', toggleMode);
          reasonSel?.addEventListener('change', toggleReason);
        },
      });
      const cancelBtn = modalRoot?.querySelector('.modal-footer .btn:not(.btn-primary)');
      cancelBtn?.addEventListener('click', () => resolve(null));
    });
    selectedLocation = await selectedLocationPromise;
    if (!selectedLocation) return;
    }

    if (isOut) { try { setCurrentOutTrip(uid, selectedLocation); } catch {} }

    // 2) 地圖定位檢視（顯示目前位置與打卡範圍），並取得目前位置座標
    const viewerRes = await openCheckinMapViewer({
      targetName: selectedLocation.name,
      targetCoords: selectedLocation.coords || "",
      targetRadius: selectedLocation.radiusMeters ?? 100,
    });
    if (!viewerRes) return; // 使用者取消
    const lat = viewerRes?.lat; const lng = viewerRes?.lng; const inRadius = !!viewerRes?.inRadius;
    const hasCoords = typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng);

    let photoDataUrl = null;
    {
      // 3) 自拍與留言（浮水印三列）
      // 保證前一個視窗完全關閉，再開啟自拍視窗（避免堆疊競態）
      await new Promise((r) => requestAnimationFrame(r));
      photoDataUrl = await new Promise((resolve) => {
        let captured = null;
        openModal({
          title: "自拍打卡",
          fields: [],
          submitText: "確認",
          refreshOnSubmit: false,
          onSubmit: async () => {
            if (!captured) { alert("請先拍照"); return false; }
            const msg = "";
            try {
              const img = new Image();
              img.src = captured;
              await new Promise((r) => { img.onload = r; img.onerror = r; });
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth || 1080;
              canvas.height = img.naturalHeight || 1440;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              const pad = Math.floor(canvas.height * 0.02);
              ctx.fillStyle = 'rgba(0,0,0,0.35)';
              ctx.fillRect(0, canvas.height - pad*7, canvas.width, pad*7);
              ctx.fillStyle = '#ffffff';
              ctx.font = `${Math.max(16, Math.floor(canvas.height*0.03))}px sans-serif`;
              ctx.textBaseline = 'top';
              const now = nowInTZ('Asia/Taipei');
              const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
              const nameElText = (homeHeaderNameEl?.textContent || '').replace(/^歡迎~\s*/, '');
              const line1 = `${dateStr} ${nameElText || '使用者'}`;
              const line2 = `${hasCoords ? `${lat.toFixed(6)},${lng.toFixed(6)}` : '座標未知'} ${statusLabel} ${inRadius ? '正常' : '異常'}`;
              const line3 = '';
              const x = pad; let y = canvas.height - pad*6.5;
              ctx.fillText(line1, x, y); y += pad*2.2;
              ctx.fillText(line2, x, y); y += pad*2.2;
              ctx.fillText(line3, x, y);
              const out = canvas.toDataURL('image/jpeg', 0.92);
              resolve({ photo: out, message: msg });
              return true;
            } catch (e) {
              // 失敗時改用原始照片直接送出，避免阻塞打卡
              resolve({ photo: captured, message: msg });
              return true;
            }
          },
          afterRender: async ({ body }) => {
            try { const modalEl = body?.parentElement; if (modalEl) { modalEl.style.height = '90vh'; modalEl.style.maxHeight = '90vh'; } } catch {}
            try { const footerEl = modalRoot?.querySelector('.modal-footer'); if (footerEl) footerEl.remove(); } catch {}
            const video = document.createElement('video');
            video.autoplay = true; video.playsInline = true; video.muted = true;
            video.style.width = '100%';
            video.style.height = '';
            video.style.aspectRatio = '4 / 6';
            video.style.objectFit = 'cover';
            video.style.background = '#000';
            video.style.borderRadius = '0';
            const controls = document.createElement('div');
            controls.style.display = 'flex';
            controls.style.justifyContent = 'center';
            controls.style.marginTop = '12px';
            const btnSnap = document.createElement('button'); btnSnap.className = 'btn btn-green'; btnSnap.setAttribute('aria-label','拍照'); attachPressInteractions(btnSnap);
            btnSnap.style.width = '70%';
            btnSnap.style.display = 'flex';
            btnSnap.style.alignItems = 'center';
            btnSnap.style.justifyContent = 'center';
            btnSnap.style.gap = '8px';
            btnSnap.style.borderRadius = '0';
            btnSnap.style.fontSize = '0';
            btnSnap.innerHTML = `
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="color: currentColor;">
                <rect x="4" y="7" width="16" height="12" rx="2" stroke="currentColor" stroke-width="2" />
                <path d="M9 7l1.5-2h3L15 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                <circle cx="12" cy="13" r="3.5" stroke="currentColor" stroke-width="2" />
              </svg>`;
            
            body.appendChild(video);
            body.appendChild(controls);
            const submitBtn = null;
            let stream = null;
            try {
              const leaderRoles = new Set(['系統管理員','管理層','高階主管','初階主管','行政']);
              const role = appState.currentUserRole || '一般';
              let facing = leaderRoles.has(role) ? 'environment' : 'user';
              const startStream = async () => {
                try {
                  if (stream) { try { stream.getTracks()?.forEach((t)=>t.stop()); } catch {} }
                  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
                  video.srcObject = stream;
                } catch (err) {
                  const msg = `無法啟用相機：${err?.message || err}`;
                  const warn = document.createElement('div'); warn.textContent = msg; warn.style.color = '#b00020'; warn.style.marginTop = '8px'; body.appendChild(warn);
                }
              };
              await startStream();
              if (leaderRoles.has(role)) {
                const btnToggle = document.createElement('button');
                btnToggle.className = 'btn btn-darkgrey';
                btnToggle.textContent = '切換鏡頭';
                btnToggle.style.borderRadius = '0';
                btnToggle.style.marginLeft = '8px';
                attachPressInteractions(btnToggle);
                controls.appendChild(btnToggle);
                controls.appendChild(btnSnap);
                btnToggle.addEventListener('click', async () => { facing = (facing === 'environment') ? 'user' : 'environment'; await startStream(); });
              } else {
                controls.appendChild(btnSnap);
              }
            } catch (err) {
              const msg = `無法啟用相機：${err?.message || err}`;
              const warn = document.createElement('div'); warn.textContent = msg; warn.style.color = '#b00020'; warn.style.marginTop = '8px'; body.appendChild(warn);
            }
            btnSnap.addEventListener('click', async () => {
              try {
                const track = stream?.getVideoTracks?.()[0];
                const settings = track?.getSettings?.() || {};
                const desiredRatio = 4/6;
                const sw = Math.max(1, video.videoWidth || settings.width || 1280);
                const sh = Math.max(1, video.videoHeight || settings.height || 720);
                const srcRatio = sw / sh;
                let sx = 0, sy = 0, sWidth = sw, sHeight = sh;
                if (srcRatio > desiredRatio) { sWidth = Math.floor(sh * desiredRatio); sx = Math.floor((sw - sWidth) / 2); }
                else if (srcRatio < desiredRatio) { sHeight = Math.floor(sw / desiredRatio); sy = Math.floor((sh - sHeight) / 2); }
                const tw = sWidth; const th = sHeight;
                const canvas = document.createElement('canvas'); canvas.width = tw; canvas.height = th;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, tw, th);
                try {
                  const pad = Math.floor(th * 0.02);
                  ctx.fillStyle = 'rgba(0,0,0,0.35)';
                  const barH = Math.max(pad * 3, 28);
                  ctx.fillRect(0, th - barH, tw, barH);
                  ctx.fillStyle = '#ffffff';
                  ctx.textBaseline = 'middle';
                  let fontSize = Math.max(12, Math.floor(th * 0.025));
                  const now = nowInTZ('Asia/Taipei');
                  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
                  const nameElText = (homeHeaderNameEl?.textContent || '').replace(/^歡迎~\s*/, '') || '使用者';
                  const locStr = (typeof lat === 'number' && typeof lng === 'number') ? `${lat.toFixed(6)},${lng.toFixed(6)}` : '座標未知';
                  const statusStr = `${statusLabel} ${inRadius ? '正常' : '異常'}`;
                  const line = `${dateStr} ${nameElText} ${locStr} ${statusStr}`;
                  // 動態縮放字體以符合寬度
                  const fit = () => {
                    ctx.font = `${fontSize}px sans-serif`;
                    let w = ctx.measureText(line).width;
                    const maxW = tw - pad * 2;
                    while (w > maxW && fontSize > 10) { fontSize -= 1; ctx.font = `${fontSize}px sans-serif`; w = ctx.measureText(line).width; }
                  };
                  fit();
                  const x = pad; const y = th - Math.floor(barH / 2);
                  ctx.fillText(line, x, y);
                } catch {}
                const out = canvas.toDataURL('image/jpeg', 0.92);
                captured = out;
                try { stream?.getTracks?.().forEach((t) => t.stop()); } catch {}
                video.srcObject = null; try { video.pause?.(); } catch {}
                stream = null;
                resolve({ photo: out, message: '' });
                closeModal();
              } catch (e) { alert(`拍照失敗：${e?.message || e}`); }
            });
          },
        });
        const cancelBtn = modalRoot?.querySelector('.modal-footer .btn:not(.btn-primary)');
        cancelBtn?.addEventListener('click', () => resolve(null));
        const xBtn = modalRoot?.querySelector('.modal-header .modal-close');
        xBtn?.addEventListener('click', () => resolve(null));
      });
      if (!photoDataUrl) return; // 使用者取消
    }

// 4) 寫入 Firestore 並更新首頁 F 列摘要
try {
  await ensureFirebase();
  // 先更新/建立裝置型號對照
  try { setDeviceModelCache(getDeviceId(), getLocalDeviceModel()); } catch {}
  const user = auth?.currentUser || null;
  const role = appState.currentUserRole || "一般";
      const payload = {
        uid: user?.uid || null,
        name: (homeHeaderNameEl?.textContent || '').replace(/^歡迎~\s*/, '') || (user?.email || '使用者'),
        role,
        status: statusLabel,
        locationType: selectedLocation.type,
        locationId: selectedLocation.id,
        locationName: selectedLocation.name,
        lat: hasCoords ? lat : null,
        lng: hasCoords ? lng : null,
        inRadius,
        message: photoDataUrl.message || "",
        photoData: photoDataUrl.photo,
        deviceId: getDeviceId(),
        deviceModel: getLocalDeviceModel(),
        createdAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString(),
      };
      if ((statusKey === 'out' || statusKey === 'arrive' || statusKey === 'leave') && selectedLocation && selectedLocation.reason) { payload.reason = selectedLocation.reason; }
      let saved = false;
      if (db && fns.addDoc && fns.collection) {
        try { await withRetry(() => fns.addDoc(fns.collection(db, "checkins"), payload)); saved = true; } catch {}
      }
      if (!saved) {
        alert('打卡失敗：請確認網路連線或稍後重試');
        return;
      }
      // 更新首頁 G 列摘要，並移除 F 列顯示
      const gRow = document.querySelector('.row-g');
      const fRow = document.querySelector('.row-f');
      const now = nowInTZ('Asia/Taipei');
      const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
      // 不清空 row-g，避免移除 #homeStatus 元素
      if (fRow) {
        fRow.textContent = '';
        fRow.classList.add('hidden');
      }
      const reasonText = ((statusKey === 'out' || statusKey === 'arrive' || statusKey === 'leave') && selectedLocation && selectedLocation.reason) ? `-${selectedLocation.reason}` : '';
      setHomeStatus(statusKey, `${statusLabel}${reasonText}`);
      const summary = `${dateStr} ${selectedLocation.name} ${statusLabel}${reasonText} ${inRadius ? '正常' : '異常'}`;
      if (homeStatusEl) renderHomeStatusText(summary);
      try { const u = auth?.currentUser; if (u?.uid) setLastCheckin(u.uid, { summary, key: statusKey, label: `${statusLabel}${reasonText}` }); } catch {}
  try { alert('您已完成打卡'); const u2 = new SpeechSynthesisUtterance('您已完成打卡'); u2.lang = 'zh-TW'; window.speechSynthesis?.speak(u2); } catch {}
  try { setActiveTab('home'); } catch {}
  try { document.querySelectorAll('.modal').forEach((m) => m.remove()); } catch {}
  try { if (modalRoot) { modalRoot.classList.add('hidden'); modalRoot.innerHTML = ''; } } catch {}
} catch (err) {
  try { alert('您已完成打卡'); const u3 = new SpeechSynthesisUtterance('您已完成打卡'); u3.lang = 'zh-TW'; window.speechSynthesis?.speak(u3); } catch {}
  try { setActiveTab('home'); } catch {}
  try { document.querySelectorAll('.modal').forEach((m) => m.remove()); } catch {}
  try { if (modalRoot) { modalRoot.classList.add('hidden'); modalRoot.innerHTML = ''; } } catch {}
}
  } catch (err) {
    alert(`打卡流程錯誤：${err?.message || err}`);
  }
}

// 將「上班」按鈕改為啟動完整打卡流程
btnStart?.removeEventListener("click", () => setHomeStatus("work", "上班"));
 btnStart?.addEventListener("click", async () => {
  const type = await openCheckinTypeSelector();
  if (!type) return;
  const mapKeyToLabel = (k) => {
    switch (k) {
      case 'work': return '上班';
      case 'off': return '下班';
      case 'out': return '外出';
      case 'arrive': return '抵達';
      case 'leave': return '離開';
      case 'return': return '返回';
      default: return '上班';
    }
  };
  await startCheckinFlow(type, mapKeyToLabel(type));
});
  // 打卡分頁內容渲染（子分頁）
  function renderCheckinContent(label) {
    const container = document.getElementById("checkinContent");
    if (!container) return;
    container.innerHTML = "";
    if (label === "紀錄") {
      if (isLoadingCheckins) return;
      (async () => {
        try {
          await ensureFirebase();
          const user = auth?.currentUser || null;
          if (!user) { container.textContent = "請先登入"; return; }
          const ref = fns.collection(db, "checkins");
          const q2 = fns.query(ref, fns.where("uid", "==", user.uid));
          isLoadingCheckins = true;
          const snap = await withRetry(() => fns.getDocs(q2));
        const tzNow = nowInTZ('Asia/Taipei');
        const list = [];
        snap.forEach((doc) => {
          try {
            const data = doc.data() || {};
            const created = data.createdAt;
            let dt = null;
            if (created && typeof created.toDate === 'function') dt = created.toDate();
            else if (typeof created === 'string') dt = new Date(created);
            if (!(dt instanceof Date) || isNaN(dt)) return;
            list.push({ id: doc.id, ...data, dt });
          } catch {}
        });
          // 預先取得裝置型號對照（避免顯示未知裝置）
          const deviceIds = Array.from(new Set(list.map((r) => r.deviceId).filter((x) => !!x)));
          const deviceModelsMap = new Map();
          if (deviceIds.length && db && fns.getDoc && fns.doc) {
            await Promise.all(deviceIds.map(async (id) => {
              try {
                const ds = await withRetry(() => fns.getDoc(fns.doc(db, 'devices', id)));
                if (ds.exists()) {
                  const dvm = ds.data();
                  const name = String(dvm.model || dvm.name || '').trim();
                  if (name) deviceModelsMap.set(id, name);
                }
              } catch {}
            }));
          }
          const todayYmd = `${tzNow.getFullYear()}-${String(tzNow.getMonth()+1).padStart(2,'0')}-${String(tzNow.getDate()).padStart(2,'0')}`;
          container.innerHTML = `
            <div class="roster-datebar">
              <label for="recordDate"></label>
              <input id="recordDate" type="date" class="input" />
            </div>
            <div id="recordList"></div>
          `;
            const dateInput = container.querySelector('#recordDate');
            const listRoot = container.querySelector('#recordList');
            if (!listRoot || !dateInput) { isLoadingCheckins = false; return; }
          dateInput.value = todayYmd;
          function renderForDate(ymdStr) {
            const parts = String(ymdStr || '').split('-');
            if (parts.length !== 3) return;
            const y = Number(parts[0]);
            const m = Number(parts[1]) - 1;
            const d = Number(parts[2]);
            const d0 = new Date(y, m, d);
            const d1 = new Date(d0); d1.setDate(d0.getDate() + 1);
            const dayList = list.filter((r) => r.dt >= d0 && r.dt < d1).sort((a, b) => b.dt - a.dt).slice(0, 50);
            listRoot.innerHTML = '';
            if (!dayList.length) { listRoot.textContent = '該日無打卡紀錄'; return; }
            dayList.forEach((r) => {
              const card = document.createElement('div');
              card.className = 'record-card';
              card.style.display = 'grid';
              card.style.gridTemplateColumns = '1fr';
              card.style.gap = '8px';
              const status = document.createElement('div');
              const stRaw = r.status || '';
              const baseSt = String(stRaw).split('-')[0];
              const stCls = (() => {
                switch (baseSt) {
                  case '上班': return 'work';
                  case '下班': return 'off';
                  case '外出': return 'out';
                  case '抵達': return 'arrive';
                  case '離開': return 'leave';
                  case '返回': return 'return';
                  default: return '';
                }
              })();
              const place = r.locationName || '未知地點';
              const flagHtml = (() => {
                const st = String(r.status||'');
                const baseSt = st.split('-')[0];
                const i = st.indexOf('-');
                const reason = i >= 0 ? st.slice(i+1) : '';
                if ((baseSt === '外出' || baseSt === '抵達' || baseSt === '離開') && reason) {
                  const rules = Array.isArray(appState.pointsRules) ? appState.pointsRules : [];
                  const match = rules.find((x) => String(x.reason||'') === String(reason));
                  const abnormal = match && String(match.status||'') === '異常';
                  return abnormal ? ` <span class="status-flag bad">異常-${reason}</span>` : ' <span class="status-flag good">正常</span>';
                }
                return r.inRadius === true ? ' <span class="status-flag good">正常</span>' : ' <span class="status-flag bad">異常</span>';
              })();
              const stDisplay = (() => {
                const reason = r.reason || '';
                if ((baseSt === '外出' || baseSt === '抵達' || baseSt === '離開') && reason) return `${baseSt}-${reason}`;
                return stRaw || baseSt;
              })();
              const nameText = r.name || '使用者';
              status.innerHTML = `${nameText} 打卡地點：<span class="status-label ${stCls}">${place}</span> 狀態：<span class="status-label ${stCls}">${stDisplay}</span>${flagHtml}`;
              const dtStr = formatDateTimeTZ(r.dt, 'Asia/Taipei');
              const when = document.createElement('div');
              when.textContent = `時間：${dtStr}`;
              const devCode = r.deviceId ? String(r.deviceId) : '';
              const fallbackShort = (devCode ? `裝置-${devCode.slice(-6)}` : '裝置');
              const modelText = r.deviceModel || deviceModelsMap.get(r.deviceId) || getDeviceModelCache(r.deviceId) || fallbackShort;
              const deviceLabel = devCode || modelText;
              status.innerHTML += ` <span class="muted">裝置：${deviceLabel}</span>`;
              card.appendChild(status);
              card.appendChild(when);
              const mapBtn = document.createElement('button');
              mapBtn.className = 'btn btn-blue';
              mapBtn.type = 'button';
              mapBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right:6px;"><path d="M12 2c-3.866 0-7 3.134-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.866-3.134-7-7-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="9" r="2" stroke="currentColor" stroke-width="2"/></svg>地圖`;
              mapBtn.style.borderRadius = '0';
              mapBtn.style.padding = '4px 8px';
              mapBtn.style.minHeight = '30px';
              attachPressInteractions(mapBtn);
              mapBtn.disabled = !(typeof r.lat === 'number' && typeof r.lng === 'number');
              mapBtn.title = mapBtn.disabled ? '座標未知' : '';
              mapBtn.addEventListener('click', () => {
                if (mapBtn.disabled) return;
                const lat = Number(r.lat).toFixed(6);
                const lon = Number(r.lng).toFixed(6);
                openModal({
                  title: '定位地圖',
                  fields: [],
                  submitText: '關閉',
                  refreshOnSubmit: false,
                  onSubmit: async () => true,
                  afterRender: async ({ body }) => {
                    try {
                      const maps = await ensureGoogleMaps();
                      const box = document.createElement('div');
                      box.style.width = '100%';
                      box.style.height = '65vh';
                      box.style.borderRadius = '8px';
                      body.appendChild(box);
                      const center = { lat: parseFloat(lat), lng: parseFloat(lon) };
                      const map = new maps.Map(box, { center, zoom: 18, gestureHandling: 'greedy' });
                      new maps.Marker({ position: center, map, draggable: false, title: '目前位置' });
                      const txt = document.createElement('div'); txt.textContent = `座標：${lat}, ${lon}`; txt.className = 'muted'; txt.style.marginTop = '8px';
                      body.appendChild(txt);
                    } catch {
                      const txt = document.createElement('div'); txt.textContent = `座標：${lat}, ${lon}`; txt.className = 'muted'; txt.style.marginTop = '8px';
                      body.appendChild(txt);
                    }
                  }
                });
              });

              const photoBtn = document.createElement('button');
              photoBtn.className = 'btn btn-green';
              photoBtn.type = 'button';
              photoBtn.innerHTML = `<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" style=\"margin-right:6px;\"><rect x=\"4\" y=\"7\" width=\"16\" height=\"12\" rx=\"2\" stroke=\"currentColor\" stroke-width=\"2\" /><path d=\"M9 7l1.5-2h3L15 7\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" /><circle cx=\"12\" cy=\"13\" r=\"3.5\" stroke=\"currentColor\" stroke-width=\"2\" /></svg>照片`;
              photoBtn.style.borderRadius = '0';
              photoBtn.style.padding = '4px 8px';
              photoBtn.style.minHeight = '30px';
              attachPressInteractions(photoBtn);
              photoBtn.disabled = !r.photoData;
              photoBtn.title = photoBtn.disabled ? '無照片' : '';
              photoBtn.addEventListener('click', () => {
                if (photoBtn.disabled) return;
                openModal({
                  title: '打卡照片',
                  fields: [],
                  submitText: '關閉',
                  refreshOnSubmit: false,
                  onSubmit: async () => true,
                  afterRender: ({ body }) => {
                    const img = document.createElement('img');
                    img.src = r.photoData; img.alt = '打卡照片'; img.style.width = '100%'; img.style.height = 'auto'; img.style.borderRadius = '8px';
                    body.appendChild(img);
                  }
                });
              });

              const modifyBtn = document.createElement('button');
              modifyBtn.className = 'btn btn-orange';
              modifyBtn.type = 'button';
              modifyBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right:6px;"><path d="M4 20h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 4l6 6-9 9H5v-6l9-9Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>申請修改`;
              modifyBtn.style.borderRadius = '0';
              modifyBtn.style.padding = '4px 8px';
              modifyBtn.style.minHeight = '30px';
              attachPressInteractions(modifyBtn);
              modifyBtn.addEventListener('click', () => {
                const dtStr2 = formatDatetimeLocalTZ(r.dt, 'Asia/Taipei');
                const statusOptions = [
                  { value: '上班', label: '上班' },
                  { value: '下班', label: '下班' },
                  { value: '外出', label: '外出' },
                  { value: '抵達', label: '抵達' },
                  { value: '離開', label: '離開' },
                  { value: '返回', label: '返回' },
                ];
                  openModal({
                    title: '申請修改打卡紀錄',
                    fields: [
                      { key: 'place', label: '打卡位置', type: 'text' },
                      { key: 'status', label: '狀態', type: 'select', options: statusOptions },
                      { key: 'datetime', label: '日期時間', type: 'datetime-local', step: 60 },
                    ],
                    initial: { place: r.locationName || '', status: r.status || '上班', datetime: dtStr2 },
                    submitText: '送出申請',
                    refreshOnSubmit: false,
                    onSubmit: async (data) => {
                    try {
                      await ensureFirebase();
                      const user2 = auth?.currentUser || null;
                      const payload = {
                        uid: user2?.uid || null,
                        checkinId: r.id,
                        original: {
                          place: r.locationName || '',
                          status: r.status || '',
                          datetime: dtStr2,
                        },
                        requested: {
                          place: String(data.place || ''),
                          status: String(data.status || ''),
                          datetime: String(data.datetime || ''),
                        },
                        state: '送審',
                        createdAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString(),
                      };
                      if (db && fns.addDoc && fns.collection) {
                        await withRetry(() => fns.addDoc(fns.collection(db, 'changeRequests'), payload));
                      }
                      alert('已送出修改申請');
                      return true;
                    } catch (e) {
                      alert(`申請失敗：${e?.message || e}`);
                      return false;
                    }
                  }
                });
              });

              const actions = document.createElement('div');
                actions.className = 'record-actions';
                actions.appendChild(mapBtn);
                actions.appendChild(photoBtn);
                actions.appendChild(modifyBtn);
                card.appendChild(actions);
              listRoot.appendChild(card);
            });
        }
          renderForDate(todayYmd);
          dateInput.addEventListener('change', () => renderForDate(dateInput.value));
          isLoadingCheckins = false;
        } catch (e) {
          const msg = e?.message || e;
          const s = String(msg || '');
          if (s.includes('ERR_ABORTED') || s.includes('documents:runQuery') || s.includes('documents:batchGet')) { isLoadingCheckins = false; return; }
          container.textContent = typeof msg === 'string' ? `載入失敗：${msg}` : "載入失敗：可能為權限或索引設定問題";
          isLoadingCheckins = false;
        }
      })();
      return;
    }
    if (label === "請假") {
      (async () => {
        try {
          await ensureFirebase();
          const user = auth?.currentUser || null;
          if (!user) { container.textContent = "請先登入"; return; }
          const tzNow = nowInTZ('Asia/Taipei');
          const ref = fns.collection(db, "leaveRequests");
          const q = fns.query(ref, fns.where("uid", "==", user.uid));
          const snap = await withRetry(() => fns.getDocs(q));
          const list = [];
          snap.forEach((doc) => {
            try {
              const data = doc.data() || {};
              const created = data.createdAt;
              let dt = null;
              if (created && typeof created.toDate === 'function') dt = created.toDate(); else if (typeof created === 'string') dt = new Date(created);
              if (!(dt instanceof Date) || isNaN(dt)) dt = new Date();
              const s = data.startAt;
              const e = data.endAt;
              const sdt = typeof s === 'string' ? new Date(s) : (s && typeof s.toDate === 'function' ? s.toDate() : null);
              const edt = typeof e === 'string' ? new Date(e) : (e && typeof e.toDate === 'function' ? e.toDate() : null);
              list.push({ id: doc.id, ...data, dt, sdt, edt });
            } catch {}
          });
          try {
            const key = 'pendingLeaves';
            const v = localStorage.getItem(key);
            const arr = v ? JSON.parse(v) : [];
            const u = auth?.currentUser || null;
            const mine = Array.isArray(arr) ? arr.filter((x) => x && x.uid && u && x.uid === u.uid) : [];
            mine.forEach((data) => {
              const created = data.createdAt;
              const dt = typeof created === 'string' ? new Date(created) : (created && typeof created.toDate === 'function' ? created.toDate() : new Date());
              const s = data.startAt;
              const e = data.endAt;
              const sdt = typeof s === 'string' ? new Date(s) : (s && typeof s.toDate === 'function' ? s.toDate() : null);
              const edt = typeof e === 'string' ? new Date(e) : (e && typeof e.toDate === 'function' ? e.toDate() : null);
              list.push({ id: `local-${Math.random().toString(36).slice(2)}`, ...data, dt, sdt, edt });
            });
          } catch {}
          const y = tzNow.getFullYear();
          const m = tzNow.getMonth() + 1;
          const todayYm = `${y}-${String(m).padStart(2,'0')}`;
          container.innerHTML = `
            <div class="roster-datebar">
              <input id="leaveMonth" type="month" class="input" />
              <button id="btnAddLeave" class="btn btn-orange" type="button">新增請假</button>
            </div>
            <div id="leaveList"></div>
          `;
          const monthInput = container.querySelector('#leaveMonth');
          const addBtn = container.querySelector('#btnAddLeave');
          const listRoot = container.querySelector('#leaveList');
          if (!monthInput || !listRoot || !addBtn) return;
          monthInput.value = todayYm;
          attachPressInteractions(addBtn);
          const formatDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const formatDT = (d) => `${formatDate(d)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          function renderForMonth(ymStr) {
            const parts = String(ymStr || '').split('-');
            if (parts.length !== 2) return;
            const y = Number(parts[0]);
            const m = Number(parts[1]) - 1;
            const start = new Date(y, m, 1);
            const end = new Date(y, m + 1, 1);
            const monthList = list.filter((r) => {
              const base = r.sdt instanceof Date && !isNaN(r.sdt) ? r.sdt : r.dt;
              return base >= start && base < end;
            }).sort((a, b) => b.dt - a.dt);
            listRoot.innerHTML = '';
            if (!monthList.length) { listRoot.textContent = '該月無請假項目'; return; }
            monthList.forEach((r) => {
              const card = document.createElement('div');
              card.className = 'record-card';
              card.style.display = 'grid';
              card.style.gridTemplateColumns = '1fr';
              card.style.gap = '8px';
              const status = document.createElement('div');
              const nameText = r.name || (homeHeaderNameEl?.textContent || '').replace(/^歡迎~\s*/, '') || '使用者';
              const typeText = r.type || '請假';
              const sStr = r.sdt instanceof Date && !isNaN(r.sdt) ? formatDT(r.sdt) : '未設定';
              const eStr = r.edt instanceof Date && !isNaN(r.edt) ? formatDT(r.edt) : '未設定';
              const reason = r.reason || '';
              const st = r.status || '送審';
              status.innerHTML = `${nameText} 類型：<span class="status-label work">${typeText}</span> 時段：<span class="status-label arrive">${sStr}</span> → <span class="status-label leave">${eStr}</span> 原因：<span class="status-label return">${reason || '無'}</span> 狀態：<span class="status-label ${st==='核准'?'work':'out'}">${st}</span>`;
              const when = document.createElement('div');
              const dtStr = formatDateTimeTZ(r.dt, 'Asia/Taipei');
              when.textContent = `建立：${dtStr}`;
              const btnEdit = document.createElement('button');
              btnEdit.className = 'btn btn-blue';
              btnEdit.type = 'button';
              btnEdit.textContent = '編輯';
              btnEdit.style.borderRadius = '0';
              btnEdit.style.padding = '4px 8px';
              btnEdit.style.minHeight = '30px';
              attachPressInteractions(btnEdit);
              btnEdit.disabled = (st === '核准');
              const btnDel = document.createElement('button');
              btnDel.className = 'btn btn-orange';
              btnDel.type = 'button';
              btnDel.textContent = '刪除';
              btnDel.style.borderRadius = '0';
              btnDel.style.padding = '4px 8px';
              btnDel.style.minHeight = '30px';
              attachPressInteractions(btnDel);
              btnDel.disabled = (st === '核准');
              btnEdit.title = btnEdit.disabled ? '已核准無法編輯' : '';
              btnDel.title = btnDel.disabled ? '已核准無法刪除' : '';
              btnEdit.addEventListener('click', () => {
                if (btnEdit.disabled) return;
                const initS = r.sdt instanceof Date && !isNaN(r.sdt) ? formatDatetimeLocalTZ(r.sdt, 'Asia/Taipei') : '';
                const initE = r.edt instanceof Date && !isNaN(r.edt) ? formatDatetimeLocalTZ(r.edt, 'Asia/Taipei') : '';
                openModal({
                  title: '編輯請假',
                  fields: [
                    { key: 'type', label: '類型', type: 'select', options: [
                      { value: '事假', label: '事假' },
                      { value: '病假', label: '病假' },
                      { value: '特休', label: '特休' },
                      { value: '公假', label: '公假' },
                      { value: '其他', label: '其他' },
                    ] },
                    { key: 'startAt', label: '開始', type: 'datetime-local', step: 60 },
                    { key: 'endAt', label: '結束', type: 'datetime-local', step: 60 },
                    { key: 'reason', label: '原因', type: 'text' },
                    { key: 'attachment', label: '上傳照片', type: 'file', accept: 'image/png,image/jpeg' },
                  ],
                  initial: { type: r.type || '事假', startAt: initS, endAt: initE, reason: r.reason || '' },
                  submitText: '儲存',
                  refreshOnSubmit: false,
                  onSubmit: async (data) => {
                    try {
                      await ensureFirebase();
                      const payload = {
                        type: String(data.type || ''),
                        startAt: String(data.startAt || ''),
                        endAt: String(data.endAt || ''),
                        reason: String(data.reason || ''),
                        updatedAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString(),
                      };
                      const incoming = String(data.attachment || window.__leaveAttachmentData || '');
                      if (incoming) {
                        payload.attachmentData = incoming;
                      } else if (typeof r.attachmentData === 'string') {
                        payload.attachmentData = r.attachmentData;
                      }
                      if (db && fns.updateDoc && fns.doc) {
                        await withRetry(() => fns.updateDoc(fns.doc(db, 'leaveRequests', r.id), payload));
                      }
                      try {
                        const idx = list.findIndex((x) => x.id === r.id);
                        if (idx >= 0) {
                          const sdt = payload.startAt ? new Date(payload.startAt) : null;
                          const edt = payload.endAt ? new Date(payload.endAt) : null;
                          list[idx] = {
                            ...list[idx],
                            ...payload,
                            sdt: (sdt instanceof Date && !isNaN(sdt)) ? sdt : list[idx].sdt,
                            edt: (edt instanceof Date && !isNaN(edt)) ? edt : list[idx].edt,
                          };
                        }
                      } catch {}
                      renderForMonth(monthInput.value);
                      return true;
                    } catch (e) {
                      alert(`更新失敗：${e?.message || e}`);
                      return false;
                    }
                  },
                  afterRender: ({ body }) => {
                    try {
                      const fileInput = body.querySelector('[data-key="attachment"]');
                      if (r.attachmentData) {
                        const img = document.createElement('img');
                        img.src = r.attachmentData;
                        img.alt = '目前照片';
                        img.style.width = '100%';
                        img.style.height = 'auto';
                        img.style.borderRadius = '8px';
                        img.className = 'leave-photo-preview';
                        attachPressInteractions(img);
                        img.addEventListener('click', () => { try { fileInput?.click(); } catch {} });
                        const fileRow = fileInput ? fileInput.closest('.form-row') : null;
                        if (fileRow && fileRow.parentElement) { fileRow.parentElement.insertBefore(img, fileRow.nextSibling); } else { body.appendChild(img); }
                      }
                      if (fileInput) {
                        fileInput.addEventListener('change', () => {
                          try {
                            const f = fileInput.files?.[0];
                            if (!f) { window.__leaveAttachmentData = ''; return; }
                            const reader = new FileReader();
                            reader.onload = () => {
                              const url = String(reader.result || '');
                              window.__leaveAttachmentData = url;
                              const preview = body.querySelector('.leave-photo-preview');
                              if (preview) preview.src = url;
                            };
                            reader.readAsDataURL(f);
                          } catch { window.__leaveAttachmentData = ''; }
                        });
                      }
                    } catch {}
                  },
                });
              });
              btnDel.addEventListener('click', async () => {
                if (btnDel.disabled) return;
                const ok = await confirmAction({ title: '確認刪除', text: '確定要刪除此請假申請嗎？', confirmText: '刪除' });
                if (!ok) return;
                try {
                  await ensureFirebase();
                  if (db && fns.deleteDoc && fns.doc) {
                    await withRetry(() => fns.deleteDoc(fns.doc(db, 'leaveRequests', r.id)));
                  }
                  try {
                    const idx = list.findIndex((x) => x.id === r.id);
                    if (idx >= 0) list.splice(idx, 1);
                  } catch {}
                  renderForMonth(monthInput.value);
                } catch (e) {
                  alert(`刪除失敗：${e?.message || e}`);
                }
              });
              const actions = document.createElement('div');
              actions.className = 'record-actions';
              if (r.attachmentData) {
                const photoBtn = document.createElement('button');
                photoBtn.className = 'btn btn-darkgrey';
                photoBtn.type = 'button';
                photoBtn.textContent = '照片';
                photoBtn.style.borderRadius = '0';
                photoBtn.style.padding = '4px 8px';
                photoBtn.style.minHeight = '30px';
                attachPressInteractions(photoBtn);
                photoBtn.addEventListener('click', () => {
                  openModal({
                    title: '照片預覽',
                    fields: [],
                    submitText: '關閉',
                    refreshOnSubmit: false,
                    onSubmit: async () => true,
                    afterRender: ({ body }) => {
                      const v = document.createElement('img');
                      v.src = r.attachmentData;
                      v.alt = '照片預覽';
                      v.style.width = '100%';
                      v.style.maxHeight = '80vh';
                      v.style.objectFit = 'contain';
                      body.appendChild(v);
                    },
                    afterRender: ({ body }) => {
                      const dtInput = body.querySelector('[data-key="datetime"]');
                      if (dtInput) {
                        try { dtInput.readOnly = true; } catch {}
                        dtInput.addEventListener('click', () => { try { if (typeof dtInput.showPicker === 'function') dtInput.showPicker(); } catch {} });
                      }
                    }
                  });
                });
                actions.appendChild(photoBtn);
              }
              actions.appendChild(btnEdit);
              actions.appendChild(btnDel);
              card.appendChild(status);
              card.appendChild(when);
              card.appendChild(actions);
              listRoot.appendChild(card);
            });
          }
          renderForMonth(todayYm);
          monthInput.addEventListener('change', () => renderForMonth(monthInput.value));
          addBtn.addEventListener('click', () => {
            openModal({
              title: '新增請假',
              fields: [
                { key: 'type', label: '類型', type: 'select', options: [
                  { value: '病假', label: '病假' },
                  { value: '事假', label: '事假' },
                  { value: '特休', label: '特休' },
                  { value: '公假', label: '公假' },
                  { value: '其他', label: '其他' },
                ] },
                { key: 'startAt', label: '開始', type: 'datetime-local', step: 60 },
                { key: 'endAt', label: '結束', type: 'datetime-local', step: 60 },
                { key: 'reason', label: '原因', type: 'text' },
                { key: 'attachment', label: '上傳照片', type: 'file', accept: 'image/png,image/jpeg' },
                ],
                initial: { type: '病假' },
                submitText: '送出申請',
                refreshOnSubmit: false,
                onSubmit: async (data) => {
                  try {
                    await ensureFirebase();
                    const u = auth?.currentUser || null;
                    const payload = {
                      uid: u?.uid || null,
                      name: (homeHeaderNameEl?.textContent || '').replace(/^歡迎~\s*/, '') || (u?.email || '使用者'),
                      type: String(data.type || ''),
                      startAt: String(data.startAt || ''),
                      endAt: String(data.endAt || ''),
                      reason: String(data.reason || ''),
                      attachmentData: String(data.attachment || window.__leaveAttachmentData || ''),
                      status: '送審',
                      createdAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString(),
                    };
                    let saved = false;
                    let record = null;
                    if (db && fns.addDoc && fns.collection) {
                      try {
                        const docRef = await withRetry(() => fns.addDoc(fns.collection(db, 'leaveRequests'), payload));
                        saved = true;
                        const sdt = payload.startAt ? new Date(payload.startAt) : null;
                        const edt = payload.endAt ? new Date(payload.endAt) : null;
                        record = { id: docRef.id, ...payload, dt: new Date(), sdt: (sdt instanceof Date && !isNaN(sdt)) ? sdt : null, edt: (edt instanceof Date && !isNaN(edt)) ? edt : null };
                      } catch {}
                    }
                    if (!saved) {
                      const p2 = { ...payload };
                      if (typeof p2.createdAt !== 'string') p2.createdAt = new Date().toISOString();
                      enqueuePendingLeave(p2);
                      const sdt = p2.startAt ? new Date(p2.startAt) : null;
                      const edt = p2.endAt ? new Date(p2.endAt) : null;
                      record = { id: `local-${Math.random().toString(36).slice(2)}`, ...p2, dt: new Date(p2.createdAt), sdt: (sdt instanceof Date && !isNaN(sdt)) ? sdt : null, edt: (edt instanceof Date && !isNaN(edt)) ? edt : null };
                    }
                    if (record) { try { list.unshift(record); } catch {} }
                    renderForMonth(monthInput.value);
                    return true;
                  } catch (e) {
                    const msg = e?.message || e;
                    alert(typeof msg === 'string' ? `新增失敗：${msg}` : '新增失敗');
                    return false;
                  }
                },
                afterRender: ({ body }) => {
                try {
                  const fileInput = body.querySelector('[data-key="attachment"]');
                  if (fileInput) {
                    fileInput.addEventListener('change', () => {
                      try {
                        const f = fileInput.files?.[0];
                        if (!f) { window.__leaveAttachmentData = ''; return; }
                        const reader = new FileReader();
                        reader.onload = () => { window.__leaveAttachmentData = String(reader.result || ''); };
                        reader.readAsDataURL(f);
                      } catch { window.__leaveAttachmentData = ''; }
                    });
                    // 已依需求移除拍照按鈕與相關流程
                  }
                } catch {}
              },
            });
          });
        } catch (e) {
          const msg = e?.message || e;
          container.textContent = typeof msg === 'string' ? `載入失敗：${msg}` : "載入失敗";
        }
      })();
      return;
    }
    if (label === "計點") {
      (async () => {
        try {
          await ensureFirebase();
          const user = auth?.currentUser || null;
          if (!user) { container.textContent = "請先登入"; return; }
          const ref = fns.collection(db, "checkins");
          const q2 = fns.query(ref, fns.where("uid", "==", user.uid));
          const snap = await withRetry(() => fns.getDocs(q2));
          const records = [];
          snap.forEach((doc) => {
            const data = doc.data() || {};
            let created = data.createdAt;
            let dt = null;
            if (created && typeof created.toDate === 'function') dt = created.toDate(); else if (typeof created === 'string') dt = new Date(created);
            if (!dt) dt = new Date();
            records.push({ id: doc.id, ...data, dt });
          });
          let rules = appState.pointsRules || [];
          try {
            const rref = fns.collection(db, 'pointsRules');
            const rsnap = await withRetry(() => fns.getDocs(rref));
            const list = [];
            rsnap.forEach((doc) => { const d = doc.data() || {}; list.push({ id: doc.id, ...d }); });
            rules = list;
            appState.pointsRules = list;
          } catch {}
          const html = `
            <div class="block" id="block-month-summary">
              <div class="block-header centered"><button id="pointsPrevMonth" class="btn btn-sm" type="button">◀</button><span class="block-title" id="pointsMonthTitle"></span><button id="pointsNextMonth" class="btn btn-sm" type="button">▶</button></div>
              <div class="month-total-label">本月計點</div>
              <div class="month-total-wrap"><div id="pointsMonthTotalValue" class="month-total">0</div></div>
            </div>
            <div class="block" id="block-checkin-points">
              <div class="block-header"><span class="block-title">當日列表</span><div class="block-actions"><input id="pointsDateFilter" type="date" class="input" /></div></div>
              <div class="table-wrapper">
                <table class="table" aria-label="計點列表">
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>事由</th>
                      <th>狀態</th>
                      <th>計點</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody id="checkinPointsTbody"></tbody>
                </table>
              </div>
            </div>`;
          container.innerHTML = html;
          const tbody = container.querySelector('#checkinPointsTbody');
          const calcPoints = (rec) => {
            const statusFlag = (rec.inRadius === true) ? '正常' : '異常';
            const statusText = String(rec.status || '').trim();
            const baseStatus = statusText.split('-')[0];
            const reason = baseStatus || statusText;
            const found = rules.find((r) => String(r.reason||'') === reason && String(r.status||'') === statusFlag) || null;
            return { statusFlag, reason, points: found ? Number(found.points || 0) : 0 };
          };
          const monthTitleEl = container.querySelector('#pointsMonthTitle');
          const monthTotalEl = container.querySelector('#pointsMonthTotalValue');
          const prevBtn = container.querySelector('#pointsPrevMonth');
          const nextBtn = container.querySelector('#pointsNextMonth');
          const dateInput = container.querySelector('#pointsDateFilter');
          const tzNow = nowInTZ('Asia/Taipei');
          let viewMonth = new Date(tzNow.getFullYear(), tzNow.getMonth(), 1);
          const monthLabel = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          const formatDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          function renderMonth() {
            const y = viewMonth.getFullYear();
            const m = viewMonth.getMonth();
            const start = new Date(y, m, 1);
            const end = new Date(y, m + 1, 1);
            const total = records.reduce((sum, rec) => {
              if (rec.dt >= start && rec.dt < end) {
                const { points } = calcPoints(rec);
                return sum + (Number(points) || 0);
              }
              return sum;
            }, 0);
            if (monthTitleEl) monthTitleEl.textContent = monthLabel(viewMonth);
            if (monthTotalEl) {
              monthTotalEl.textContent = String(total);
              monthTotalEl.className = 'month-total ' + (total === 0 ? 'total-zero' : (total > 0 ? 'total-pos' : 'total-neg'));
            }
          }
          function renderDaily() {
            if (!tbody) return;
            const v = String(dateInput?.value || '');
            let sel = v ? new Date(`${v}T00:00:00`) : tzNow;
            const y = sel.getFullYear();
            const m = sel.getMonth();
            const d = sel.getDate();
            const rows = records
              .filter((rec) => rec.dt.getFullYear() === y && rec.dt.getMonth() === m && rec.dt.getDate() === d)
              .sort((a,b)=>b.dt - a.dt)
              .map((rec) => {
                const { statusFlag, reason, points } = calcPoints(rec);
                return `<tr data-id="${rec.id}"><td>${formatDate(rec.dt)}</td><td>${reason}</td><td>${statusFlag}</td><td>${points}</td><td class="cell-actions"><button class="btn btn-orange" data-act="appeal">申訴</button></td></tr>`;
              }).join('');
            tbody.innerHTML = rows;
          }
          if (dateInput) dateInput.value = ymd(tzNow);
          renderMonth();
          renderDaily();
          prevBtn?.addEventListener('click', () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); renderMonth(); });
          nextBtn?.addEventListener('click', () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); renderMonth(); });
          dateInput?.addEventListener('change', () => { renderDaily(); });
          const summaryBlock = container.querySelector('#block-month-summary');
          let sx = 0;
          summaryBlock?.addEventListener('touchstart', (e) => { try { sx = e.touches?.[0]?.clientX || 0; } catch {} }, { passive: true });
          summaryBlock?.addEventListener('touchend', (e) => { try { const ex = e.changedTouches?.[0]?.clientX || 0; const dx = ex - sx; if (dx < -50) { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); renderMonth(); } else if (dx > 50) { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); renderMonth(); } } catch {} }, { passive: true });
          const table = container.querySelector('#block-checkin-points table');
          table?.addEventListener('click', async (e) => {
            const t = e.target;
            if (!(t instanceof HTMLElement)) return;
            const act = t.dataset.act || '';
            if (act !== 'appeal') return;
            const tr = t.closest('tr');
            const idv = tr?.getAttribute('data-id') || '';
            const rec = records.find((x) => x.id === idv);
            if (!rec) return;
            const { statusFlag, reason, points } = calcPoints(rec);
            openModal({
              title: '提出申訴',
              fields: [
                { key: 'appealText', label: '申訴說明', type: 'text', placeholder: '請描述理由' },
              ],
              submitText: '送出',
              refreshOnSubmit: false,
              onSubmit: async (data) => {
                try {
                  await ensureFirebase();
                  const u = auth?.currentUser || null;
                  const payload = { uid: u?.uid || null, checkinId: rec.id, reason: reason || '', status: statusFlag, points, appealText: String(data.appealText || ''), createdAt: fns.serverTimestamp ? fns.serverTimestamp() : new Date(networkNowMs()).toISOString(), state: '送審' };
                  if (db && fns.addDoc && fns.collection) { await withRetry(() => fns.addDoc(fns.collection(db, 'pointAppeals'), payload)); }
                  t.textContent = '已申訴'; t.disabled = true;
                  return true;
                } catch (e) {
                  alert(`申訴失敗：${e?.message || e}`);
                  return false;
                }
              }
            });
          });
        } catch (e) {
          const msg = e?.message || e;
          container.textContent = typeof msg === 'string' ? `載入失敗：${msg}` : "載入失敗";
        }
      })();
      return;
    }
    if (label === "班表") {
      const html = `
        <div class="roster-layout" role="region" aria-label="班表">
          <div class="roster-row roster-a">
            <label for="rosterOfficerSelect" class="roster-label">幹部名單：</label>
            <select id="rosterOfficerSelect" class="roster-select">
              <option value="">請選擇幹部</option>
            </select>
          </div>
          <div class="roster-row roster-b">
            <div id="rosterCalendar" class="roster-calendar" aria-live="polite">月曆</div>
          </div>
          <div class="roster-row roster-c">
            <div id="rosterInfo" class="roster-info"></div>
          </div>
        </div>`;
      container.innerHTML = html;
      const info = document.getElementById("rosterInfo");
      const dt = new Date();
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
      if (info) info.textContent = `日期：${dateStr}`;
      const sel = document.getElementById("rosterOfficerSelect");
      if (sel) {
        const allowedRoles = ["系統管理員","管理層","高階主管","初階主管","行政"];
        const officers = appState.accounts.filter((a) => allowedRoles.includes(String(a.role||"")));
        const opts = officers.length ? officers : appState.accounts.slice(0, 10);
        opts.forEach((a) => {
          const opt = document.createElement("option");
          opt.value = a.id;
          opt.textContent = a.name || a.email || a.id;
          sel.appendChild(opt);
        });
      }

      // 月曆：預設當月，提供上一月/下一月切換
      const calendarRoot = document.getElementById("rosterCalendar");
      if (calendarRoot) {
        let viewDate = new Date(dt.getFullYear(), dt.getMonth(), 1);

        const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];

        function monthLabel(date) {
          return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, "0")}月`;
        }
        function daysInMonth(date) {
          const y = date.getFullYear();
          const m = date.getMonth();
          return new Date(y, m + 1, 0).getDate();
        }
        function firstWeekday(date) {
          return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
        }
        function renderMonth(date) {
          const totalDays = daysInMonth(date);
          const startPad = firstWeekday(date);
          const cells = [];
          for (let i = 0; i < startPad; i++) cells.push("");
          for (let d = 1; d <= totalDays; d++) cells.push(String(d));
          while (cells.length % 7 !== 0) cells.push("");

          const rows = [];
          for (let i = 0; i < cells.length; i += 7) {
            rows.push(cells.slice(i, i + 7));
          }

          const today = new Date();
          const isSameMonth = today.getFullYear() === date.getFullYear() && today.getMonth() === date.getMonth();

          const headerHtml = `
            <div class="roster-cal-header" role="group" aria-label="月曆導航">
              <button id="rosterPrevMonth" class="btn" aria-label="上一月">◀</button>
              <div class="roster-cal-title" aria-live="polite">${monthLabel(date)}</div>
              <button id="rosterNextMonth" class="btn" aria-label="下一月">▶</button>
            </div>
          `;
          const tableHeader = `
            <table class="roster-cal-table" aria-label="${monthLabel(date)}">
              <thead><tr>${weekdayLabels.map((w) => `<th scope="col">${w}</th>`).join("")}</tr></thead>
              <tbody>
                ${rows
                  .map(
                    (r) =>
                      `<tr>${r
                        .map((c) => {
                          const isToday = isSameMonth && String(today.getDate()) === c;
                          const cellCls = ["roster-cal-cell", c ? "" : "empty", isToday ? "today" : ""].filter(Boolean).join(" ");
                          if (!c) return `<td class="${cellCls}"></td>`;
                          return `<td class="${cellCls}"><button type="button" class="roster-cal-day" data-day="${c}">${c}</button></td>`;
                        })
                        .join("")}</tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          `;
          calendarRoot.innerHTML = headerHtml + tableHeader;

          const prevBtn = document.getElementById("rosterPrevMonth");
          const nextBtn = document.getElementById("rosterNextMonth");
          prevBtn?.addEventListener("click", () => {
            viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
            renderMonth(viewDate);
          });
          nextBtn?.addEventListener("click", () => {
            viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
            renderMonth(viewDate);
          });

          // 日期按鈕事件：更新右側資訊
          calendarRoot.addEventListener("click", (e) => {
            const btn = e.target.closest(".roster-cal-day");
            if (!btn) return;
            const day = btn.dataset.day;
            if (!day) return;
            const y = viewDate.getFullYear();
            const m = viewDate.getMonth();
            const d = new Date(y, m, parseInt(day, 10));
            const ymd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            const infoEl = document.getElementById("rosterInfo");
            if (infoEl) infoEl.textContent = `日期：${ymd}`;
          });
        }

        renderMonth(viewDate);
      }
    }
  }
function renderSettingsRules() {
  settingsContent.innerHTML = `
    <div class="block" id="block-rules">
      <div class="block-header"><span class="block-title">計點列表</span><div class="block-actions"><button id="btnAddRule" class="btn">新增</button></div></div>
      <div class="table-wrapper">
        <table class="table" aria-label="計點列表">
          <thead>
            <tr>
              <th>事由</th>
              <th>處理</th>
              <th>狀態</th>
              <th>計點</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="rulesTbody"></tbody>
        </table>
      </div>
    </div>`;
  const table = settingsContent.querySelector('#block-rules table');
  const tbody = settingsContent.querySelector('#rulesTbody');
  const addBtn = settingsContent.querySelector('#btnAddRule');
  const role = appState.currentUserRole || '一般';
  const canWrite = hasFullAccessToTab('settings');
  if (!canWrite) {
    try {
      addBtn?.parentElement?.removeChild(addBtn);
      const thOps = table?.querySelector('thead tr th:last-child');
      thOps?.parentElement?.removeChild(thOps);
    } catch {}
  }
  if (addBtn && canWrite) {
    attachPressInteractions(addBtn);
    addBtn.addEventListener('click', () => {
      openModal({
        title: '新增計點規則',
        fields: [
          { key: 'reason', label: '事由', type: 'text' },
          { key: 'handle', label: '處理', type: 'text' },
          { key: 'status', label: '狀態', type: 'select', options: [ { value: '正常', label: '正常' }, { value: '異常', label: '異常' } ] },
          { key: 'points', label: '計點', type: 'number', step: 1 },
        ],
        initial: { status: '正常', points: 0 },
        submitText: '新增',
        refreshOnSubmit: false,
        onSubmit: async (data) => {
          try {
            await ensureFirebase();
            const payload = { reason: String(data.reason || ''), handle: String(data.handle || ''), status: String(data.status || '正常'), points: (data.points != null ? Number(data.points) : 0) };
            let docId = null;
            if (db && fns.addDoc && fns.collection) {
              const docRef = await withRetry(() => fns.addDoc(fns.collection(db, 'pointsRules'), payload));
              docId = docRef.id;
            }
            if (!docId) throw new Error('新增失敗');
            const rowHtml = `<tr data-id="${docId}"><td>${payload.reason}</td><td>${payload.handle}</td><td>${payload.status}</td><td>${payload.points}</td><td class="cell-actions"><button class="btn" data-act="edit">編輯</button><button class="btn" data-act="del">刪除</button></td></tr>`;
            appState.pointsRules.unshift({ id: docId, ...payload });
            if (tbody) tbody.insertAdjacentHTML('afterbegin', rowHtml);
            return true;
          } catch (e) {
            alert(`新增失敗：${e?.message || e}`);
            return false;
          }
        }
      });
    });
  }
  (async () => {
    try {
      await ensureFirebase();
      const ref = fns.collection(db, 'pointsRules');
      const snap = await withRetry(() => fns.getDocs(ref));
      const list = [];
      snap.forEach((doc) => { const data = doc.data() || {}; list.push({ id: doc.id, ...data }); });
      appState.pointsRules = list;
    } catch {}
    if (tbody) {
      tbody.innerHTML = (appState.pointsRules || []).map((r) => {
        return `<tr data-id="${r.id}"><td>${r.reason || ''}</td><td>${r.handle || ''}</td><td>${r.status || ''}</td><td>${r.points ?? ''}</td><td class="cell-actions"><button class="btn" data-act="edit">編輯</button><button class="btn" data-act="del">刪除</button></td></tr>`;
      }).join('');
    }
  })();
    if (!table) return;
    table.addEventListener('click', async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const act = t.dataset.act || '';
      if (!act) return;
      if (!canWrite && act !== 'edit' && act !== 'del') return;
      const tr = t.closest('tr');
      const idv = tr?.getAttribute('data-id') || '';
      const idx = appState.pointsRules.findIndex((x) => x.id === idv);
      if (idx < 0) return;
      const r = appState.pointsRules[idx];
    if (act === 'edit') {
      if (!canWrite) { alert('權限不足：不可編輯此分頁內容'); return; }
      openModal({
        title: '編輯計點規則',
        fields: [
          { key: 'reason', label: '事由', type: 'text' },
          { key: 'handle', label: '處理', type: 'text' },
          { key: 'status', label: '狀態', type: 'select', options: [ { value: '正常', label: '正常' }, { value: '異常', label: '異常' } ] },
          { key: 'points', label: '計點', type: 'number', step: 1 },
        ],
        initial: { reason: r.reason || '', handle: r.handle || '', status: r.status || '正常', points: r.points ?? 0 },
        submitText: '儲存',
        onSubmit: async (data) => {
          try {
            await ensureFirebase();
            const payload = { reason: String(data.reason || ''), handle: String(data.handle || ''), status: String(data.status || '正常'), points: (data.points != null ? Number(data.points) : 0) };
            if (db && fns.updateDoc && fns.doc) { await withRetry(() => fns.updateDoc(fns.doc(db, 'pointsRules', r.id), payload)); }
            appState.pointsRules[idx] = { ...r, ...payload };
            const rowHtml = `<td>${payload.reason}</td><td>${payload.handle}</td><td>${payload.status}</td><td>${payload.points}</td><td class="cell-actions"><button class="btn" data-act="edit">編輯</button><button class="btn" data-act="del">刪除</button></td>`;
            tr.innerHTML = rowHtml;
            return true;
          } catch (e) {
            alert(`更新失敗：${e?.message || e}`);
            return false;
          }
        }
      });
    } else if (act === 'del') {
      if (!canWrite) { alert('權限不足：不可刪除此分頁內容'); return; }
      const ok = await confirmAction({ title: '確認刪除', text: '確定要刪除這筆規則嗎？', confirmText: '刪除' });
      if (!ok) return;
      try {
        await ensureFirebase();
        if (db && fns.deleteDoc && fns.doc) { await withRetry(() => fns.deleteDoc(fns.doc(db, 'pointsRules', r.id))); }
        appState.pointsRules.splice(idx, 1);
        tr?.parentElement?.removeChild(tr);
      } catch (e) {
        alert(`刪除失敗：${e?.message || e}`);
      }
    }
  });
}

async function loadRolesFromFirestore() {
  try {
    await ensureFirebase();
    const list = [];
    if (db && fns.collection && fns.getDocs) {
      const ref = fns.collection(db, 'roles');
      const snap = await withRetry(() => fns.getDocs(ref));
      snap.forEach((doc) => { const d = doc.data() || {}; list.push({ id: doc.id, name: String(d.name||''), allowedTabs: Array.isArray(d.allowedTabs) ? d.allowedTabs : [] }); });
    }
    const defMap = (r) => {
      switch (r) {
        case '系統管理員': return ["home","checkin","leader","manage","feature","external","personnel","settings"]; 
        case '管理層': return ["home","checkin","leader","manage","feature","external","personnel"]; 
        case '高階主管': return ["home","checkin","leader","manage","feature","external"]; 
        case '初階主管': return ["home","checkin","leader","manage","feature","external"]; 
        case '行政': return ["home","checkin","leader","feature","external"]; 
        case '保全': return ["home","checkin","feature","external"]; 
        case '總幹事':
        case '秘書':
        case '清潔':
        case '機電': return ["home","checkin","feature","external"]; 
        default: return ["home","checkin","feature","external"]; 
      }
    };
    appState.rolesConfig = list.length ? list : [];
    const fromDefaults = getRoles();
    const fromAccounts = Array.isArray(appState.accounts) ? appState.accounts.map((a) => a.role).filter(Boolean) : [];
    const union = Array.from(new Set([...(fromDefaults||[]), ...(fromAccounts||[])]));
    const exists = new Set((appState.rolesConfig || []).map((r) => r.name));
    union.forEach((name) => {
      if (!exists.has(name)) {
        (appState.rolesConfig || (appState.rolesConfig = [])).push({ id: null, name, allowedTabs: defMap(name) });
      }
    });
    if (typeof window !== 'undefined') window.Roles = (appState.rolesConfig || []).map((r) => r.name);
  } catch {
    const defMap = (r) => {
      switch (r) {
        case '系統管理員': return ["home","checkin","leader","manage","feature","external","personnel","settings"]; 
        case '管理層': return ["home","checkin","leader","manage","feature","external","personnel"]; 
        case '高階主管': return ["home","checkin","leader","manage","feature","external"]; 
        case '初階主管': return ["home","checkin","leader","manage","feature","external"]; 
        case '行政': return ["home","checkin","leader","feature","external"]; 
        case '保全': return ["home","checkin","feature","external"]; 
        case '總幹事':
        case '秘書':
        case '清潔':
        case '機電': return ["home","checkin","feature","external"]; 
        default: return ["home","checkin","feature","external"]; 
      }
    };
    const fromDefaults = getRoles();
    const fromAccounts = Array.isArray(appState.accounts) ? appState.accounts.map((a) => a.role).filter(Boolean) : [];
    const union = Array.from(new Set([...(fromDefaults||[]), ...(fromAccounts||[])]));
    appState.rolesConfig = union.map((name) => ({ id: null, name, allowedTabs: defMap(name) }));
    if (typeof window !== 'undefined') window.Roles = (appState.rolesConfig || []).map((r) => r.name);
  }
  // 合併本機覆蓋（權限不足時的暫存持久化）
  try {
    const ovRaw = localStorage.getItem('rolesOverrides') || '{}';
    const ov = JSON.parse(ovRaw);
    if (ov && typeof ov === 'object') {
      Object.keys(ov).forEach((name) => {
        const tabs = Array.isArray(ov[name]) ? ov[name] : [];
        const idx = (appState.rolesConfig || []).findIndex((x) => String(x.name||'') === String(name));
        if (idx >= 0) appState.rolesConfig[idx] = { ...(appState.rolesConfig[idx] || {}), allowedTabs: tabs };
        else (appState.rolesConfig || (appState.rolesConfig=[])).push({ id: null, name, allowedTabs: tabs });
      });
    }
  } catch {}
}

function renderSettingsRoles() {
  const container = settingsContent;
  const allTabs = ["home","checkin","leader","manage","feature","external","personnel","settings"];
  const labelMap = (() => {
    const map = {};
    Array.from(document.querySelectorAll('.tab-btn')).forEach((b) => {
      const k = b?.dataset?.tab || '';
      const lab = b.querySelector('.tab-label')?.textContent || b.getAttribute('aria-label') || k;
      if (k) map[k] = lab;
    });
    return map;
  })();
  const toLabel = (k) => labelMap[k] || k;
  container.innerHTML = `
    <div class="block" id="block-roles">
      <div class="block-header"><span class="block-title">角色列表</span><div class="block-actions"><button id="btnAddRole" class="btn">新增</button></div></div>
      <div class="table-wrapper">
        <table class="table" aria-label="角色列表">
          <thead>
            <tr><th>角色名稱</th><th>顯示分頁</th><th>操作</th></tr>
          </thead>
          <tbody id="rolesTbody"></tbody>
        </table>
      </div>
    </div>`;
  const tbody = container.querySelector('#rolesTbody');
  const addBtn = container.querySelector('#btnAddRole');
  const role = appState.currentUserRole || '一般';
  const canWrite = hasFullAccessToTab('settings');
  const isAdminRole = String(appState.currentUserRole || '') === '系統管理員';
  if (!canWrite) { try { addBtn?.parentElement?.removeChild(addBtn); } catch {} }
  (async () => {
    await loadRolesFromFirestore();
    const rows = (appState.rolesConfig || []).map((r) => {
      const tabs = Array.isArray(r.allowedTabs) ? r.allowedTabs.map((t) => toLabel(t)).join('、') : '';
      return `<tr data-id="${r.id || ''}" data-name="${r.name}"><td>${r.name}</td><td>${tabs}</td><td class="cell-actions"><button class="btn" data-act="edit">編輯</button>${isAdminRole ? '<button class="btn" data-act="del">刪除</button>' : ''}</td></tr>`;
    }).sort((aHtml, bHtml) => {
      const getName = (rowHtml) => {
        const m = rowHtml.match(/data-name="([^"]+)"/);
        return m ? m[1] : '';
      };
      const desired = ["系統管理員","管理層","高階主管","初階主管","行政","總幹事","秘書","清潔","機電","保全"];
      const pos = new Map(desired.map((n,i)=>[n,i]));
      const an = getName(aHtml); const bn = getName(bHtml);
      const ai = pos.has(an) ? pos.get(an) : 999;
      const bi = pos.has(bn) ? pos.get(bn) : 999;
      if (ai !== bi) return ai - bi;
      return an.localeCompare(bn, 'zh-Hant');
    }).join('');
    if (tbody) tbody.innerHTML = rows;
  })();
  addBtn && attachPressInteractions(addBtn);
  addBtn?.addEventListener('click', () => {
    if (!canWrite) { alert('權限不足：不可新增此分頁內容'); return; }
    openModal({
      title: '新增角色',
      fields: [
        { key: 'name', label: '角色名稱', type: 'text' },
        { key: 'allowedTabs', label: '顯示分頁', type: 'multiselect', options: allTabs.map((t) => ({ value: t, label: toLabel(t) })) },
      ],
      onSubmit: async (d) => {
        try {
          await ensureFirebase();
          const payload = { name: String(d.name||''), allowedTabs: Array.isArray(d.allowedTabs) ? d.allowedTabs : [] };
          let docId = null;
          if (db && fns.addDoc && fns.collection) {
            try { const ref = await withRetry(() => fns.addDoc(fns.collection(db, 'roles'), payload)); docId = ref.id; } catch {}
          }
          if (docId) {
            appState.rolesConfig.push({ id: docId, ...payload });
          } else {
            appState.rolesConfig.push({ id: null, ...payload });
            try { const raw = localStorage.getItem('rolesOverrides') || '{}'; const map = JSON.parse(raw); map[payload.name] = payload.allowedTabs; localStorage.setItem('rolesOverrides', JSON.stringify(map)); } catch {}
          }
          if (typeof window !== 'undefined') window.Roles = (appState.rolesConfig || []).map((x) => x.name);
          renderSettingsRoles();
          return true;
        } catch (e) { alert(`新增失敗：${e?.message || e}`); return false; }
      }
    });
  });
  const table = container.querySelector('#block-roles table');
  table?.addEventListener('click', async (e) => {
    const t = e.target; if (!(t instanceof HTMLElement)) return;
    const act = t.dataset.act || ''; if (!act) return;
    const tr = t.closest('tr'); const idv = tr?.getAttribute('data-id') || ''; const namev = tr?.getAttribute('data-name') || '';
    let idx = -1;
    if (idv) idx = (appState.rolesConfig || []).findIndex((x) => (x.id || '') === idv);
    if (idx < 0 && namev) idx = (appState.rolesConfig || []).findIndex((x) => String(x.name || '') === String(namev));
    const r = idx >= 0 ? appState.rolesConfig[idx] : null;
    if (act === 'edit') {
      openModal({
        title: '編輯角色',
        fields: [
          { key: 'name', label: '角色名稱', type: 'text' },
          { key: 'allowedTabs', label: '顯示分頁', type: 'multiselect', options: allTabs.map((t) => ({ value: t, label: toLabel(t) })) },
        ],
        initial: { name: r?.name || '', allowedTabs: r?.allowedTabs || [] },
        submitText: '儲存',
        onSubmit: async (d) => {
          try {
            await ensureFirebase();
            const payload = { name: String(d.name||''), allowedTabs: Array.isArray(d.allowedTabs) ? d.allowedTabs : [] };
            if (r?.id && db && fns.updateDoc && fns.doc) {
              await withRetry(() => fns.updateDoc(fns.doc(db, 'roles', r.id), payload));
              appState.rolesConfig[idx] = { ...(r || {}), ...payload };
              try { const raw = localStorage.getItem('rolesOverrides') || '{}'; const map = JSON.parse(raw); delete map[payload.name]; localStorage.setItem('rolesOverrides', JSON.stringify(map)); } catch {}
            } else {
              // 自動帶入（id 為 null）的角色，於編輯儲存時建立文件
              let docId = null;
              if (db && fns.addDoc && fns.collection) {
                try { const ref = await withRetry(() => fns.addDoc(fns.collection(db, 'roles'), payload)); docId = ref.id; } catch {}
              }
              if (docId) {
                appState.rolesConfig[idx] = { id: docId, ...payload };
                try { const raw = localStorage.getItem('rolesOverrides') || '{}'; const map = JSON.parse(raw); delete map[payload.name]; localStorage.setItem('rolesOverrides', JSON.stringify(map)); } catch {}
              } else {
                // 權限不足或寫入失敗：改為本機覆蓋並套用
                appState.rolesConfig[idx] = { id: null, ...payload };
                try { const raw = localStorage.getItem('rolesOverrides') || '{}'; const map = JSON.parse(raw); map[payload.name] = payload.allowedTabs; localStorage.setItem('rolesOverrides', JSON.stringify(map)); } catch {}
              }
            }
            if (typeof window !== 'undefined') window.Roles = (appState.rolesConfig || []).map((x) => x.name);
            renderSettingsRoles();
            return true;
          } catch (e) { alert(`更新失敗：${e?.message || e}`); return false; }
        }
      });
    } else if (act === 'del') {
      if (!canWrite) { alert('權限不足：不可刪除此分頁內容'); return; }
      const ok = await confirmAction({ title: '確認刪除', text: '確定要刪除這個角色嗎？', confirmText: '刪除' });
      if (!ok) return;
      try {
        await ensureFirebase();
        if (r?.id && db && fns.deleteDoc && fns.doc) { await withRetry(() => fns.deleteDoc(fns.doc(db, 'roles', r.id))); }
        appState.rolesConfig.splice(idx, 1);
        if (typeof window !== 'undefined') window.Roles = (appState.rolesConfig || []).map((x) => x.name);
        tr?.parentElement?.removeChild(tr);
      } catch (e) { alert(`刪除失敗：${e?.message || e}`); }
    }
  });
}
  function renderFeatureContent(label) {
    const panel = featureSection?.querySelector('.panel');
    if (!panel) return;
    let container = panel.querySelector('#featureDynamic');
    if (!container) {
      container = document.createElement('div');
      container.id = 'featureDynamic';
      panel.appendChild(container);
    }
    if (label === '推播') {
      container.innerHTML = `
        <div class="block">
          <p>瀏覽器通知權限：<span id="notifyStatus">disabled</span></p>
          <div class="row"><button class="btn" id="btnRequestNotify" disabled>允許通知</button></div>
          <div class="row"><button class="btn" id="btnTestNotify" disabled>測試通知</button></div>
        </div>
      `;
    } else {
      container.innerHTML = `<div class="block"><p class="muted">此功能尚未實作</p></div>`;
    }
  }
function renderSettingsNotifications() {
  const container = settingsContent;
  if (!container) return;
  const perm = 'disabled';
  container.innerHTML = `
    <div class="block">
      <p>瀏覽器通知權限：<span id="notifyStatus">${perm}</span></p>
      <div class="row"><button class="btn" id="btnRequestNotify" disabled>允許通知</button></div>
      <div class="row"><button class="btn" id="btnTestNotify" disabled>測試通知</button></div>
    </div>
  `;
}
