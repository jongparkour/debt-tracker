/* ============================================================
   app.js — Core logic & UI
   Depends on db.js (DebtorsDB, PaymentsDB)
   ============================================================ */

/* -------------------- Helpers -------------------- */

/** Format a number as Philippine Peso, e.g. 1234.5 -> ₱1,234.50 */
function peso(n) {
  const value = Number(n) || 0;
  return (
    "₱" +
    value.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** "2026-07-07T..." -> "Jul 7, 2026" */
function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "2026-07-07T..." -> { key: "2026-07", label: "Jul 2026" } */
function monthOf(iso) {
  const d = new Date(iso);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const label = d.toLocaleDateString("en-PH", {
    month: "short",
    year: "numeric",
  });
  return { key, label };
}

/** Escape user text before inserting as HTML. */
function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const $ = (id) => document.getElementById(id);

let toastTimer = null;
let toastHideTimer = null;
function toast(msg) {
  const t = $("toast");
  clearTimeout(toastTimer);
  clearTimeout(toastHideTimer);

  t.textContent = msg;
  t.classList.remove("hidden");
  void t.offsetWidth; // force reflow so the transition plays from the start
  t.classList.add("show");

  toastTimer = setTimeout(() => {
    t.classList.remove("show"); // fade out
    toastHideTimer = setTimeout(() => t.classList.add("hidden"), 260);
  }, 2200);
}

/* -------------------- Debtor CRUD -------------------- */

async function addDebtor() {
  const name = $("name").value.trim();
  const totalDebt = Number($("debt").value);
  const paymentRule = $("rule").value.trim();

  if (!name) return toast("Please enter a name.");
  if (!(totalDebt > 0)) return toast("Enter a valid total debt.");

  await DebtorsDB.add({ name, totalDebt, paymentRule });

  $("name").value = "";
  $("debt").value = "";
  $("rule").value = "";
  toast("Debtor added.");
  loadDebtors(true);
}

async function deleteDebtor(id) {
  const d = await DebtorsDB.get(id);
  if (!d) return;
  if (!confirm(`Delete "${d.name}" and all their payments?`)) return;

  await PaymentsDB.deleteByDebtor(id);
  await DebtorsDB.delete(id);
  toast("Debtor deleted.");

  // If we were viewing this debtor's details, go back to the list.
  if (currentDetailId === Number(id)) showList();
  else loadDebtors();
}

/* -------------------- Payment CRUD -------------------- */

async function addPayment(debtorId, amount) {
  const amt = Number(amount);
  if (!(amt > 0)) return toast("Enter a valid payment amount.");

  await PaymentsDB.add({
    debtorId: Number(debtorId),
    amount: amt,
    date: new Date().toISOString(),
  });
  toast("Payment recorded.");
  refreshCurrentView();
}

async function deletePayment(paymentId) {
  if (!confirm("Delete this payment?")) return;
  await PaymentsDB.delete(paymentId);
  toast("Payment deleted.");
  refreshCurrentView();
}

/* -------------------- Totals -------------------- */

function totals(debtor, payments) {
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const remaining = Number(debtor.totalDebt || 0) - paid;
  return { paid, remaining };
}

/* -------------------- List View -------------------- */

// Search / filter state
let searchTerm = "";
let statusFilter = "all"; // all | active | paid

async function loadDebtors(animateCards = false) {
  const [debtors, allPayments] = await Promise.all([
    DebtorsDB.getAll(),
    PaymentsDB.getAll(),
  ]);

  const list = $("list");
  list.innerHTML = "";

  $("empty").classList.toggle("hidden", debtors.length > 0);

  // Apply search + status filter.
  const term = searchTerm.trim().toLowerCase();
  const visible = debtors.filter((d) => {
    const payments = allPayments.filter((p) => p.debtorId === d.id);
    const { remaining } = totals(d, payments);

    if (term && !d.name.toLowerCase().includes(term)) return false;
    if (statusFilter === "active" && remaining <= 0) return false;
    if (statusFilter === "paid" && remaining > 0) return false;
    return true;
  });

  // "No matches" only when there ARE debtors but none pass the filter.
  $("noMatch").classList.toggle(
    "hidden",
    !(debtors.length > 0 && visible.length === 0)
  );

  let grandRemaining = 0;

  visible.forEach((d, i) => {
    const payments = allPayments.filter((p) => p.debtorId === d.id);
    const { paid, remaining } = totals(d, payments);
    grandRemaining += remaining;

    const card = document.createElement("div");
    card.className = "card";
    if (animateCards) {
      card.classList.add("enter");
      // Stagger the fade, capped so a long list doesn't crawl in.
      card.style.animationDelay = Math.min(i, 8) * 45 + "ms";
    }
    card.innerHTML = `
      <div class="card-head">
        <h3>${esc(d.name)}</h3>
        <span class="pill ${remaining <= 0 ? "paid" : ""}">
          ${remaining <= 0 ? "Settled" : peso(remaining) + " left"}
        </span>
      </div>
      <div class="stats">
        <div><span class="muted">Total</span><b>${peso(d.totalDebt)}</b></div>
        <div><span class="muted">Paid</span><b>${peso(paid)}</b></div>
      </div>
      ${d.paymentRule ? `<p class="rule">📋 ${esc(d.paymentRule)}</p>` : ""}
      <div class="progress"><span style="width:${pct(paid, d.totalDebt)}%"></span></div>
      <div class="card-actions">
        <input type="number" inputmode="decimal" min="0" placeholder="Amount"
               class="pay-input" data-id="${d.id}" />
        <button class="btn small primary" data-act="pay" data-id="${d.id}">Add Payment</button>
        <button class="btn small" data-act="view" data-id="${d.id}">View</button>
        <button class="btn small" data-act="edit" data-id="${d.id}">Edit</button>
        <button class="btn small danger" data-act="del" data-id="${d.id}">Delete</button>
      </div>
    `;
    list.appendChild(card);
  });

  const shown = visible.length;
  const filtered = shown !== debtors.length;
  $("summary").textContent = debtors.length
    ? `${filtered ? shown + " of " + debtors.length : debtors.length} debtor${
        debtors.length > 1 ? "s" : ""
      } · ${peso(grandRemaining)} shown`
    : "";
}

function pct(paid, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (paid / total) * 100));
}

/* -------------------- Detail View -------------------- */

let currentDetailId = null;

async function showDetail(id) {
  currentDetailId = Number(id);
  const debtor = await DebtorsDB.get(id);
  if (!debtor) return showList();

  const payments = await PaymentsDB.getByDebtor(id);
  payments.sort((a, b) => new Date(b.date) - new Date(a.date));

  const { paid, remaining } = totals(debtor, payments);

  // Group payments by month
  const groups = {};
  payments.forEach((p) => {
    const { key, label } = monthOf(p.date);
    if (!groups[key]) groups[key] = { label, total: 0, items: [] };
    groups[key].total += Number(p.amount || 0);
    groups[key].items.push(p);
  });
  const monthKeys = Object.keys(groups).sort().reverse();

  let monthsHtml = "";
  if (monthKeys.length === 0) {
    monthsHtml = `<p class="empty">No payments yet.</p>`;
  } else {
    monthsHtml = monthKeys
      .map((k) => {
        const g = groups[k];
        const rows = g.items
          .map(
            (p) => `
          <li class="pay-row">
            <div>
              <b>${peso(p.amount)}</b>
              <span class="muted"> · ${fmtDate(p.date)}</span>
            </div>
            <div class="pay-row-actions">
              <button class="btn tiny" data-act="editpay" data-id="${p.id}">Edit</button>
              <button class="btn tiny danger" data-act="delpay" data-id="${p.id}">Delete</button>
            </div>
          </li>`
          )
          .join("");
        return `
          <div class="month">
            <div class="month-head">
              <span>${esc(g.label)}</span>
              <b>${peso(g.total)}</b>
            </div>
            <ul class="pay-list">${rows}</ul>
          </div>`;
      })
      .join("");
  }

  $("detailContent").innerHTML = `
    <div class="card detail-card">
      <div class="card-head">
        <h2>${esc(debtor.name)}</h2>
        <span class="pill ${remaining <= 0 ? "paid" : ""}">
          ${remaining <= 0 ? "Settled" : peso(remaining) + " left"}
        </span>
      </div>
      <div class="stats big">
        <div><span class="muted">Total</span><b>${peso(debtor.totalDebt)}</b></div>
        <div><span class="muted">Paid</span><b>${peso(paid)}</b></div>
      </div>
      ${debtor.paymentRule ? `<p class="rule">📋 ${esc(debtor.paymentRule)}</p>` : ""}
      <div class="progress"><span style="width:${pct(paid, debtor.totalDebt)}%"></span></div>

      <div class="add-pay">
        <input type="number" inputmode="decimal" min="0" placeholder="Payment amount"
               class="pay-input" id="detailPayInput" />
        <button class="btn primary" data-act="pay" data-id="${debtor.id}">Add Payment</button>
        <button class="btn" data-act="edit" data-id="${debtor.id}">Edit Debtor</button>
      </div>
    </div>

    <h3 class="months-title">Payments by month</h3>
    ${monthsHtml}
  `;

  showView("detailView");
}

/* -------------------- Edit modals -------------------- */

let modalSaveHandler = null;

function openModal(title, bodyHtml, onSave) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = bodyHtml;
  modalSaveHandler = onSave;
  $("modalOverlay").classList.remove("hidden");
}

function closeModal() {
  $("modalOverlay").classList.add("hidden");
  $("modalBody").innerHTML = "";
  modalSaveHandler = null;
}

async function editDebtor(id) {
  const d = await DebtorsDB.get(id);
  if (!d) return;

  openModal(
    "Edit Debtor",
    `
    <div class="field"><label>Name</label>
      <input id="m_name" value="${esc(d.name)}" /></div>
    <div class="field"><label>Total Debt (₱)</label>
      <input id="m_debt" type="number" min="0" value="${esc(d.totalDebt)}" /></div>
    <div class="field"><label>Payment Rule</label>
      <input id="m_rule" value="${esc(d.paymentRule || "")}" /></div>
  `,
    async () => {
      const name = $("m_name").value.trim();
      const totalDebt = Number($("m_debt").value);
      const paymentRule = $("m_rule").value.trim();
      if (!name) return toast("Name is required.");
      if (!(totalDebt > 0)) return toast("Enter a valid total debt.");

      await DebtorsDB.put({ ...d, name, totalDebt, paymentRule });
      closeModal();
      toast("Debtor updated.");
      refreshCurrentView();
    }
  );
}

async function editPayment(id) {
  const p = await PaymentsDB.get(id);
  if (!p) return;

  // datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
  const dt = new Date(p.date);
  const localValue = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  openModal(
    "Edit Payment",
    `
    <div class="field"><label>Amount (₱)</label>
      <input id="m_amt" type="number" min="0" value="${esc(p.amount)}" /></div>
    <div class="field"><label>Date</label>
      <input id="m_date" type="datetime-local" value="${localValue}" /></div>
  `,
    async () => {
      const amount = Number($("m_amt").value);
      const dateVal = $("m_date").value;
      if (!(amount > 0)) return toast("Enter a valid amount.");

      const iso = dateVal ? new Date(dateVal).toISOString() : p.date;
      await PaymentsDB.put({ ...p, amount, date: iso });
      closeModal();
      toast("Payment updated.");
      refreshCurrentView();
    }
  );
}

/* -------------------- View switching -------------------- */

function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(id).classList.remove("hidden");
  window.scrollTo(0, 0);
}

function showList() {
  currentDetailId = null;
  showView("listView");
  loadDebtors(true);
}

function refreshCurrentView() {
  if (currentDetailId != null) showDetail(currentDetailId);
  else loadDebtors();
}

/* -------------------- CSV export -------------------- */

/** Wrap a value for CSV: escape quotes, quote if it contains , " or newline. */
function csvCell(val) {
  const s = String(val == null ? "" : val);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCSV(headers, rows) {
  const lines = [headers.map(csvCell).join(",")];
  rows.forEach((r) => lines.push(r.map(csvCell).join(",")));
  // BOM so Excel reads UTF-8 (₱) correctly.
  return "﻿" + lines.join("\r\n");
}

function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// YYYYMMDD stamp for export filenames.
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

async function exportDebtorsCSV() {
  const [debtors, payments] = await Promise.all([
    DebtorsDB.getAll(),
    PaymentsDB.getAll(),
  ]);
  if (!debtors.length) return toast("No debtors to export.");

  const rows = debtors.map((d) => {
    const dp = payments.filter((p) => p.debtorId === d.id);
    const { paid, remaining } = totals(d, dp);
    return [d.id, d.name, d.totalDebt, paid, remaining, d.paymentRule || ""];
  });

  const csv = toCSV(
    ["id", "name", "totalDebt", "totalPaid", "remaining", "paymentRule"],
    rows
  );
  downloadCSV(`debtors-${stamp()}.csv`, csv);
  toast("Debtors exported.");
}

async function exportPaymentsCSV() {
  const [debtors, payments] = await Promise.all([
    DebtorsDB.getAll(),
    PaymentsDB.getAll(),
  ]);
  if (!payments.length) return toast("No payments to export.");

  const nameById = {};
  debtors.forEach((d) => (nameById[d.id] = d.name));

  const sorted = [...payments].sort((a, b) => new Date(a.date) - new Date(b.date));
  const rows = sorted.map((p) => [
    p.id,
    p.debtorId,
    nameById[p.debtorId] || "(deleted)",
    p.amount,
    p.date,
    fmtDate(p.date),
  ]);

  const csv = toCSV(
    ["paymentId", "debtorId", "debtorName", "amount", "dateISO", "date"],
    rows
  );
  downloadCSV(`payments-${stamp()}.csv`, csv);
  toast("Payments exported.");
}

/* -------------------- Event wiring -------------------- */

// Add-debtor button
$("addDebtorBtn").addEventListener("click", addDebtor);

// Search + filter
$("search").addEventListener("input", (e) => {
  searchTerm = e.target.value;
  loadDebtors();
});
$("filter").addEventListener("change", (e) => {
  statusFilter = e.target.value;
  loadDebtors();
});

// CSV export
$("exportDebtorsBtn").addEventListener("click", exportDebtorsCSV);
$("exportPaymentsBtn").addEventListener("click", exportPaymentsCSV);

// Back button
$("backBtn").addEventListener("click", showList);

// Modal buttons
$("modalCancel").addEventListener("click", closeModal);
$("modalSave").addEventListener("click", () => {
  if (modalSaveHandler) modalSaveHandler();
});
$("modalOverlay").addEventListener("click", (e) => {
  if (e.target.id === "modalOverlay") closeModal();
});

// Delegated clicks for all data-act buttons (list + detail)
document.body.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;

  switch (act) {
    case "pay": {
      // Find the nearest payment input relative to this button.
      const input =
        btn.parentElement.querySelector(".pay-input") ||
        document.querySelector(`.pay-input[data-id="${id}"]`) ||
        $("detailPayInput");
      const amount = input ? input.value : 0;
      addPayment(id, amount).then(() => {
        if (input) input.value = "";
      });
      break;
    }
    case "view":
      showDetail(id);
      break;
    case "edit":
      editDebtor(id);
      break;
    case "del":
      deleteDebtor(id);
      break;
    case "editpay":
      editPayment(id);
      break;
    case "delpay":
      deletePayment(id);
      break;
  }
});

// Enter key inside a payment input triggers its Add Payment button.
document.body.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList.contains("pay-input")) {
    const card = e.target.closest(".card");
    const payBtn = card && card.querySelector('[data-act="pay"]');
    if (payBtn) payBtn.click();
  }
});

/* -------------------- Offline indicator -------------------- */

function updateOnlineStatus() {
  $("offlineBadge").classList.toggle("hidden", navigator.onLine);
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);

/* -------------------- Service worker -------------------- */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch((err) => console.warn("SW registration failed:", err));
  });
}

/* -------------------- Maker's mark -------------------- */

const APP_VERSION = "1.0";

// Console signature — a little relic for anyone who opens DevTools.
console.log(
  "%c💰 Debt Tracker %cv" + APP_VERSION,
  "font-size:16px;font-weight:700;color:#0f766e;",
  "font-size:16px;color:#94a3b8;"
);
console.log(
  "%cCrafted by Jongparkour",
  "font-size:12px;color:#94a3b8;font-style:italic;"
);

/* -------------------- Boot -------------------- */

updateOnlineStatus();
loadDebtors(true);
