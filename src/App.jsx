import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, Heart, Plus, Trash2, Upload, X, RefreshCw, BookOpen, RotateCcw, Cake } from "lucide-react";

const STORAGE_KEY = "intercede-people-v2";
const ADMIN_PASSWORD = "Promo1398!";
const TAP_KEY = "intercede-tap-ts";
const TAP_TTL = 24 * 60 * 60 * 1000;

function shouldShowTap() {
  try {
    const raw = localStorage.getItem(TAP_KEY);
    if (!raw) return true;
    return Date.now() - Number(raw) > TAP_TTL;
  } catch { return true; }
}

function recordTapShown() {
  try { localStorage.setItem(TAP_KEY, String(Date.now())); } catch {}
}
const ADMIN_KEY = "intercede-admin-authed";
const ADMIN_TTL = 86400000;

function isAdminAuthed() {
  try {
    const raw = localStorage.getItem(ADMIN_KEY);
    if (!raw) return false;
    const { ts } = JSON.parse(raw);
    return Date.now() - ts < ADMIN_TTL;
  } catch { return false; }
}

function setAdminAuthed() {
  localStorage.setItem(ADMIN_KEY, JSON.stringify({ ts: Date.now() }));
}
async function apiLoad() {
  const res = await fetch("/api/data");
  if (!res.ok) throw new Error("load failed");
  return await res.json();
}

async function apiSave(people) {
  await fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(people),
  });
}

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getWeekStartET() {
  // Returns UTC timestamp of most recent Monday midnight Eastern Time
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const etNow = new Date(etStr);
  const day = etNow.getDay(); // 0=Sun
  const daysFromMon = day === 0 ? 6 : day - 1;
  const monET = new Date(etNow);
  monET.setDate(etNow.getDate() - daysFromMon);
  monET.setHours(0, 0, 0, 0);
  // Offset between real UTC and the "fake local" ET date object
  const utcOffset = now.getTime() - etNow.getTime();
  return monET.getTime() + utcOffset;
}

function withinWeek(ts) {
  return ts && ts >= getWeekStartET();
}

function timeAgo(ts) {
  if (!ts) return null;
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ordinal(n) {
  const s = ["th","st","nd","rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Resolves a MM-DD birthday to a real Date in the given year.
// Feb 29 on a non-leap year falls back to Feb 28.
function birthdayInYear(month, day, year) {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const resolvedDay = (month === 2 && day === 29 && !isLeap) ? 28 : day;
  return new Date(year, month - 1, resolvedDay);
}

function getBirthdayStatus(birthday) {
  if (!birthday) return null;
  const today = new Date();
  const [month, day] = birthday.split("-").map(Number);
  if (!month || !day) return null;
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let bday = birthdayInYear(month, day, today.getFullYear());
  if (bday < todayMidnight) bday = birthdayInYear(month, day, today.getFullYear() + 1);
  const diff = Math.round((bday - todayMidnight) / 86400000);
  if (diff === 0) return { label: "🎂 Birthday today!", urgent: true };
  if (diff === 1) return { label: "🎂 Birthday tomorrow!", urgent: true };
  if (diff <= 7) return { label: `🎂 Birthday in ${diff} days`, urgent: false };
  return null;
}

function formatBirthday(birthday) {
  if (!birthday) return "";
  const [month, day] = birthday.split("-").map(Number);
  if (!month || !day) return birthday;
  return new Date(2000, month - 1, day).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function getUpcomingBirthdays(people) {
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const results = [];
  for (const p of people) {
    if (!p.birthday) continue;
    const [month, day] = p.birthday.split("-").map(Number);
    if (!month || !day) continue;
    let bday = birthdayInYear(month, day, today.getFullYear());
    if (bday < todayMidnight) bday = birthdayInYear(month, day, today.getFullYear() + 1);
    const diff = Math.round((bday - todayMidnight) / 86400000);
    if (diff <= 7) results.push({ person: p, diff, date: bday });
  }
  return results.sort((a, b) => a.diff - b.diff);
}

// ── CSV parsing helpers ────────────────────────────────────

// Parse a single CSV line, respecting quoted fields
function splitCSVLine(line) {
  const cells = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ""; }
    else { cur += ch; }
  }
  cells.push(cur.trim());
  return cells.map(c => c.replace(/^["']|["']$/g, "").trim());
}

function titleCase(str) {
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// If "Smith, John" → "John Smith"; also title-cases
function normalizeName(raw) {
  const trimmed = raw.trim();
  const commaFlip = trimmed.match(/^([^,]+),\s*(.+)$/);
  if (commaFlip) return titleCase(`${commaFlip[2].trim()} ${commaFlip[1].trim()}`);
  return titleCase(trimmed);
}

// Parse a birthday string into MM-DD format
function parseBirthdayStr(raw) {
  if (!raw) return "";
  const cleaned = raw.trim();
  // YYYY-MM-DD (ISO format - e.g. 2009-01-15)
  const iso = cleaned.match(/^\d{4}[\-\/](\d{1,2})[\-\/](\d{1,2})$/);
  if (iso) return `${iso[1].padStart(2, "0")}-${iso[2].padStart(2, "0")}`;
  // MM/DD or MM-DD or M/D (e.g. 03/15, 3-15)
  const numeric = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-]\d{2,4})?$/);
  if (numeric) return `${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;
  // Month name: "March 15", "15 March", "March 15, 2005"
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const lower = cleaned.toLowerCase();
  for (let mi = 0; mi < months.length; mi++) {
    if (lower.includes(months[mi])) {
      const dayMatch = cleaned.match(/\b(\d{1,2})\b/);
      if (dayMatch) return `${String(mi + 1).padStart(2, "0")}-${dayMatch[1].padStart(2, "0")}`;
    }
  }
  return "";
}

function parseCSV(text) {
  const rawLines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (!rawLines.length) return [];

  const firstCells = splitCSVLine(rawLines[0]);
  const firstNorm = firstCells.map(c => c.toLowerCase().replace(/[^a-z]/g, ""));

  // Detect header row by looking for name/date keywords
  const nameKws = ["name","first","last","fname","lname","given","surname","family","student","person","contact"];
  const hasHeader = firstNorm.some(c => nameKws.some(kw => c.includes(kw)));

  const headers = hasHeader ? firstNorm : [];
  const dataLines = hasHeader ? rawLines.slice(1) : rawLines;

  // Locate name columns
  const firstNameIdx = headers.findIndex(h =>
    h === "firstname" || h === "fname" || h === "givenname" || h === "given" ||
    h === "first" || h.startsWith("first")
  );
  const lastNameIdx = headers.findIndex(h =>
    h === "lastname" || h === "lname" || h === "surname" || h === "familyname" ||
    h === "last" || h.startsWith("last") || h === "family"
  );
  const fullNameIdx = (firstNameIdx < 0 && lastNameIdx < 0)
    ? headers.findIndex(h => h.includes("name") || h.includes("student") || h.includes("person") || h.includes("contact"))
    : -1;

  // Locate birthday column
  const bdayIdx = headers.findIndex(h =>
    h.includes("birth") || h.includes("bday") || h.includes("dob") || h === "bd" || h === "birthday"
  );

  // For headerless files, sniff which column looks like a date
  const fallbackBdayIdx = (() => {
    if (hasHeader || !dataLines.length) return -1;
    const sample = splitCSVLine(dataLines[0]);
    for (let i = 1; i < sample.length; i++) {
      if (parseBirthdayStr(sample[i])) return i;
    }
    return -1;
  })();

  return dataLines.map(line => {
    const cells = splitCSVLine(line);
    if (!cells.length || !cells[0]) return null;

    let name = "";
    if (hasHeader) {
      if (firstNameIdx >= 0 && lastNameIdx >= 0) {
        // Separate first + last columns → join as "First Last"
        const first = (cells[firstNameIdx] || "").trim();
        const last = (cells[lastNameIdx] || "").trim();
        name = titleCase(`${first} ${last}`.trim());
      } else if (firstNameIdx >= 0) {
        name = titleCase((cells[firstNameIdx] || "").trim());
      } else if (lastNameIdx >= 0) {
        name = titleCase((cells[lastNameIdx] || "").trim());
      } else if (fullNameIdx >= 0) {
        name = normalizeName(cells[fullNameIdx] || "");
      } else {
        // No recognized column — fall back to first cell
        name = normalizeName(cells[0] || "");
      }
    } else {
      name = normalizeName(cells[0] || "");
    }

    if (!name || name.length < 2) return null;

    const bi = hasHeader ? bdayIdx : fallbackBdayIdx;
    const birthday = bi >= 0 && cells[bi] ? parseBirthdayStr(cells[bi]) : "";

    return { name, birthday };
  }).filter(Boolean);
}

// ── Component ──────────────────────────────────────────────

export default function App() {
  const [people, setPeople] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("pray");
  const [order, setOrder] = useState("random");
  const [filter, setFilter] = useState("all");
  const [cardIdx, setCardIdx] = useState(0);
  const [deckIds, setDeckIds] = useState([]);
  const [ready, setReady] = useState(() => !shouldShowTap());
  const [pinnedPersonId, setPinnedPersonId] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Swipe
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const [swipeDelta, setSwipeDelta] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  // People mgmt
  const [addName, setAddName] = useState("");
  const [addType, setAddType] = useState("student");
  const [addGroup, setAddGroup] = useState("hs");
  const [search, setSearch] = useState("");
  const [editBdayFor, setEditBdayFor] = useState(null);
  const [editNameFor, setEditNameFor] = useState(null);
  const [nameInput, setNameInput] = useState("");
  const [confirmPromo, setConfirmPromo] = useState(false);
  const [bdayInput, setBdayInput] = useState("");

  // Prayer requests
  const [reqFor, setReqFor] = useState(null);
  const [reqText, setReqText] = useState("");

  // Import
  const [importData, setImportData] = useState(null);
  const fileRef = useRef(null);

  const saveTimer = useRef(null);
  const pollTimer = useRef(null);
  const isSaving = useRef(false);

  // Admin auth
  const [adminAuthed, setAdminAuthedState] = useState(() => isAdminAuthed());
  const [showAdminPrompt, setShowAdminPrompt] = useState(false);
  const [adminPwInput, setAdminPwInput] = useState("");
  const [adminPwError, setAdminPwError] = useState("");
  const [pendingView, setPendingView] = useState(null);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap";
    document.head.appendChild(link);
    const style = document.createElement("style");
    style.textContent = `@keyframes tapPulse { 0%,100%{opacity:1} 50%{opacity:0.65} }`;
    document.head.appendChild(style);
    return () => { link.remove(); style.remove(); };
  }, []);

  // Load from KV
  useEffect(() => {
    (async () => {
      try {
        const data = await apiLoad();
        setPeople(data);
      } catch {}
      setLoaded(true);
    })();
  }, []);

  // Track whether current people state came from a remote poll (no save needed)
  const fromPoll = useRef(false);
  const lastSaved = useRef(null);

  // Save to KV (debounced 1.5s) — only when change came from user, not poll
  useEffect(() => {
    if (!loaded) return;
    if (fromPoll.current) { fromPoll.current = false; return; }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const snapshot = JSON.stringify(people);
      if (snapshot === lastSaved.current) return; // already saved this
      isSaving.current = true;
      await apiSave(people).catch(() => {});
      lastSaved.current = snapshot;
      isSaving.current = false;
    }, 1500);
    return () => clearTimeout(saveTimer.current);
  }, [people, loaded]);

  // Poll for remote changes every 15s
  useEffect(() => {
    if (!loaded) return;
    const poll = async () => {
      if (isSaving.current) return;
      try {
        const fresh = await apiLoad();
        const freshStr = JSON.stringify(fresh);
        setPeople(prev => {
          if (JSON.stringify(prev) === freshStr) return prev;
          fromPoll.current = true;
          return fresh;
        });
      } catch {}
    };
    pollTimer.current = setInterval(poll, 15000);
    return () => clearInterval(pollTimer.current);
  }, [loaded]);

  const activePeople = people.filter(p => p.active !== false);

  const getFiltered = useCallback(() => {
    let list = activePeople;
    if (filter === "students") list = list.filter(p => p.type === "student");
    if (filter === "leaders") list = list.filter(p => p.type === "leader");
    if (filter === "hs") list = list.filter(p => p.group === "hs");
    if (filter === "ms") list = list.filter(p => p.group === "ms");
    if (filter === "hs-students") list = list.filter(p => p.type === "student" && p.group === "hs");
    if (filter === "ms-students") list = list.filter(p => p.type === "student" && p.group === "ms");
    if (filter === "hs-leaders") list = list.filter(p => p.type === "leader" && p.group === "hs");
    if (filter === "ms-leaders") list = list.filter(p => p.type === "leader" && p.group === "ms");
    if (filter === "unprayed") list = list.filter(p => !withinWeek(p.prayedAt));
    return list;
  }, [people, filter]);

  const buildDeck = useCallback((filterOverride) => {
    const f = filterOverride ?? filter;
    let list = activePeople;
    if (f === "students") list = list.filter(p => p.type === "student");
    if (f === "leaders") list = list.filter(p => p.type === "leader");
    if (f === "hs") list = list.filter(p => p.group === "hs");
    if (f === "ms") list = list.filter(p => p.group === "ms");
    if (f === "hs-students") list = list.filter(p => p.type === "student" && p.group === "hs");
    if (f === "ms-students") list = list.filter(p => p.type === "student" && p.group === "ms");
    if (f === "hs-leaders") list = list.filter(p => p.type === "leader" && p.group === "hs");
    if (f === "ms-leaders") list = list.filter(p => p.type === "leader" && p.group === "ms");
    if (f === "unprayed") list = list.filter(p => !withinWeek(p.prayedAt));
    // Always exclude prayed-this-week from swipe deck
    const unprayed = list.filter(p => !withinWeek(p.prayedAt));
    setDeckIds(shuffle(unprayed.map(p => p.id)));
    setCardIdx(0);
    setPinnedPersonId(null);
    setDropdownOpen(false);
    if (shouldShowTap()) setReady(false); else setReady(true);
  }, [people, filter]);

  useEffect(() => { if (loaded) buildDeck(); }, [loaded, filter, order]);

  // When someone gets marked as prayed, remove them from deck immediately
  useEffect(() => {
    if (!loaded) return;
    setDeckIds(prev => {
      const prayedSet = new Set(activePeople.filter(p => withinWeek(p.prayedAt)).map(p => p.id));
      const filtered = prev.filter(id => !prayedSet.has(id));
      if (filtered.length !== prev.length) { setCardIdx(i => Math.min(i, Math.max(filtered.length - 1, 0))); }
      return filtered;
    });
  }, [people]);

  const deck = (() => {
    if (order === "alpha") return getFiltered().filter(p => !withinWeek(p.prayedAt)).slice().sort((a, b) => a.name.localeCompare(b.name));
    const map = Object.fromEntries(activePeople.map(p => [p.id, p]));
    return deckIds.map(id => map[id]).filter(Boolean);
  })();

  const pinnedPerson = pinnedPersonId ? activePeople.find(p => p.id === pinnedPersonId) ?? null : null;
  const current = pinnedPerson ?? deck[cardIdx] ?? null;
  const prayedCount = activePeople.filter(p => withinWeek(p.prayedAt)).length;
  const upcomingBdays = getUpcomingBirthdays(activePeople);
  const urgentBdays = upcomingBdays.filter(b => b.diff <= 3).length;

  function goToPerson(personId) {
    setView("pray");
    setDropdownOpen(false);
    const deckIdx = deck.findIndex(p => p.id === personId);
    if (deckIdx >= 0) {
      setPinnedPersonId(null);
      setCardIdx(deckIdx);
    } else {
      setPinnedPersonId(personId);
    }
    if (!ready) { setReady(true); recordTapShown(); }
  }

  function nav(dir) {
    setReqFor(null);
    setSwipeDelta(0);
    setPinnedPersonId(null);
    setCardIdx(i => {
      let n = i + dir;
      if (n < 0) n = deck.length - 1;
      if (n >= deck.length) n = 0;
      return n;
    });
  }

  function selectFromDropdown(personId) {
    setDropdownOpen(false);
    setReqFor(null);
    // If person is in unprayed deck, jump to their index
    const deckIdx = deck.findIndex(p => p.id === personId);
    if (deckIdx >= 0) {
      setPinnedPersonId(null);
      setCardIdx(deckIdx);
    } else {
      // Already prayed — pin their card
      setPinnedPersonId(personId);
    }
  }

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    setIsSwiping(false);
    setSwipeDelta(0);
  }

  function handleTouchMove(e) {
    if (touchStartX.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!isSwiping && Math.abs(dy) > Math.abs(dx)) return;
    setIsSwiping(true);
    e.preventDefault();
    setSwipeDelta(dx);
  }

  function handleTouchEnd() {
    if (Math.abs(swipeDelta) > 55) nav(swipeDelta < 0 ? 1 : -1);
    else setSwipeDelta(0);
    setIsSwiping(false);
    touchStartX.current = null;
    touchStartY.current = null;
  }

  function markPrayed() {
    if (!current) return;
    setPeople(prev => prev.map(p => p.id === current.id ? { ...p, prayedAt: Date.now() } : p));
  }

  function unmarkPrayed() {
    if (!current) return;
    setPeople(prev => prev.map(p => p.id === current.id ? { ...p, prayedAt: null } : p));
  }

  const [addGrade, setAddGrade] = useState("");

  function addPerson() {
    if (!addName.trim()) return;
    setPeople(prev => [...prev, { id: genId(), name: addName.trim(), type: addType, group: addType === "student" ? addGroup : null, grade: addType === "student" && addGrade ? Number(addGrade) : null, active: true, prayedAt: null, prayerRequests: [], birthday: "" }]);
    setAddName("");
    setAddGrade("");
  }

  function cycleGroup(id) {
    setPeople(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (p.type === "leader") return { ...p, group: p.group === "hs" ? "ms" : p.group === "ms" ? null : "hs" };
      return { ...p, group: p.group === "hs" ? "ms" : p.group === "ms" ? null : "hs" };
    }));
  }

  function toggleType(id) {
    setPeople(prev => prev.map(p => p.id === id ? { ...p, type: p.type === "student" ? "leader" : "student" } : p));
  }

  function deactivate(id) { setPeople(prev => prev.map(p => p.id === id ? { ...p, active: false } : p)); }
  function restore(id) { setPeople(prev => prev.map(p => p.id === id ? { ...p, active: true } : p)); }
  function deletePerm(id) { setPeople(prev => prev.filter(p => p.id !== id)); }

  function saveBirthday(id, val) {
    setPeople(prev => prev.map(p => p.id === id ? { ...p, birthday: val } : p));
    setEditBdayFor(null);
    setBdayInput("");
  }

  function saveName(id) {
    if (!nameInput.trim()) return;
    setPeople(prev => prev.map(p => p.id === id ? { ...p, name: nameInput.trim() } : p));
    setEditNameFor(null);
    setNameInput("");
  }

  function promoteGrades() {
    setPeople(prev => prev.map(p => {
      if (p.type !== "student" || !p.grade) return p;
      if (p.grade >= 12) return { ...p, active: false, grade: p.grade };
      return { ...p, grade: p.grade + 1 };
    }));
    setConfirmPromo(false);
  }

  function addRequest(personId) {
    if (!reqText.trim()) return;
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, prayerRequests: [...(p.prayerRequests || []), reqText.trim()] } : p));
    setReqText(""); setReqFor(null);
  }

  function removeRequest(personId, idx) {
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, prayerRequests: p.prayerRequests.filter((_, i) => i !== idx) } : p));
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setImportData(parseCSV(ev.target.result));
    reader.readAsText(file);
    e.target.value = "";
  }

  function confirmImport() {
    const existing = new Set(people.map(p => p.name.toLowerCase()));
    const toAdd = (importData || [])
      .filter(p => !existing.has(p.name.toLowerCase()))
      .map(p => ({ id: genId(), name: p.name, type: "student", group: null, active: true, prayedAt: null, prayerRequests: [], birthday: p.birthday || "" }));
    setPeople(prev => [...prev, ...toAdd]);
    setImportData(null);
    setView("people");
  }

  function handleTabClick(v) {
    if ((v === "people" || v === "import") && !adminAuthed) {
      setPendingView(v);
      setAdminPwInput("");
      setAdminPwError("");
      setShowAdminPrompt(true);
    } else {
      setView(v);
    }
  }

  function submitAdminPw() {
    if (adminPwInput === ADMIN_PASSWORD) {
      setAdminAuthed(true);
      setAdminAuthedState(true);
      setShowAdminPrompt(false);
      if (pendingView) { setView(pendingView); setPendingView(null); }
    } else {
      setAdminPwError("Incorrect password.");
      setAdminPwInput("");
    }
  }

  if (!loaded) {
    return <div style={S.root}><p style={{ color: "#c4a882", fontFamily: "Cormorant Garamond, serif", textAlign: "center", marginTop: 80, fontSize: 20 }}>Loading…</p></div>;
  }

  const bdayStatus = current ? getBirthdayStatus(current.birthday) : null;
  const prayedThis = activePeople.filter(p => withinWeek(p.prayedAt)).sort((a, b) => b.prayedAt - a.prayedAt);
  const notPrayedThis = activePeople.filter(p => !withinWeek(p.prayedAt)).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={S.root}>
      {/* Header */}
      <header style={S.header}>
        <div style={S.logoWrap}>
          <span style={S.logoCross}>✦</span>
          <span style={S.logoText}>Calvary Students</span>
        </div>
        <div style={{ ...S.weekBar, cursor: "pointer" }} onClick={() => setView("week")}>
          <Heart size={13} color="#d4916a" fill="#d4916a" />
          <span style={S.weekText}>{prayedCount} / {activePeople.length} this week</span>
          {urgentBdays > 0 && <span style={S.bdayAlert}><span style={{lineHeight:1}}>🎂</span><span style={{lineHeight:1}}>{urgentBdays}</span></span>}
        </div>
      </header>

      {/* Progress */}
      <div style={S.progressTrack}>
        <div style={{ ...S.progressFill, width: activePeople.length ? `${(prayedCount / activePeople.length) * 100}%` : "0%" }} />
      </div>

      {/* Tabs */}
      <nav style={S.tabs}>
        {[["pray","Pray"],["week","Week"]].map(([v, label]) => (
          <button key={v} onClick={() => setView(v)} style={{ ...S.tab, ...(view === v ? S.tabActive : {}) }}>{label}</button>
        ))}
        {adminAuthed && [["people","People"],["import","Import"]].map(([v, label]) => (
          <button key={v} onClick={() => setView(v)} style={{ ...S.tab, ...(view === v ? S.tabActive : {}) }}>{label}</button>
        ))}
      </nav>

      {/* Admin password modal */}
      {showAdminPrompt && (
        <div style={S.modalOverlay} onClick={() => setShowAdminPrompt(false)}>
          <div style={S.modalBox} onClick={e => e.stopPropagation()}>
            <p style={S.modalTitle}>Admin Access</p>
            <input
              autoFocus
              type="password"
              value={adminPwInput}
              onChange={e => setAdminPwInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submitAdminPw(); if (e.key === "Escape") setShowAdminPrompt(false); }}
              placeholder="Password"
              style={S.modalInput}
            />
            {adminPwError && <p style={S.modalError}>{adminPwError}</p>}
            <div style={S.modalBtns}>
              <button onClick={submitAdminPw} style={S.confirmBtn}>Unlock</button>
              <button onClick={() => setShowAdminPrompt(false)} style={S.cancelBtn}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── PRAY ─── */}
      {view === "pray" && (
        <div style={S.prayWrap}>
          <div style={S.controls}>
            <div style={S.togglePill}>
              <button onClick={() => { setOrder("random"); buildDeck(); }} style={{ ...S.toggleOpt, ...(order === "random" ? S.toggleOptOn : {}) }}>Shuffle</button>
              <button onClick={() => { setOrder("alpha"); setCardIdx(0); if (shouldShowTap()) setReady(false); }} style={{ ...S.toggleOpt, ...(order === "alpha" ? S.toggleOptOn : {}) }}>A–Z</button>
            </div>
            <select value={filter} onChange={e => { setFilter(e.target.value); setCardIdx(0); if (shouldShowTap()) setReady(false); }} style={S.filterSelect}>
              <option value="all">Everyone</option>
              <option value="ms-students">MS Students</option>
              <option value="hs-students">HS Students</option>
              <option value="leaders">Leaders</option>
              <option value="unprayed">Unprayed</option>
            </select>
            {order === "random" && (
              <button onClick={() => buildDeck()} style={S.reshuffleBtn} title="Reshuffle"><RotateCcw size={14} /></button>
            )}
          </div>

          {deck.length === 0 ? (
            <div style={S.empty}>
              <BookOpen size={40} color="#5a4832" />
              <p style={S.emptyTitle}>No one here yet</p>
              <p style={S.emptySub}>Add people in the People tab or import a CSV.</p>
            </div>
          ) : (
            <>
              {!ready ? (
                /* ── Tap to Begin splash ── */
                <div
                  style={S.cardOuter}
                  onClick={() => { setReady(true); recordTapShown(); }}
                >
                  <div style={{ ...S.cardGhost, transform: "rotate(2deg) translateY(6px)", opacity: 0.35 }} />
                  <div style={{ ...S.cardGhost, transform: "rotate(-1.5deg) translateY(3px)", opacity: 0.55 }} />
                  <div style={{ ...S.card, ...S.tapCard }}>
                    <div style={S.tapCross}>✦</div>
                    <h2 style={S.tapTitle}>Tap to Begin</h2>
                    <p style={S.tapSub}>{deck.length} {filter === "all" ? "people" : filter.replace("-", " ")} ready</p>
                  </div>
                </div>
              ) : (
                <>
                  <div style={S.swipeHint}>← swipe to navigate →</div>

                  <div style={S.cardOuter} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
                    <div style={{ ...S.cardGhost, transform: "rotate(2deg) translateY(6px)", opacity: 0.35 }} />
                    <div style={{ ...S.cardGhost, transform: "rotate(-1.5deg) translateY(3px)", opacity: 0.55 }} />
                    <div style={{
                      ...S.card,
                      ...(withinWeek(current?.prayedAt) ? S.cardDone : {}),
                      transform: isSwiping ? `translateX(${swipeDelta * 0.35}px) rotate(${swipeDelta * 0.018}deg)` : "none",
                      transition: isSwiping ? "none" : "transform 0.25s cubic-bezier(.25,.46,.45,.94)",
                      opacity: isSwiping ? Math.max(0.6, 1 - Math.abs(swipeDelta) / 400) : 1,
                    }}>
                      <div style={S.badgeRow}>
                        <div style={{ ...S.badge, ...(current?.type === "leader" ? S.leaderBadge : S.studentBadge) }}>
                          {current?.type === "leader" ? "Leader" : "Student"}
                        </div>
                        {current?.group && (
                          <div style={{ ...S.badge, ...(current.group === "hs" ? S.hsBadge : S.msBadge) }}>
                            {current.group.toUpperCase()}
                          </div>
                        )}
                        {current?.type === "student" && current?.grade && (
                          <div style={{ ...S.badge, ...S.gradeBadgeLg }}>
                            {ordinal(current.grade)} Gr
                          </div>
                        )}
                      </div>
                      <h2 style={S.cardName}>{current?.name}</h2>

                      {bdayStatus && (
                        <div style={{ ...S.bdayChip, ...(bdayStatus.urgent ? S.bdayChipUrgent : {}) }}>{bdayStatus.label}</div>
                      )}
                      {current?.birthday && !bdayStatus && (
                        <div style={S.bdayQuiet}><Cake size={11} style={{ marginRight: 5, opacity: 0.5 }} />{formatBirthday(current.birthday)}</div>
                      )}

                      <div style={S.cardPrayedRow}>
                        {withinWeek(current?.prayedAt) ? (
                          <span style={S.prayedChip}>✓ Prayed {timeAgo(current.prayedAt)}</span>
                        ) : current?.prayedAt ? (
                          <span style={S.lastPrayedChip}>Last: {timeAgo(current.prayedAt)}</span>
                        ) : (
                          <span style={S.neverChip}>Not yet prayed for</span>
                        )}
                      </div>

                      {(current?.prayerRequests || []).length > 0 && (
                        <div style={S.reqBox}>
                          <p style={S.reqLabel}>Prayer Requests</p>
                          {current.prayerRequests.map((req, i) => (
                            <div key={i} style={S.reqItem}>
                              <span style={S.reqDot}>◆</span>
                              <span style={S.reqText}>{req}</span>
                              <button onClick={() => removeRequest(current.id, i)} style={S.reqRemove}><X size={11} /></button>
                            </div>
                          ))}
                        </div>
                      )}

                      {reqFor === current?.id ? (
                        <div style={S.reqInputRow}>
                          <input autoFocus value={reqText} onChange={e => setReqText(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") addRequest(current.id); if (e.key === "Escape") setReqFor(null); }}
                            placeholder="Enter prayer request…" style={S.reqInput} />
                          <button onClick={() => addRequest(current.id)} style={S.reqAddBtn}>Add</button>
                          <button onClick={() => setReqFor(null)} style={S.reqCancelBtn}><X size={13} /></button>
                        </div>
                      ) : (
                        <button onClick={() => setReqFor(current?.id)} style={S.addReqTrigger}>
                          <Plus size={13} style={{ marginRight: 4 }} /> Add Request
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={S.navRow}>
                    <button onClick={() => nav(-1)} style={S.navArrow}><ChevronLeft size={22} /></button>
                    <span style={S.counter}>
                      {pinnedPerson ? "★" : `${cardIdx + 1}`}
                      <span style={{ color: "#5a4832" }}> / </span>
                      {deck.length}
                    </span>
                    <button onClick={() => nav(1)} style={S.navArrow}><ChevronRight size={22} /></button>
                  </div>

                  {withinWeek(current?.prayedAt) ? (
                    <div style={S.prayedActions}>
                      <div style={S.prayedConfirm}><Heart size={16} fill="#9dc88d" color="#9dc88d" style={{ marginRight: 7 }} /> Prayed!</div>
                      {!pinnedPerson && <button onClick={unmarkPrayed} style={S.undoBtn}>Undo</button>}
                      {pinnedPerson && <button onClick={() => setPinnedPersonId(null)} style={S.undoBtn}>Back</button>}
                    </div>
                  ) : (
                    <button onClick={markPrayed} style={S.prayBtn}>
                      <Heart size={16} style={{ marginRight: 8 }} /> Mark as Prayed
                    </button>
                  )}

                  {/* Quick-find dropdown */}
                  {(() => {
                    const dropList = getFiltered().slice().sort((a, b) => a.name.localeCompare(b.name));
                    return (
                      <div style={S.ddWrap}>
                        <button onClick={() => setDropdownOpen(o => !o)} style={S.ddToggle}>
                          <span>Select a specific name</span>
                          <span style={{ fontSize: 10, opacity: 0.5 }}>{dropdownOpen ? "▲" : "▼"}</span>
                        </button>
                        {dropdownOpen && (
                          <div style={S.ddList}>
                            {dropList.map(p => (
                              <button key={p.id} onClick={() => selectFromDropdown(p.id)}
                                style={{ ...S.ddItem, ...(withinWeek(p.prayedAt) ? S.ddItemPrayed : {}) }}>
                                <span>{p.name}</span>
                                <span style={S.ddItemMeta}>
                                  {withinWeek(p.prayedAt) ? "✓ prayed" : ""}
                                  {p.group ? ` ${p.group.toUpperCase()}` : ""}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── WEEK SUMMARY ─── */}
      {view === "week" && (
        <div style={S.weekWrap}>
          <h2 style={S.weekTitle}>This Week</h2>

          {upcomingBdays.length > 0 && (
            <div style={S.weekSection}>
              <div style={S.sectionHead}>
                <Cake size={13} color={C.gold} style={{ marginRight: 7 }} />
                <span style={S.sectionTitle}>Upcoming Birthdays</span>
              </div>
              {upcomingBdays.map(({ person, diff, date }) => (
                <div key={person.id} onClick={() => goToPerson(person.id)} style={{ ...S.weekRow, ...(diff === 0 ? { background: "#1e1608" } : {}), cursor: "pointer" }}>
                  <div>
                    <div style={S.weekName}>{person.name}</div>
                    <div style={S.weekMeta}>{diff === 0 ? "🎉 Today!" : diff === 1 ? "Tomorrow" : date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {person.group && <span style={{ ...S.badgeSm, ...(person.group === "hs" ? S.hsBadgeSm : S.msBadgeSm) }}>{person.group.toUpperCase()}</span>}
                    <span style={{ ...S.badgeSm, ...(person.type === "leader" ? S.leaderBadgeSm : S.studentBadgeSm) }}>{person.type}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={S.weekSection}>
            <div style={S.sectionHead}>
              <Heart size={13} fill={C.prayedGreen} color={C.prayedGreen} style={{ marginRight: 7 }} />
              <span style={S.sectionTitle}>Prayed For — {prayedThis.length}</span>
            </div>
            {prayedThis.length === 0
              ? <p style={S.weekEmpty}>No one marked yet this week.</p>
              : prayedThis.map(p => (
                <div key={p.id} onClick={() => goToPerson(p.id)} style={{ ...S.weekRow, cursor: "pointer" }}>
                  <div>
                    <div style={S.weekName}>{p.name}</div>
                    <div style={S.weekMeta}>{timeAgo(p.prayedAt)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {(p.prayerRequests || []).length > 0 && <span style={S.reqCountBadge}>{p.prayerRequests.length} req</span>}
                    <span style={{ color: C.prayedGreen, fontSize: 18 }}>✓</span>
                  </div>
                </div>
              ))
            }
          </div>

          <div style={S.weekSection}>
            <div style={S.sectionHead}>
              <div style={{ width: 13, height: 13, borderRadius: "50%", border: `1.5px solid ${C.muted}`, marginRight: 7, flexShrink: 0 }} />
              <span style={S.sectionTitle}>Still Waiting — {notPrayedThis.length}</span>
            </div>
            {notPrayedThis.length === 0 ? (
              <div style={S.allPrayedBanner}>
                <Heart size={22} fill={C.gold} color={C.gold} />
                <span style={S.allPrayedText}>Everyone prayed for this week!</span>
              </div>
            ) : notPrayedThis.map(p => (
              <div key={p.id} onClick={() => goToPerson(p.id)} style={{ ...S.weekRow, cursor: "pointer" }}>
                <div>
                  <div style={{ ...S.weekName, color: C.muted }}>{p.name}</div>
                  {p.prayedAt && <div style={S.weekMeta}>Last: {timeAgo(p.prayedAt)}</div>}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {p.group && <span style={{ ...S.badgeSm, ...(p.group === "hs" ? S.hsBadgeSm : S.msBadgeSm) }}>{p.group.toUpperCase()}</span>}
                  <span style={{ ...S.badgeSm, ...(p.type === "leader" ? S.leaderBadgeSm : S.studentBadgeSm) }}>{p.type}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── PEOPLE ─── */}
      {view === "people" && (
        <div style={S.peopleWrap}>
          <div style={S.addRow}>
            <input value={addName} onChange={e => setAddName(e.target.value)} onKeyDown={e => e.key === "Enter" && addPerson()} placeholder="Full name" style={S.addInput} />
            <select value={addType} onChange={e => setAddType(e.target.value)} style={S.addTypeSelect}>
              <option value="student">Student</option>
              <option value="leader">Leader</option>
            </select>
            <select value={addGroup} onChange={e => setAddGroup(e.target.value)} style={S.addTypeSelect}>
              <option value="hs">HS</option>
              <option value="ms">MS</option>
            </select>
            {addType === "student" && (
              <select value={addGrade} onChange={e => setAddGrade(e.target.value)} style={S.addTypeSelect}>
                <option value="">Gr</option>
                {[6,7,8,9,10,11,12].map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            <button onClick={addPerson} style={S.addPersonBtn}><Plus size={16} /></button>
          </div>

          <div style={S.statRow}>
            {[[`${activePeople.length}`, "total"], [`${activePeople.filter(p => p.group === "hs").length}`, "HS"], [`${activePeople.filter(p => p.group === "ms").length}`, "MS"], [`${prayedCount}`, "prayed ✓"]].map(([n, l]) => (
              <div key={l} style={S.statChip}><span style={S.statNum}>{n}</span><span style={S.statLbl}>{l}</span></div>
            ))}
          </div>

          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people…" style={{ ...S.addInput, marginBottom: 4 }} />

          <div style={S.personList}>
            {activePeople.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)).map(p => (
              <div key={p.id} style={S.personCard}>
                <div style={S.personRow}>
                  <div style={S.personLeft}>
                    {editNameFor === p.id ? (
                      <div style={S.nameEditRow}>
                        <input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") saveName(p.id); if (e.key === "Escape") setEditNameFor(null); }}
                          style={S.nameInput} />
                        <button onClick={() => saveName(p.id)} style={S.reqAddBtn}>Save</button>
                        <button onClick={() => setEditNameFor(null)} style={S.reqCancelBtn}><X size={12} /></button>
                      </div>
                    ) : (
                      <div style={S.nameRow}>
                        <span style={S.personName}>{p.name}</span>
                        <button onClick={() => { setEditNameFor(p.id); setNameInput(p.name); setEditBdayFor(null); }}
                          style={S.editNameBtn} title="Edit name">✎</button>
                      </div>
                    )}
                    <div style={S.personMeta}>
                      <span style={{ ...S.badgeSm, ...(p.type === "leader" ? S.leaderBadgeSm : S.studentBadgeSm) }}>{p.type}</span>
                      {p.group && <span style={{ ...S.badgeSm, ...(p.group === "hs" ? S.hsBadgeSm : S.msBadgeSm) }}>{p.group.toUpperCase()}</span>}
                      {p.type === "student" && p.grade && <span style={S.gradeBadge}>{ordinal(p.grade)} Gr</span>}
                      {withinWeek(p.prayedAt) && <span style={S.prayedSmall}>✓ prayed</span>}
                      {(p.prayerRequests || []).length > 0 && <span style={S.reqCountBadge}>{p.prayerRequests.length} req</span>}
                      {p.birthday && <span style={S.bdayBadgeSm}><Cake size={9} style={{ marginRight: 3 }} />{formatBirthday(p.birthday)}</span>}
                    </div>
                  </div>
                  <div style={S.personActions}>
                    <button onClick={() => { setEditBdayFor(editBdayFor === p.id ? null : p.id); setBdayInput(p.birthday || ""); setEditNameFor(null); }}
                      style={{ ...S.iconBtn, color: p.birthday ? C.gold : C.muted }} title="Set birthday"><Cake size={13} /></button>
                    <button onClick={() => cycleGroup(p.id)} style={{ ...S.iconBtn, color: p.group === "hs" ? "#7aafc4" : p.group === "ms" ? "#c49a6c" : C.muted }} title="Cycle HS/MS/none">
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.02em" }}>{p.group ? p.group.toUpperCase() : "—"}</span>
                    </button>
                    <button onClick={() => toggleType(p.id)} style={S.iconBtn} title="Toggle role"><RefreshCw size={13} /></button>
                    <button onClick={() => deactivate(p.id)} style={{ ...S.iconBtn, color: "#7a5040" }} title="Make inactive"><Trash2 size={13} /></button>
                  </div>
                </div>
                {editBdayFor === p.id && (
                  <div style={S.bdayEditRow}>
                    <Cake size={13} style={{ color: C.gold, flexShrink: 0 }} />
                    <input autoFocus value={bdayInput} onChange={e => setBdayInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveBirthday(p.id, parseBirthdayStr(bdayInput)); if (e.key === "Escape") setEditBdayFor(null); }}
                      placeholder="MM-DD  e.g. 03-15" style={S.bdayInput} />
                    <button onClick={() => saveBirthday(p.id, parseBirthdayStr(bdayInput))} style={S.reqAddBtn}>Save</button>
                    {p.birthday && <button onClick={() => saveBirthday(p.id, "")} style={S.reqCancelBtn} title="Clear"><X size={12} /></button>}
                  </div>
                )}
                {p.type === "student" && (
                  <div style={S.gradeRow}>
                    <span style={S.gradeLabel}>Grade</span>
                    <select value={p.grade || ""} onChange={e => setPeople(prev => prev.map(q => q.id === p.id ? { ...q, grade: e.target.value ? Number(e.target.value) : null } : q))}
                      style={S.gradeSelect}>
                      <option value="">—</option>
                      {[6,7,8,9,10,11,12].map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* End-of-year grade promotion */}
          <div style={S.promoteSection}>
            {!confirmPromo ? (
              <button onClick={() => setConfirmPromo(true)} style={S.promoteBtn}>
                🎓 End of Year — Promote All Grades
              </button>
            ) : (
              <div style={S.promoteConfirm}>
                <p style={S.promoteConfirmText}>Move every student up one grade? 12th graders will be made inactive.</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={promoteGrades} style={S.confirmBtn}>Yes, Promote</button>
                  <button onClick={() => setConfirmPromo(false)} style={S.cancelBtn}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {people.filter(p => p.active === false).length > 0 && (
            <div style={S.inactiveSection}>
              <p style={S.inactiveHeading}>Inactive</p>
              {people.filter(p => p.active === false).map(p => (
                <div key={p.id} style={S.inactiveRow}>
                  <span style={S.inactiveName}>{p.name}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => restore(p.id)} style={S.restoreBtn}>Restore</button>
                    <button onClick={() => deletePerm(p.id)} style={S.deleteBtn}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── IMPORT ─── */}
      {view === "import" && (
        <div style={S.importWrap}>
          <h3 style={S.importTitle}>Import CSV</h3>
          <p style={S.importDesc}>
            Just export whatever roster you already have. The importer only looks for name and birthday columns — everything else is ignored.
          </p>

          <div style={S.importRulesBox}>
            <div style={S.importRule}>
              <span style={S.importRuleIcon}>👤</span>
              <div>
                <strong style={{ color: C.cream }}>Names</strong> — recognizes columns like <code style={S.code}>Name</code>, <code style={S.code}>First Name</code>, <code style={S.code}>Last Name</code>, <code style={S.code}>Student</code>. Separate first/last columns are joined automatically. "Smith, John" format is flipped to "John Smith".
              </div>
            </div>
            <div style={S.importRule}>
              <span style={S.importRuleIcon}>🎂</span>
              <div>
                <strong style={{ color: C.cream }}>Birthdays</strong> — recognizes <code style={S.code}>Birthday</code>, <code style={S.code}>DOB</code>, <code style={S.code}>Birthdate</code>. Accepts MM/DD, MM-DD, or "March 15".
              </div>
            </div>
            <div style={S.importRule}>
              <span style={S.importRuleIcon}>📋</span>
              <div>All imported people start as <strong style={{ color: C.cream }}>Students</strong>. Change roles in the People tab after importing.</div>
            </div>
          </div>

          <pre style={S.csvPreview}>{`Last Name,First Name,Grade,Email,DOB\nSmith,John,10,j@school.edu,03/15\nLee,Sarah,11,s@school.edu,11-02\nBrown,Mike,9,,`}</pre>
          <p style={S.importNote}>Above: a messy real-world export — Grade and Email columns are simply ignored.</p>

          <button onClick={() => fileRef.current.click()} style={S.uploadBtn}>
            <Upload size={16} style={{ marginRight: 8 }} /> Choose File
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: "none" }} />

          {importData && (
            <div style={S.previewBox}>
              <p style={S.previewTitle}>Preview — {importData.length} people found</p>
              <div style={S.previewScroll}>
                {importData.slice(0, 12).map((p, i) => (
                  <div key={i} style={S.previewRow}>
                    <span style={S.previewName}>{p.name}</span>
                    {p.birthday
                      ? <span style={S.bdayBadgeSm}><Cake size={9} style={{ marginRight: 3 }} />{formatBirthday(p.birthday)}</span>
                      : <span style={{ fontSize: 11, color: C.faint }}>no birthday</span>
                    }
                  </div>
                ))}
                {importData.length > 12 && <p style={S.moreText}>and {importData.length - 12} more</p>}
              </div>
              <div style={S.previewBtnRow}>
                <button onClick={confirmImport} style={S.confirmBtn}>Import All</button>
                <button onClick={() => setImportData(null)} style={S.cancelBtn}>Cancel</button>
              </div>
            </div>
          )}

          <div style={S.suggestBox}>
            <p style={S.suggestTitle}>💡 Still on the roadmap</p>
            <ul style={S.suggestList}>
              {["Prayer streak — consecutive weeks praying for everyone", "Prayer history log — timestamped journal per person", "Groups — organize by small group, grade, or team", "Notes field — free-form notes per person", "Completed requests — mark a request answered and archive it"].map((s, i) => (
                <li key={i} style={S.suggestItem}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {/* Admin footer link */}
      <div style={S.adminFooter}>
        {adminAuthed
          ? <button onClick={() => { setAdminAuthedState(false); localStorage.removeItem(ADMIN_KEY); setView("pray"); }} style={S.adminLink}>lock admin</button>
          : <button onClick={() => { setAdminPwInput(""); setAdminPwError(""); setShowAdminPrompt(true); }} style={S.adminLink}>admin</button>
        }
      </div>
    </div>
  );
}

/* ── Colors ─────────────────────────────────────────────── */
const C = {
  bg: "#0e0c09", surface: "#1b1610", card: "#231d14", border: "#2e2518",
  gold: "#c9982a", goldLight: "#e8b84b", cream: "#e2cfb0", muted: "#7d6a52", faint: "#3d3226",
  student: "#4e84a0", studentBg: "#162533", leader: "#72966a", leaderBg: "#182115",
  prayedGreen: "#8fc47f", prayedBg: "#131e10",
};

/* ── Styles ─────────────────────────────────────────────── */
const S = {
  root: { minHeight: "100vh", background: C.bg, color: C.cream, fontFamily: "'DM Sans', sans-serif", fontSize: 14, maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 20px 0" },
  logoWrap: { display: "flex", alignItems: "center", gap: 8 },
  logoCross: { fontSize: 18, color: C.gold },
  logoText: { fontFamily: "'Cormorant Garamond', serif", fontSize: 26, fontWeight: 400, color: C.cream, letterSpacing: "0.04em" },
  weekBar: { display: "flex", alignItems: "center", gap: 6, background: "#1f1810", border: `1px solid ${C.border}`, borderRadius: 20, padding: "5px 12px" },
  weekText: { fontSize: 12, color: C.muted },
  bdayAlert: { fontSize: 11, background: "#2a1e08", color: C.gold, borderRadius: 10, padding: "2px 7px 2px 6px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3, verticalAlign: "middle" },
  progressTrack: { margin: "14px 20px 0", height: 3, background: C.faint, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", background: `linear-gradient(90deg, ${C.gold}, ${C.goldLight})`, borderRadius: 2, transition: "width 0.6s ease" },
  tabs: { display: "flex", borderBottom: `1px solid ${C.border}`, margin: "14px 0 0" },
  tab: { flex: 1, background: "none", border: "none", color: C.muted, padding: "10px 0", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 400, letterSpacing: "0.04em", transition: "color 0.2s" },
  tabActive: { color: C.goldLight, borderBottom: `2px solid ${C.gold}`, marginBottom: -1, fontWeight: 500 },
  // PRAY
  prayWrap: { flex: 1, display: "flex", flexDirection: "column", padding: "16px 20px 28px" },
  controls: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  togglePill: { display: "flex", background: C.faint, borderRadius: 20, padding: 2 },
  toggleOpt: { background: "none", border: "none", color: C.muted, padding: "5px 14px", borderRadius: 18, cursor: "pointer", fontSize: 12, fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s" },
  toggleOptOn: { background: C.surface, color: C.cream, fontWeight: 500 },
  filterSelect: { background: C.faint, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 20, padding: "5px 12px", fontSize: 12, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", outline: "none", flex: 1 },
  reshuffleBtn: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 20, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 },
  swipeHint: { fontSize: 11, color: "#3a3020", textAlign: "center", marginBottom: 8, letterSpacing: "0.05em" },
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, paddingBottom: 60 },
  emptyTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: C.muted, margin: 0 },
  emptySub: { fontSize: 13, color: C.faint, margin: 0, textAlign: "center" },
  cardOuter: { position: "relative", margin: "0 0 20px", touchAction: "pan-y" },
  cardGhost: { position: "absolute", inset: 0, background: C.card, borderRadius: 18, border: `1px solid ${C.border}` },
  card: { position: "relative", background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: "28px 24px 22px", display: "flex", flexDirection: "column", gap: 0, boxShadow: "0 8px 40px rgba(0,0,0,0.5)", userSelect: "none" },
  cardDone: { background: C.prayedBg, borderColor: "#2a3d24" },
  badge: { display: "inline-flex", alignSelf: "flex-start", padding: "3px 11px", borderRadius: 12, fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 14 },
  studentBadge: { background: C.studentBg, color: C.student, border: `1px solid ${C.student}33` },
  leaderBadge: { background: C.leaderBg, color: C.leader, border: `1px solid ${C.leader}33` },
  cardName: { fontFamily: "'Cormorant Garamond', serif", fontSize: 40, fontWeight: 400, lineHeight: 1.1, color: C.cream, margin: "0 0 10px" },
  bdayChip: { display: "inline-flex", alignItems: "center", background: "#221a08", border: `1px solid #5a3e10`, color: C.gold, borderRadius: 10, padding: "4px 10px", fontSize: 12, marginBottom: 10 },
  bdayChipUrgent: { background: "#2e1e04", borderColor: C.gold, color: C.goldLight, fontWeight: 500 },
  bdayQuiet: { display: "flex", alignItems: "center", fontSize: 11, color: "#4a3e2a", marginBottom: 8 },
  cardPrayedRow: { marginBottom: 18 },
  prayedChip: { fontSize: 12, color: C.prayedGreen, background: "#1a2e18", padding: "3px 10px", borderRadius: 10 },
  lastPrayedChip: { fontSize: 12, color: C.muted },
  neverChip: { fontSize: 12, color: "#5a4a3a", fontStyle: "italic" },
  reqBox: { background: "#1a150e", borderRadius: 10, padding: "12px 14px", marginBottom: 14 },
  reqLabel: { fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 8px" },
  reqItem: { display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  reqDot: { color: C.gold, fontSize: 8, marginTop: 3, flexShrink: 0 },
  reqText: { flex: 1, fontSize: 13, color: "#c4b090", lineHeight: 1.4 },
  reqRemove: { background: "none", border: "none", color: "#5a4832", cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 },
  reqInputRow: { display: "flex", gap: 6, alignItems: "center", marginTop: 4 },
  reqInput: { flex: 1, background: "#1a150e", border: `1px solid ${C.border}`, borderRadius: 8, color: C.cream, padding: "7px 10px", fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none" },
  reqAddBtn: { background: C.gold, border: "none", color: "#0e0c09", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  reqCancelBtn: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  addReqTrigger: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", alignSelf: "flex-start", marginTop: 8, fontFamily: "'DM Sans', sans-serif" },
  navRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 20, marginBottom: 16 },
  navArrow: { background: C.surface, border: `1px solid ${C.border}`, color: C.muted, borderRadius: "50%", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  counter: { fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: C.muted, minWidth: 60, textAlign: "center" },
  prayBtn: { background: `linear-gradient(135deg, ${C.gold}, #b8821e)`, border: "none", color: "#0e0c09", borderRadius: 12, padding: "14px 0", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 4px 20px rgba(201,152,42,0.3)" },
  prayedActions: { display: "flex", alignItems: "center", justifyContent: "center", gap: 12 },
  prayedConfirm: { display: "flex", alignItems: "center", color: C.prayedGreen, fontSize: 15, fontWeight: 500 },
  undoBtn: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  // WEEK
  weekWrap: { flex: 1, padding: "16px 20px 32px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" },
  weekTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: C.cream, margin: 0, fontWeight: 400 },
  weekSection: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" },
  sectionHead: { display: "flex", alignItems: "center", padding: "11px 14px", borderBottom: `1px solid ${C.border}`, background: "#161109" },
  sectionTitle: { fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.09em", fontWeight: 500 },
  weekRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${C.faint}` },
  weekName: { fontSize: 14, color: C.cream },
  weekMeta: { fontSize: 11, color: C.muted, marginTop: 2 },
  weekEmpty: { fontSize: 13, color: "#3a3020", padding: "16px 14px", margin: 0, textAlign: "center", fontStyle: "italic" },
  allPrayedBanner: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "22px 14px" },
  allPrayedText: { fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: C.gold, textAlign: "center" },
  // PEOPLE
  peopleWrap: { flex: 1, padding: "16px 20px 28px", display: "flex", flexDirection: "column", gap: 10 },
  addRow: { display: "flex", gap: 8 },
  addInput: { flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, color: C.cream, padding: "10px 12px", fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none" },
  addTypeSelect: { background: C.surface, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 10, padding: "10px 10px", fontSize: 12, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", outline: "none" },
  addPersonBtn: { background: C.gold, border: "none", color: "#0e0c09", borderRadius: 10, width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 },
  statRow: { display: "flex", gap: 6 },
  statChip: { flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 },
  statNum: { fontSize: 18, fontFamily: "'Cormorant Garamond', serif", color: C.cream },
  statLbl: { fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" },
  personList: { display: "flex", flexDirection: "column", gap: 4 },
  personCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" },
  personRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px" },
  personLeft: { display: "flex", flexDirection: "column", gap: 4 },
  personName: { fontSize: 14, color: C.cream },
  personMeta: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  badgeSm: { fontSize: 10, padding: "2px 8px", borderRadius: 8, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 },
  studentBadgeSm: { background: C.studentBg, color: C.student },
  leaderBadgeSm: { background: C.leaderBg, color: C.leader },
  prayedSmall: { fontSize: 11, color: C.prayedGreen },
  reqCountBadge: { fontSize: 11, color: C.gold, background: "#241c0a", padding: "1px 7px", borderRadius: 8 },
  bdayBadgeSm: { display: "inline-flex", alignItems: "center", fontSize: 10, color: "#8a7040", background: "#1e1608", padding: "1px 7px", borderRadius: 8 },
  personActions: { display: "flex", gap: 6 },
  iconBtn: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  gradeBadge: { fontSize: 10, padding: "2px 7px", borderRadius: 8, background: "#1e1a10", color: "#9a8850", fontWeight: 500 },
  gradeBadgeLg: { background: "#1e1a10", color: "#9a8850", border: "1px solid #9a885033", marginBottom: 0 },
  gradeRow: { display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderTop: `1px solid ${C.faint}`, background: "#141108" },
  gradeLabel: { fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 },
  gradeSelect: { background: "#0e0c09", border: `1px solid ${C.border}`, borderRadius: 7, color: C.cream, padding: "4px 8px", fontSize: 13, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", outline: "none" },
  promoteSection: { marginTop: 4 },
  promoteBtn: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 10, padding: "11px 16px", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", width: "100%", textAlign: "left" },
  promoteConfirm: { background: "#1a150a", border: `1px solid #3a2e10`, borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 },
  promoteConfirmText: { fontSize: 13, color: C.cream, margin: 0, lineHeight: 1.5 },
  nameRow: { display: "flex", alignItems: "center", gap: 6 },
  editNameBtn: { background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1 },
  nameEditRow: { display: "flex", alignItems: "center", gap: 6, marginBottom: 2 },
  nameInput: { flex: 1, background: "#0e0c09", border: `1px solid ${C.border}`, borderRadius: 8, color: C.cream, padding: "5px 8px", fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none", minWidth: 0 },
  bdayEditRow: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: `1px solid ${C.faint}`, background: "#171209" },
  bdayInput: { flex: 1, background: "#0e0c09", border: `1px solid ${C.border}`, borderRadius: 8, color: C.cream, padding: "6px 10px", fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none" },
  inactiveSection: { marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 12 },
  inactiveHeading: { fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px" },
  inactiveRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.faint}` },
  inactiveName: { fontSize: 13, color: C.muted },
  restoreBtn: { background: "none", border: `1px solid ${C.border}`, color: C.leader, borderRadius: 7, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  deleteBtn: { background: "none", border: `1px solid #3a1a1a`, color: "#8a5050", borderRadius: 7, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  // IMPORT
  importWrap: { flex: 1, padding: "16px 20px 28px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" },
  importTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 26, color: C.cream, margin: 0, fontWeight: 400 },
  importDesc: { fontSize: 13, color: C.muted, margin: 0 },
  importNote: { fontSize: 12, color: C.muted, margin: "0" },
  importRulesBox: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "4px 0", display: "flex", flexDirection: "column" },
  importRule: { display: "flex", gap: 12, padding: "11px 14px", borderBottom: `1px solid ${C.faint}`, fontSize: 12, color: C.muted, lineHeight: 1.5, alignItems: "flex-start" },
  importRuleIcon: { fontSize: 16, flexShrink: 0, marginTop: 1 },
  code: { background: C.faint, padding: "1px 6px", borderRadius: 4, fontSize: 11, color: C.gold, fontFamily: "monospace" },
  csvPreview: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", fontSize: 12, color: "#8a7660", margin: 0, lineHeight: 1.6, fontFamily: "monospace", overflowX: "auto" },
  uploadBtn: { background: C.surface, border: `1px solid ${C.border}`, color: C.cream, borderRadius: 10, padding: "12px 20px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", fontFamily: "'DM Sans', sans-serif", alignSelf: "flex-start" },
  previewBox: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" },
  previewTitle: { fontSize: 12, color: C.muted, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.06em" },
  previewScroll: { display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" },
  previewRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.faint}` },
  previewName: { fontSize: 13, color: C.cream },
  moreText: { fontSize: 12, color: C.muted, margin: "6px 0 0", textAlign: "center" },
  previewBtnRow: { display: "flex", gap: 8, marginTop: 12 },
  confirmBtn: { background: `linear-gradient(135deg, ${C.gold}, #b8821e)`, border: "none", color: "#0e0c09", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  cancelBtn: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  suggestBox: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px", marginTop: 4 },
  suggestTitle: { fontSize: 13, color: C.gold, margin: "0 0 10px", fontWeight: 500 },
  suggestList: { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 },
  suggestItem: { fontSize: 12, color: C.muted, lineHeight: 1.5 },
  // ADMIN FOOTER
  adminFooter: { display: "flex", justifyContent: "center", padding: "12px 0 20px", marginTop: "auto" },
  adminLink: { background: "none", border: "none", color: "#2e2518", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.06em" },
  // MODAL
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 },
  modalBox: { background: "#1b1610", border: "1px solid #2e2518", borderRadius: 16, padding: "28px 24px", width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: 14 },
  modalTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#e2cfb0", margin: 0, textAlign: "center" },
  modalInput: { background: "#0e0c09", border: "1px solid #2e2518", borderRadius: 10, color: "#e2cfb0", padding: "12px 14px", fontSize: 16, fontFamily: "'DM Sans', sans-serif", outline: "none", textAlign: "center", letterSpacing: "0.08em" },
  modalError: { fontSize: 12, color: "#c07070", margin: 0, textAlign: "center" },
  modalBtns: { display: "flex", gap: 8 },
  // DROPDOWN
  ddWrap: { marginTop: 12, display: "flex", flexDirection: "column" },
  ddToggle: { background: "#1b1610", border: "1px solid #2e2518", borderRadius: 10, color: "#7d6a52", padding: "10px 14px", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", display: "flex", justifyContent: "space-between", alignItems: "center" },
  ddList: { background: "#161109", border: "1px solid #2e2518", borderTop: "none", borderRadius: "0 0 10px 10px", maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column" },
  ddItem: { background: "none", border: "none", borderBottom: "1px solid #1e1810", color: "#e2cfb0", padding: "11px 14px", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left" },
  ddItemPrayed: { color: "#4a5e44" },
  ddItemMeta: { fontSize: 11, color: "#3a3020", marginLeft: 8, flexShrink: 0 },
  // TAP TO BEGIN
  tapCard: { cursor: "pointer", alignItems: "center", justifyContent: "center", minHeight: 220, gap: 10, animation: "tapPulse 2s ease-in-out infinite" },
  tapCross: { fontSize: 28, color: C.gold, marginBottom: 8 },
  tapTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 36, fontWeight: 400, color: C.cream, margin: 0, textAlign: "center" },
  tapSub: { fontSize: 13, color: C.muted, margin: 0, textAlign: "center" },
  // GROUP BADGES
  badgeRow: { display: "flex", gap: 6, marginBottom: 14 },
  hsBadge: { background: "#162533", color: "#7aafc4", border: "1px solid #7aafc433", marginBottom: 0 },
  msBadge: { background: "#2a1e0a", color: "#c49a6c", border: "1px solid #c49a6c33", marginBottom: 0 },
  hsBadgeSm: { background: "#162533", color: "#7aafc4" },
  msBadgeSm: { background: "#2a1e0a", color: "#c49a6c" },
};
