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

/* -------------------- Theme -------------------- */

function getTheme() {
  try {
    return localStorage.getItem("dt_theme") || "dark";
  } catch (e) {
    return "dark";
  }
}
function applyTheme(t) {
  const theme = t === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("dt_theme", theme);
  } catch (e) {}
  // Keep the mobile status-bar matched to the teal app bar in both themes.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#0f766e" : "#14a89b");
}
function toggleTheme() {
  const next = getTheme() === "light" ? "dark" : "light";
  applyTheme(next);
  return next;
}

/* -------------------- Name / month helpers -------------------- */

/** Normalize a name for grouping (case-insensitive, trimmed, collapsed spaces). */
function normName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Current month key, e.g. "2026-07". */
function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Group debtor records that share a name into "persons".
 * Each person aggregates debt, target and payments across all their entries.
 */
function buildPersons(debtors, allPayments) {
  const map = new Map();
  debtors.forEach((d) => {
    const key = normName(d.name);
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: d.name.trim(),
        loans: [],
        loanIds: [],
        totalDebt: 0,
        monthlyTarget: 0,
      });
    }
    const p = map.get(key);
    p.loans.push(d);
    p.loanIds.push(d.id);
    p.totalDebt += Number(d.totalDebt || 0);
    p.monthlyTarget += Number(d.monthlyTarget || 0);
  });
  const persons = Array.from(map.values());
  persons.forEach((p) => {
    p.payments = allPayments.filter((pay) => p.loanIds.includes(pay.debtorId));
    p.paid = p.payments.reduce((s, x) => s + Number(x.amount || 0), 0);
    p.remaining = p.totalDebt - p.paid;
    // Payment attaches to the first loan record for this person.
    p.payToId = p.loans[0].id;
  });
  // Sort: unsettled first, then by name.
  persons.sort((a, b) => {
    const au = a.remaining > 0 ? 0 : 1;
    const bu = b.remaining > 0 ? 0 : 1;
    if (au !== bu) return au - bu;
    return a.name.localeCompare(b.name);
  });
  return persons;
}

/* -------------------- Debtor CRUD -------------------- */

async function addDebtor() {
  const name = $("name").value.trim();
  const totalDebt = Number($("debt").value);
  const paymentRule = $("rule").value.trim();
  const monthlyTarget = Number($("target").value) || 0;

  if (!name) return toast("Please enter a name.");
  if (!(totalDebt > 0)) return toast("Enter a valid total debt.");

  await DebtorsDB.add({ name, totalDebt, paymentRule, monthlyTarget });

  $("name").value = "";
  $("debt").value = "";
  $("rule").value = "";
  $("target").value = "";
  toast("Saved. Same names are grouped together.");
  loadDebtors(true);
}

/** Delete a single debt entry (loan) and its payments. */
async function deleteLoan(id) {
  const d = await DebtorsDB.get(id);
  if (!d) return;
  if (!confirm(`Delete this ${peso(d.totalDebt)} debt entry and its payments?`))
    return;

  await PaymentsDB.deleteByDebtor(id);
  await DebtorsDB.delete(id);
  toast("Debt entry deleted.");
  refreshCurrentView();
}

/** Delete an entire person (all their debt entries + payments). */
async function deletePerson(repId) {
  const rep = await DebtorsDB.get(repId);
  if (!rep) return;
  const all = await DebtorsDB.getAll();
  const key = normName(rep.name);
  const loans = all.filter((d) => normName(d.name) === key);

  if (
    !confirm(
      `Delete "${rep.name.trim()}" — all ${loans.length} debt entr${
        loans.length > 1 ? "ies" : "y"
      } and every payment? This cannot be undone.`
    )
  )
    return;

  for (const loan of loans) {
    await PaymentsDB.deleteByDebtor(loan.id);
    await DebtorsDB.delete(loan.id);
  }
  toast("Person deleted.");
  if (currentDetailKey === key) showList();
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

  const persons = buildPersons(debtors, allPayments);
  const monthKey = currentMonthKey();

  const list = $("list");
  list.innerHTML = "";

  $("empty").classList.toggle("hidden", persons.length > 0);

  // Apply search + status filter (on the grouped person).
  const term = searchTerm.trim().toLowerCase();
  const visible = persons.filter((p) => {
    if (term && !p.name.toLowerCase().includes(term)) return false;
    if (statusFilter === "active" && p.remaining <= 0) return false;
    if (statusFilter === "paid" && p.remaining > 0) return false;
    return true;
  });

  $("noMatch").classList.toggle(
    "hidden",
    !(persons.length > 0 && visible.length === 0)
  );

  let grandRemaining = 0;

  visible.forEach((p, i) => {
    grandRemaining += p.remaining;

    // Rule text: show each loan's rule if any exist.
    const rules = p.loans.map((l) => l.paymentRule).filter(Boolean);
    const ruleText = rules.length ? rules.join(" · ") : "";

    // This-month expected vs paid.
    const monthPaid = p.payments
      .filter((x) => monthOf(x.date).key === monthKey)
      .reduce((s, x) => s + Number(x.amount || 0), 0);
    let monthHtml = "";
    if (p.monthlyTarget > 0) {
      const met = monthPaid >= p.monthlyTarget;
      monthHtml = `
        <div class="this-month">
          <span class="mt-label">This month</span>
          <span>${peso(monthPaid)} / ${peso(p.monthlyTarget)}
            <span class="month-status ${met ? "met" : "short"}">${
        met ? "met" : peso(p.monthlyTarget - monthPaid) + " to go"
      }</span>
          </span>
        </div>`;
    }

    const loanCount =
      p.loans.length > 1 ? ` <span class="muted">(${p.loans.length} debts)</span>` : "";

    const card = document.createElement("div");
    card.className = "card";
    if (animateCards) {
      card.classList.add("enter");
      card.style.animationDelay = Math.min(i, 8) * 45 + "ms";
    }
    card.innerHTML = `
      <div class="card-head">
        <h3>${esc(p.name)}${loanCount}</h3>
        <span class="pill ${p.remaining <= 0 ? "paid" : ""}">
          ${p.remaining <= 0 ? "Settled" : peso(p.remaining) + " left"}
        </span>
      </div>
      <div class="stats">
        <div><span class="muted">Total</span><b>${peso(p.totalDebt)}</b></div>
        <div><span class="muted">Paid</span><b>${peso(p.paid)}</b></div>
      </div>
      ${monthHtml}
      ${ruleText ? `<p class="rule">📋 ${esc(ruleText)}</p>` : ""}
      <div class="progress"><span style="width:${pct(p.paid, p.totalDebt)}%"></span></div>
      <div class="card-actions">
        <input type="number" inputmode="decimal" min="0" placeholder="Amount"
               class="pay-input" data-id="${p.payToId}" />
        <button class="btn small primary" data-act="pay" data-id="${p.payToId}">Add Payment</button>
        <button class="btn small" data-act="view" data-id="${p.payToId}">View</button>
        <button class="btn small danger" data-act="delperson" data-id="${p.payToId}">Delete</button>
      </div>
    `;
    list.appendChild(card);
  });

  const shown = visible.length;
  const filtered = shown !== persons.length;
  $("summary").textContent = persons.length
    ? `${filtered ? shown + " of " + persons.length : persons.length} ${
        persons.length > 1 ? "people" : "person"
      } · ${peso(grandRemaining)} outstanding`
    : "";
}

function pct(paid, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (paid / total) * 100));
}

/* -------------------- Detail View (per person) -------------------- */

let currentDetailKey = null;

/** `repId` is any loan id belonging to the person; we resolve the whole person. */
async function showDetail(repId) {
  const rep = await DebtorsDB.get(repId);
  if (!rep) return showList();

  const [debtors, allPayments] = await Promise.all([
    DebtorsDB.getAll(),
    PaymentsDB.getAll(),
  ]);
  const key = normName(rep.name);
  currentDetailKey = key;

  const person = buildPersons(debtors, allPayments).find((p) => p.key === key);
  if (!person) return showList();

  const payments = [...person.payments].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  // ----- Loans (debt entries) -----
  const loansHtml = person.loans
    .map((l) => {
      const bits = [];
      if (l.paymentRule) bits.push(esc(l.paymentRule));
      if (Number(l.monthlyTarget) > 0)
        bits.push("target " + peso(l.monthlyTarget) + "/mo");
      return `
        <div class="loan">
          <div class="loan-info">
            <b>${peso(l.totalDebt)}</b>
            ${bits.length ? `<small>${bits.join(" · ")}</small>` : ""}
          </div>
          <div class="loan-actions">
            <button class="btn tiny" data-act="editloan" data-id="${l.id}">Edit</button>
            <button class="btn tiny danger" data-act="delloan" data-id="${l.id}">Delete</button>
          </div>
        </div>`;
    })
    .join("");

  // ----- Payments grouped by month, with expected-vs-paid -----
  const groups = {};
  payments.forEach((p) => {
    const { key: mk, label } = monthOf(p.date);
    if (!groups[mk]) groups[mk] = { label, total: 0, items: [] };
    groups[mk].total += Number(p.amount || 0);
    groups[mk].items.push(p);
  });
  const monthKeys = Object.keys(groups).sort().reverse();
  const target = Number(person.monthlyTarget) || 0;

  let monthsHtml;
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
            <div><b>${peso(p.amount)}</b><span class="muted"> · ${fmtDate(
              p.date
            )}</span></div>
            <div class="pay-row-actions">
              <button class="btn tiny" data-act="editpay" data-id="${p.id}">Edit</button>
              <button class="btn tiny danger" data-act="delpay" data-id="${p.id}">Delete</button>
            </div>
          </li>`
          )
          .join("");

        // Expected-vs-paid indicator for this month.
        let statusHtml = "";
        let expectedHtml = "";
        let barHtml = "";
        if (target > 0) {
          const met = g.total >= target;
          const diff = g.total - target;
          statusHtml = `<span class="month-status ${met ? "met" : "short"}">${
            met
              ? diff > 0
                ? peso(diff) + " over"
                : "met"
              : peso(target - g.total) + " short"
          }</span>`;
          expectedHtml = `<div class="month-expected">Expected ${peso(
            target
          )} · ${met ? "target reached ✓" : "under target (okay)"}</div>`;
          const w = Math.max(0, Math.min(100, (g.total / target) * 100));
          barHtml = `<div class="month-bar"><span class="${
            met ? "over" : ""
          }" style="width:${w}%"></span></div>`;
        }

        return `
          <div class="month">
            <div class="month-head">
              <span>${esc(g.label)}</span>
              <span>${statusHtml} <b>${peso(g.total)}</b></span>
            </div>
            ${expectedHtml}
            ${barHtml}
            <ul class="pay-list">${rows}</ul>
          </div>`;
      })
      .join("");
  }

  const targetLine =
    target > 0
      ? `<p class="rule">🎯 Expected monthly payment: <b>${peso(target)}</b></p>`
      : "";

  $("detailContent").innerHTML = `
    <div class="card detail-card">
      <div class="card-head">
        <h2>${esc(person.name)}</h2>
        <span class="pill ${person.remaining <= 0 ? "paid" : ""}">
          ${person.remaining <= 0 ? "Settled" : peso(person.remaining) + " left"}
        </span>
      </div>
      <div class="stats big">
        <div><span class="muted">Total</span><b>${peso(person.totalDebt)}</b></div>
        <div><span class="muted">Paid</span><b>${peso(person.paid)}</b></div>
      </div>
      ${targetLine}
      <div class="progress"><span style="width:${pct(
        person.paid,
        person.totalDebt
      )}%"></span></div>

      <div class="add-pay">
        <input type="number" inputmode="decimal" min="0" placeholder="Payment amount"
               class="pay-input" id="detailPayInput" data-id="${person.payToId}" />
        <button class="btn primary" data-act="pay" data-id="${person.payToId}">Add Payment</button>
      </div>
    </div>

    <div class="loans">
      <div class="loans-head">
        <h3>Debt entries</h3>
        <button class="btn small" data-act="addloan" data-name="${esc(
          person.name
        )}">+ Add debt</button>
      </div>
      ${loansHtml}
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
    "Edit Debt Entry",
    `
    <div class="field"><label>Name</label>
      <input id="m_name" value="${esc(d.name)}" /></div>
    <div class="field"><label>Total Debt (₱)</label>
      <input id="m_debt" type="number" min="0" value="${esc(d.totalDebt)}" /></div>
    <div class="field"><label>Payment Rule</label>
      <input id="m_rule" value="${esc(d.paymentRule || "")}" /></div>
    <div class="field"><label>Expected Monthly Payment (₱)</label>
      <input id="m_target" type="number" min="0" value="${esc(
        d.monthlyTarget || ""
      )}" /></div>
    <p class="rec-small muted">Tip: same name = grouped with this person.</p>
  `,
    async () => {
      const name = $("m_name").value.trim();
      const totalDebt = Number($("m_debt").value);
      const paymentRule = $("m_rule").value.trim();
      const monthlyTarget = Number($("m_target").value) || 0;
      if (!name) return toast("Name is required.");
      if (!(totalDebt > 0)) return toast("Enter a valid total debt.");

      await DebtorsDB.put({ ...d, name, totalDebt, paymentRule, monthlyTarget });
      closeModal();
      toast("Updated.");
      currentDetailKey = normName(name); // follow a possible rename
      refreshCurrentView();
    }
  );
}

/** Add another debt entry under an existing person (same name). */
function addLoan(name) {
  openModal(
    "Add debt for " + name,
    `
    <div class="field"><label>Total Debt (₱)</label>
      <input id="m_debt" type="number" min="0" placeholder="0.00" /></div>
    <div class="field"><label>Payment Rule</label>
      <input id="m_rule" placeholder="e.g. ₱300 / day" /></div>
    <div class="field"><label>Expected Monthly Payment (₱)</label>
      <input id="m_target" type="number" min="0" placeholder="e.g. 2000" /></div>
  `,
    async () => {
      const totalDebt = Number($("m_debt").value);
      const paymentRule = $("m_rule").value.trim();
      const monthlyTarget = Number($("m_target").value) || 0;
      if (!(totalDebt > 0)) return toast("Enter a valid total debt.");

      await DebtorsDB.add({ name, totalDebt, paymentRule, monthlyTarget });
      closeModal();
      toast("Debt entry added.");
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
  currentDetailKey = null;
  showView("listView");
  loadDebtors(true);
}

async function refreshCurrentView() {
  if (currentDetailKey != null) {
    const all = await DebtorsDB.getAll();
    const rep = all.find((d) => normName(d.name) === currentDetailKey);
    if (rep) return showDetail(rep.id);
    return showList();
  }
  loadDebtors();
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
    return [
      d.id,
      d.name,
      d.totalDebt,
      paid,
      remaining,
      d.monthlyTarget || 0,
      d.paymentRule || "",
    ];
  });

  const csv = toCSV(
    [
      "id",
      "name",
      "totalDebt",
      "totalPaid",
      "remaining",
      "monthlyTarget",
      "paymentRule",
    ],
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
    case "delperson":
      deletePerson(id);
      break;
    case "editloan":
      editDebtor(id);
      break;
    case "delloan":
      deleteLoan(id);
      break;
    case "addloan":
      addLoan(btn.dataset.name || "");
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

const APP_VERSION = "1.1";

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

applyTheme(getTheme());
updateOnlineStatus();
loadDebtors(true);
