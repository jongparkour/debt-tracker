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
    return localStorage.getItem("dt_theme") || "light";
  } catch (e) {
    return "light";
  }
}
function applyTheme(t) {
  const theme = t === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("dt_theme", theme);
  } catch (e) {}
  // Keep the mobile status-bar matched to the page background in both themes.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#eef2f7" : "#080d1a");
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
    // Earliest due date across this person's loans; notes joined.
    const dues = p.loans.map((l) => l.dueDate).filter(Boolean).sort();
    p.dueDate = dues[0] || "";
    p.note = p.loans.map((l) => l.note).filter(Boolean).join(" · ");
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

/** Open the Add-debtor modal: Name, Amount, Due date, Note, + optional rule/target. */
function openAddDebtor() {
  openModal(
    "Add debtor",
    `
    <p class="muted modal-intro">Record who owes you and how much.</p>
    <div class="field"><label>Name</label>
      <input id="a_name" placeholder="e.g. Juan Dela Cruz" /></div>
    <div class="field"><label>Amount owed (₱)</label>
      <input id="a_debt" type="number" inputmode="decimal" min="0" placeholder="0.00" /></div>
    <div class="field-row">
      <div class="field"><label>Due date</label>
        <input id="a_due" type="date" /></div>
      <div class="field"><label>Note</label>
        <input id="a_note" placeholder="optional" /></div>
    </div>
    <details class="more-fields">
      <summary>More options</summary>
      <div class="field"><label>Payment rule</label>
        <input id="a_rule" placeholder="e.g. ₱300 / day" /></div>
      <div class="field"><label>Expected monthly payment (₱)</label>
        <input id="a_target" type="number" inputmode="decimal" min="0" placeholder="e.g. 2000" /></div>
    </details>
  `,
    async () => {
      const name = $("a_name").value.trim();
      const totalDebt = Number($("a_debt").value);
      if (!name) return toast("Please enter a name.");
      if (!(totalDebt > 0)) return toast("Enter a valid amount owed.");

      const dueVal = $("a_due").value;
      const dueDate = dueVal ? new Date(dueVal + "T00:00:00").toISOString() : "";
      const note = $("a_note").value.trim();
      const paymentRule = $("a_rule") ? $("a_rule").value.trim() : "";
      const monthlyTarget = $("a_target") ? Number($("a_target").value) || 0 : 0;

      await DebtorsDB.add({ name, totalDebt, paymentRule, monthlyTarget, dueDate, note });
      closeModal();
      toast("Debtor added.");
      loadDebtors(true);
    }
  );
  $("modalSave").textContent = "+ Add debtor";
  setTimeout(() => $("a_name") && $("a_name").focus(), 60);
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

async function addPayment(debtorId, amount, dateISO) {
  const amt = Number(amount);
  if (!(amt > 0)) return toast("Enter a valid payment amount.");

  await PaymentsDB.add({
    debtorId: Number(debtorId),
    amount: amt,
    date: dateISO || new Date().toISOString(),
  });
  toast("Payment recorded.");
  refreshCurrentView();
}

/** Popup to record a payment with a chosen amount + date. */
function openPaymentModal(payToId, name) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  openModal(
    "Record Payment",
    `
    <p class="muted" style="margin:0 0 14px;color:var(--brand);font-weight:600;">${esc(
      name || ""
    )}</p>
    <div class="field"><label>Payment Amount (₱)</label>
      <input id="pm_amount" type="number" inputmode="decimal" min="0" placeholder="0.00" /></div>
    <div class="field"><label>Payment Date</label>
      <input id="pm_date" type="date" value="${yyyy}-${mm}-${dd}" /></div>
    `,
    async () => {
      const amt = Number($("pm_amount").value);
      if (!(amt > 0)) return ($("pm_amount").focus());
      const dv = $("pm_date").value;
      const iso = dv ? new Date(dv + "T00:00:00").toISOString() : new Date().toISOString();
      closeModal();
      await addPayment(payToId, amt, iso);
    }
  );
  $("modalSave").textContent = "Submit Payment";
  setTimeout(() => $("pm_amount") && $("pm_amount").focus(), 60);
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

  // ----- Dashboard: hero (outstanding + % collected) + secondary stats -----
  let outstanding = 0,
    totalAll = 0,
    collected = 0,
    paidFull = 0;
  persons.forEach((p) => {
    totalAll += p.totalDebt;
    collected += p.paid;
    if (p.remaining > 0) outstanding += p.remaining;
    else paidFull++;
  });
  const collectedPct = totalAll > 0 ? Math.round((collected / totalAll) * 100) : 0;
  if ($("statOutstanding")) $("statOutstanding").textContent = peso(outstanding);
  if ($("heroBar")) $("heroBar").style.width = collectedPct + "%";
  if ($("statCollectedPct")) $("statCollectedPct").textContent = collectedPct + "%";
  if ($("statCollected")) $("statCollected").textContent = peso(collected);
  if ($("statDebtors")) $("statDebtors").textContent = persons.length;
  if ($("statPaidFull")) $("statPaidFull").textContent = paidFull;

  // Hide search/filter/export chrome entirely when there are no debtors at all.
  if ($("listControls"))
    $("listControls").classList.toggle("hidden", persons.length === 0);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  visible.forEach((p, i) => {
    const settled = p.remaining <= 0;
    const rules = p.loans.map((l) => l.paymentRule).filter(Boolean);
    const ruleText = rules.length ? rules.join(" · ") : "";
    const overdue = !settled && p.dueDate && new Date(p.dueDate) < todayStart;
    const progress = Math.round(pct(p.paid, p.totalDebt));
    const loanCount =
      p.loans.length > 1 ? ` <span class="muted">· ${p.loans.length} debts</span>` : "";

    // Meta chips (due date / rule) — only meaningful while a balance remains.
    const meta = [];
    if (!settled && p.dueDate)
      meta.push(
        `<span class="dcard-due${overdue ? " overdue" : ""}">📅 ${
          overdue ? "Overdue · " : "Due "
        }${fmtDate(p.dueDate)}</span>`
      );
    if (!settled && ruleText) meta.push(`<span class="dcard-rule">${esc(ruleText)}</span>`);

    const card = document.createElement("div");
    card.className = "dcard" + (settled ? " is-paid" : "");
    card.dataset.act = "view";
    card.dataset.id = p.payToId;
    if (animateCards) {
      card.classList.add("enter");
      card.style.animationDelay = Math.min(i, 8) * 45 + "ms";
    }
    card.innerHTML = `
      <div class="dcard-top">
        <h3 class="dcard-name">${esc(p.name)}${loanCount}</h3>
        ${settled ? `<span class="badge-paid">Paid in full</span>` : ""}
      </div>
      ${
        settled
          ? ""
          : `<p class="dcard-amount">${peso(
              p.remaining
            )}<span class="dcard-amount-label">remaining</span></p>`
      }
      ${
        !settled && p.paid > 0
          ? `<div class="dcard-bar"><span style="width:${progress}%"></span></div>
             <p class="dcard-sub">${peso(p.paid)} paid of ${peso(p.totalDebt)}</p>`
          : ""
      }
      ${meta.length ? `<div class="dcard-meta">${meta.join("")}</div>` : ""}
      ${p.note ? `<p class="dcard-note">“${esc(p.note)}”</p>` : ""}
      <div class="dcard-actions">
        ${
          settled
            ? ""
            : `<button class="btn small primary" data-act="paymodal" data-id="${p.payToId}" data-name="${esc(
                p.name
              )}">+ Pay</button>`
        }
        <button class="btn small ghost" data-act="delperson" data-id="${p.payToId}">Delete</button>
      </div>
    `;
    list.appendChild(card);
  });

  const shown = visible.length;
  const filtered = shown !== persons.length;
  $("summary").textContent = persons.length
    ? `${filtered ? shown + " of " + persons.length : persons.length} ${
        persons.length > 1 ? "people" : "person"
      } · ${peso(outstanding)} outstanding`
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

  const detailMeta = [];
  if (person.dueDate) detailMeta.push(`📅 Due <b>${fmtDate(person.dueDate)}</b>`);
  if (person.note) detailMeta.push(`📝 ${esc(person.note)}`);
  const metaLine = detailMeta.length
    ? `<p class="rule">${detailMeta.join(" &nbsp;·&nbsp; ")}</p>`
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
      ${metaLine}
      ${targetLine}
      <div class="progress"><span style="width:${pct(
        person.paid,
        person.totalDebt
      )}%"></span></div>

      <div class="add-pay">
        <button class="btn primary" data-act="paymodal" data-id="${person.payToId}"
                data-name="${esc(person.name)}" style="width:100%;">+ Record Payment</button>
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
  // Lock the background so it can't scroll while the panel is open.
  document.body.classList.add("modal-open");
}

function closeModal() {
  $("modalOverlay").classList.add("hidden");
  document.body.classList.remove("modal-open");
  $("modalBody").innerHTML = "";
  // Restore the footer Save button to its default (dialogs above may hide/rename it).
  $("modalSave").style.display = "";
  $("modalSave").textContent = "Save";
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
    <div class="field-row">
      <div class="field"><label>Due date</label>
        <input id="m_due" type="date" value="${d.dueDate ? isoDay(d.dueDate) : ""}" /></div>
      <div class="field"><label>Note</label>
        <input id="m_note" value="${esc(d.note || "")}" placeholder="optional" /></div>
    </div>
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
      const dueVal = $("m_due").value;
      const dueDate = dueVal ? new Date(dueVal + "T00:00:00").toISOString() : "";
      const note = $("m_note").value.trim();
      if (!name) return toast("Name is required.");
      if (!(totalDebt > 0)) return toast("Enter a valid total debt.");

      await DebtorsDB.put({ ...d, name, totalDebt, paymentRule, monthlyTarget, dueDate, note });
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
    <div class="field-row">
      <div class="field"><label>Due date</label>
        <input id="m_due" type="date" /></div>
      <div class="field"><label>Note</label>
        <input id="m_note" placeholder="optional" /></div>
    </div>
    <div class="field"><label>Payment Rule</label>
      <input id="m_rule" placeholder="e.g. ₱300 / day" /></div>
    <div class="field"><label>Expected Monthly Payment (₱)</label>
      <input id="m_target" type="number" min="0" placeholder="e.g. 2000" /></div>
  `,
    async () => {
      const totalDebt = Number($("m_debt").value);
      const paymentRule = $("m_rule").value.trim();
      const monthlyTarget = Number($("m_target").value) || 0;
      const dueVal = $("m_due").value;
      const dueDate = dueVal ? new Date(dueVal + "T00:00:00").toISOString() : "";
      const note = $("m_note").value.trim();
      if (!(totalDebt > 0)) return toast("Enter a valid total debt.");

      await DebtorsDB.add({ name, totalDebt, paymentRule, monthlyTarget, dueDate, note });
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

// One combined sheet: debtor info repeats on each of its payment rows, so a
// debtor and its payments stay linked in a single spreadsheet.
const DATA_HEADERS = [
  "Debtor Name",
  "Total Debt",
  "Monthly Target",
  "Payment Rule",
  "Payment Date",
  "Payment Amount",
  "Due Date",
  "Note",
];

/** ISO timestamp -> "YYYY-MM-DD" using local date parts. */
function isoDay(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

async function exportDataCSV() {
  const [debtors, payments] = await Promise.all([
    DebtorsDB.getAll(),
    PaymentsDB.getAll(),
  ]);
  if (!debtors.length) return toast("No data to export.");

  // Group by name (same way the app displays people) so it round-trips.
  const persons = buildPersons(debtors, payments);
  const rows = [];
  persons.forEach((p) => {
    const rule = (p.loans.map((l) => l.paymentRule).find((r) => r && r.trim()) || "").trim();
    const due = p.dueDate ? isoDay(p.dueDate) : "";
    const note = p.note || "";
    const pays = [...p.payments].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (pays.length) {
      pays.forEach((pay) =>
        rows.push([p.name, p.totalDebt, p.monthlyTarget, rule, isoDay(pay.date), pay.amount, due, note])
      );
    } else {
      rows.push([p.name, p.totalDebt, p.monthlyTarget, rule, "", "", due, note]);
    }
  });

  downloadCSV(`debt-tracker-${stamp()}.csv`, toCSV(DATA_HEADERS, rows));
  toast("Data exported.");
}

/* -------------------- CSV import -------------------- */

/** Normalize a header label for matching: trim, lowercase, collapse spaces. */
function normLabel(s) {
  return String(s || "").replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Parse a number from a cell, ignoring ₱, commas and spaces. */
function parseNum(v) {
  const n = Number(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

/** Parse a date cell to an ISO string, or null if unreadable. */
function parseDateISO(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  let d = new Date(s);
  if (!isNaN(d)) return d.toISOString();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = "20" + y;
    d = new Date(`${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`);
    if (!isNaN(d)) return d.toISOString();
  }
  return null;
}

/** Minimal RFC-4180 CSV parser (handles quotes, commas and newlines in cells). */
function parseCSV(text) {
  const rows = [];
  let row = [],
    field = "",
    i = 0,
    q = false;
  const s = String(text).replace(/^﻿/, "");
  while (i < s.length) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        q = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      q = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    field += c;
    i++;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

/** Promise-based choice dialog (reuses the shared modal). Resolves the chosen
 *  value, or null if cancelled. */
function askChoice(title, bodyHtml, buttons) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      $("modalCancel").removeEventListener("click", onCancel);
      $("modalOverlay").removeEventListener("click", onOverlay);
      closeModal();
      resolve(val);
    };
    const onCancel = () => finish(null);
    const onOverlay = (e) => {
      if (e.target.id === "modalOverlay") finish(null);
    };
    const btns = buttons
      .map(
        (b) =>
          `<button class="btn ${b.cls || ""}" data-choice="${esc(b.value)}">${esc(
            b.label
          )}</button>`
      )
      .join("");
    openModal(title, `${bodyHtml}<div class="choice-actions">${btns}</div>`, null);
    $("modalSave").style.display = "none";
    $("modalBody")
      .querySelectorAll("[data-choice]")
      .forEach((el) => el.addEventListener("click", () => finish(el.dataset.choice)));
    $("modalCancel").addEventListener("click", onCancel);
    $("modalOverlay").addEventListener("click", onOverlay);
  });
}

/** Explain the required format when a file can't be read. */
function showImportHelp(missing) {
  const need = DATA_HEADERS.map((h) => `<li>${esc(h)}</li>`).join("");
  openModal(
    "Can't read this file",
    `
    <p class="muted">The file is missing required column${missing.length > 1 ? "s" : ""}:
      <b>${missing.map(esc).join(", ")}</b>.</p>
    <p class="muted" style="margin-top:10px;">The first row of your spreadsheet must include
      these exact column labels:</p>
    <ul class="dup-list">${need}</ul>
    <p class="muted" style="margin-top:10px;">Tip: tap <b>⬇ Export data</b> first to get a
      correctly-formatted file, edit that, then re-upload it.</p>
    `,
    () => closeModal()
  );
  $("modalSave").textContent = "Got it";
}

async function importDataCSV(file) {
  let text;
  try {
    text = await file.text();
  } catch (e) {
    return toast("Could not read that file.");
  }
  const raw = parseCSV(text).filter((r) => r.some((c) => String(c).trim() !== ""));
  if (raw.length < 2) return showImportHelp(DATA_HEADERS);

  const header = raw[0].map(normLabel);
  const col = {};
  header.forEach((h, i) => {
    if (!(h in col)) col[h] = i;
  });
  const required = ["debtor name", "total debt", "payment date", "payment amount"];
  const missing = required
    .filter((r) => !(r in col))
    .map((r) => DATA_HEADERS.find((h) => normLabel(h) === r) || r);
  if (missing.length) return showImportHelp(missing);

  const iName = col["debtor name"],
    iDebt = col["total debt"],
    iTarget = col["monthly target"],
    iRule = col["payment rule"],
    iPd = col["payment date"],
    iPa = col["payment amount"],
    iDue = col["due date"],
    iNote = col["note"];

  const persons = new Map();
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r];
    const name = String(row[iName] || "").trim();
    if (!name) continue;
    const key = normName(name);
    if (!persons.has(key)) {
      persons.set(key, {
        name,
        totalDebt: parseNum(row[iDebt]),
        monthlyTarget: iTarget != null ? parseNum(row[iTarget]) : 0,
        paymentRule: iRule != null ? String(row[iRule] || "").trim() : "",
        dueDate: iDue != null ? parseDateISO(row[iDue]) || "" : "",
        note: iNote != null ? String(row[iNote] || "").trim() : "",
        payments: [],
      });
    }
    const pd = iPd != null ? row[iPd] : "";
    const pa = iPa != null ? row[iPa] : "";
    if (String(pd || "").trim() !== "" && String(pa || "").trim() !== "") {
      const amt = parseNum(pa);
      const iso = parseDateISO(pd);
      if (amt > 0 && iso) persons.get(key).payments.push({ amount: amt, date: iso });
    }
  }

  const imported = Array.from(persons.values());
  if (!imported.length) return toast("No debtor rows found in the file.");

  const existing = await DebtorsDB.getAll();
  const existingByName = new Map();
  existing.forEach((d) => {
    const k = normName(d.name);
    if (!existingByName.has(k)) existingByName.set(k, []);
    existingByName.get(k).push(d);
  });
  const dups = imported.filter((p) => existingByName.has(normName(p.name)));

  let mode = "add";
  if (dups.length) {
    const names = dups.map((p) => p.name);
    const shown = names.slice(0, 8).map((n) => `<li>${esc(n)}</li>`).join("");
    const more = names.length > 8 ? `<li>…and ${names.length - 8} more</li>` : "";
    const choice = await askChoice(
      "Duplicate debtors found",
      `
      <p class="muted">${names.length} name${names.length !== 1 ? "s" : ""} in this file already
        exist in the app:</p>
      <ul class="dup-list">${shown}${more}</ul>
      <p class="muted" style="margin-top:10px;">Keep both copies, or replace the existing ones with
        the imported data?</p>
      `,
      [
        { value: "keepboth", label: "Keep both" },
        { value: "replace", label: "Replace existing", cls: "danger" },
      ]
    );
    if (choice === null) return toast("Import cancelled.");
    mode = choice;
  }

  let dCount = 0,
    pCount = 0;
  for (const p of imported) {
    const key = normName(p.name);
    if (mode === "replace" && existingByName.has(key)) {
      for (const ex of existingByName.get(key)) {
        await PaymentsDB.deleteByDebtor(ex.id);
        await DebtorsDB.delete(ex.id);
      }
    }
    const newId = await DebtorsDB.add({
      name: p.name,
      totalDebt: p.totalDebt,
      paymentRule: p.paymentRule,
      monthlyTarget: p.monthlyTarget,
      dueDate: p.dueDate || "",
      note: p.note || "",
    });
    dCount++;
    for (const pay of p.payments) {
      await PaymentsDB.add({ debtorId: Number(newId), amount: pay.amount, date: pay.date });
      pCount++;
    }
  }

  await loadDebtors();
  toast(
    `Imported ${dCount} debtor${dCount !== 1 ? "s" : ""}, ${pCount} payment${
      pCount !== 1 ? "s" : ""
    }.`
  );
}

/* -------------------- Event wiring -------------------- */

// Add-debtor buttons (header + empty state) open the modal
$("addDebtorBtn").addEventListener("click", openAddDebtor);
$("emptyAddBtn").addEventListener("click", openAddDebtor);

// Search + filter
$("search").addEventListener("input", (e) => {
  searchTerm = e.target.value;
  loadDebtors();
});
$("filter").addEventListener("change", (e) => {
  statusFilter = e.target.value;
  loadDebtors();
});

// CSV export / import
$("exportBtn").addEventListener("click", exportDataCSV);
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) importDataCSV(f);
  e.target.value = ""; // allow re-selecting the same file
});

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
    case "paymodal":
      openPaymentModal(id, btn.dataset.name || "");
      break;
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

const APP_VERSION = "3.0.2";
window.APP_VERSION = APP_VERSION;

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
