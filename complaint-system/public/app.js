/* ==========================================================================
   The Ledger — frontend application logic
   Vanilla JS, no build step. Talks to the REST API served by server.js.
   ========================================================================== */

const API_BASE = '/api/complaints';

const CATEGORIES = ['Electricity','Plumbing','Water Supply','Internet','Housekeeping','Maintenance','Security','Other'];
const PRIORITIES = ['Low','Medium','High','Urgent'];
const STATUSES = ['Open','In Progress','Resolved','Closed','Cancelled'];

const STATUS_COLOR_VAR = {
  'Open': '--status-open',
  'In Progress': '--status-inprogress',
  'Resolved': '--status-resolved',
  'Closed': '--status-closed',
  'Cancelled': '--status-cancelled',
};
const PRIORITY_COLOR_VAR = {
  'Low': '--priority-low',
  'Medium': '--priority-medium',
  'High': '--priority-high',
  'Urgent': '--priority-urgent',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  complaints: [],
  total: 0,
  filters: { category: 'All', status: 'All', priority: 'All', search: '' },
  sort: 'dateSubmitted_desc',
  editingId: null,     // id currently open in the form (null = creating new)
  detailId: null,      // id currently open in the detail view
  pendingDeleteId: null,
  isLoading: false,
};

let searchDebounceTimer = null;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const el = (id) => document.getElementById(id);

const sidebar = el('sidebar');
const searchInput = el('searchInput');
const categoryFiltersEl = el('categoryFilters');
const statusFiltersEl = el('statusFilters');
const priorityFiltersEl = el('priorityFilters');
const sortSelect = el('sortSelect');
const clearFiltersBtn = el('clearFiltersBtn');
const ledgerStats = el('ledgerStats');
const mobileFilterToggle = el('mobileFilterToggle');

const resultsEyebrow = el('resultsEyebrow');
const feedbackBanner = el('feedbackBanner');
const complaintListEl = el('complaintList');
const emptyStateEl = el('emptyState');
const loadingStateEl = el('loadingState');

const openNewComplaintBtn = el('openNewComplaintBtn');
const formOverlay = el('formOverlay');
const closeFormBtn = el('closeFormBtn');
const cancelFormBtn = el('cancelFormBtn');
const complaintForm = el('complaintForm');
const formTitle = el('formTitle');
const formSubtitle = el('formSubtitle');
const submitFormBtn = el('submitFormBtn');
const statusFieldWrap = el('statusFieldWrap');
const statusEditSelect = el('statusEdit');
const descriptionInput = el('description');
const descCount = el('descCount');

const detailOverlay = el('detailOverlay');
const closeDetailBtn = el('closeDetailBtn');
const editComplaintBtn = el('editComplaintBtn');
const deleteComplaintBtn = el('deleteComplaintBtn');
const statusChipRow = el('statusChipRow');

const confirmOverlay = el('confirmOverlay');
const confirmCancelBtn = el('confirmCancelBtn');
const confirmDeleteBtn = el('confirmDeleteBtn');

const toastStack = el('toastStack');

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastStack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3600);
}

function showBanner(message, type = 'success') {
  feedbackBanner.textContent = message;
  feedbackBanner.className = `feedback-banner ${type}`;
  feedbackBanner.hidden = false;
  setTimeout(() => { feedbackBanner.hidden = true; }, 5000);
}

function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach((n) => (n.textContent = ''));
}

function applyFieldErrors(fields) {
  clearFieldErrors();
  Object.entries(fields || {}).forEach(([key, msg]) => {
    const node = el(`err-${key}`);
    if (node) node.textContent = msg;
  });
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.fields = data && data.fields;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Populate static selects / pill filters
// ---------------------------------------------------------------------------
function populateSelect(selectEl, options, { includeBlank = false, blankLabel = 'Select…' } = {}) {
  selectEl.innerHTML = '';
  if (includeBlank) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = blankLabel;
    selectEl.appendChild(opt);
  }
  options.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    selectEl.appendChild(opt);
  });
}

function buildPillRow(container, options, filterKey) {
  container.innerHTML = '';
  const all = ['All', ...options];
  all.forEach((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill' + (state.filters[filterKey] === opt ? ' active' : '');
    btn.textContent = opt;
    btn.addEventListener('click', () => {
      state.filters[filterKey] = opt;
      buildPillRow(container, options, filterKey);
      fetchComplaints();
    });
    container.appendChild(btn);
  });
}

function initStaticControls() {
  populateSelect(el('category'), CATEGORIES, { includeBlank: true, blankLabel: 'Select a category…' });
  populateSelect(el('priority'), PRIORITIES, { includeBlank: true, blankLabel: 'Select priority…' });
  populateSelect(statusEditSelect, STATUSES);
  buildPillRow(categoryFiltersEl, CATEGORIES, 'category');
  buildPillRow(statusFiltersEl, STATUSES, 'status');
  buildPillRow(priorityFiltersEl, PRIORITIES, 'priority');
}

// ---------------------------------------------------------------------------
// Fetch + render complaint list
// ---------------------------------------------------------------------------
async function fetchComplaints() {
  state.isLoading = true;
  loadingStateEl.hidden = false;
  emptyStateEl.hidden = true;
  complaintListEl.innerHTML = '';

  const params = new URLSearchParams();
  if (state.filters.category !== 'All') params.set('category', state.filters.category);
  if (state.filters.status !== 'All') params.set('status', state.filters.status);
  if (state.filters.priority !== 'All') params.set('priority', state.filters.priority);
  if (state.filters.search) params.set('search', state.filters.search);
  params.set('sort', state.sort);

  try {
    const data = await apiFetch(`${API_BASE}?${params.toString()}`);
    state.complaints = data.complaints;
    state.total = data.total;
    renderList();
    updateStats();
  } catch (err) {
    showBanner(`Couldn't load the register: ${err.message}`, 'error');
  } finally {
    state.isLoading = false;
    loadingStateEl.hidden = true;
  }
}

function updateStats() {
  const openCount = state.complaints.filter((c) => c.status === 'Open').length;
  resultsEyebrow.textContent = `${state.complaints.length} of ${state.total} entries shown`;
  ledgerStats.innerHTML = `
    <div><strong>${state.total}</strong> total entries logged</div>
    <div><strong>${openCount}</strong> currently open (in this view)</div>
  `;
}

function renderList() {
  complaintListEl.innerHTML = '';
  if (state.complaints.length === 0) {
    emptyStateEl.hidden = false;
    return;
  }
  emptyStateEl.hidden = true;

  const total = state.total;
  state.complaints.forEach((c, i) => {
    const entryNo = String(total - state.complaints.indexOf(c)).padStart(3, '0');
    const card = document.createElement('article');
    card.className = 'complaint-card';
    card.style.setProperty('--priority-color', `var(${PRIORITY_COLOR_VAR[c.priority] || '--brass'})`);
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Open complaint from ${c.residentName}`);

    card.innerHTML = `
      <div class="card-entry-no">No. ${escapeHtml(entryNo)}</div>
      <div class="card-main">
        <div class="card-title-row">
          <span class="card-resident">${escapeHtml(c.residentName)}</span>
          <span class="card-room">${escapeHtml(c.roomNumber)}</span>
          <span class="card-category">${escapeHtml(c.category)}</span>
        </div>
        <div class="card-desc">${escapeHtml(c.description)}</div>
        <div class="card-meta-row">
          <span>Filed ${escapeHtml(formatDate(c.dateSubmitted))}</span>
        </div>
      </div>
      <div class="card-side">
        <span class="priority-tag" style="--priority-color: var(${PRIORITY_COLOR_VAR[c.priority] || '--brass'})">${escapeHtml(c.priority)}</span>
        <span class="stamp" style="--stamp-color: var(${STATUS_COLOR_VAR[c.status] || '--status-open'})">${escapeHtml(c.status)}</span>
      </div>
    `;
    card.addEventListener('click', () => openDetail(c.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(c.id); }
    });
    complaintListEl.appendChild(card);
  });
}

// ---------------------------------------------------------------------------
// Filters: search + sort + clear
// ---------------------------------------------------------------------------
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    state.filters.search = searchInput.value.trim();
    fetchComplaints();
  }, 300);
});

sortSelect.addEventListener('change', () => {
  state.sort = sortSelect.value;
  fetchComplaints();
});

clearFiltersBtn.addEventListener('click', () => {
  state.filters = { category: 'All', status: 'All', priority: 'All', search: '' };
  state.sort = 'dateSubmitted_desc';
  searchInput.value = '';
  sortSelect.value = state.sort;
  buildPillRow(categoryFiltersEl, CATEGORIES, 'category');
  buildPillRow(statusFiltersEl, STATUSES, 'status');
  buildPillRow(priorityFiltersEl, PRIORITIES, 'priority');
  fetchComplaints();
});

mobileFilterToggle.addEventListener('click', () => {
  sidebar.classList.toggle('open');
});

// ---------------------------------------------------------------------------
// New / edit complaint form
// ---------------------------------------------------------------------------
function openForm(mode, complaint = null) {
  complaintForm.reset();
  clearFieldErrors();
  state.editingId = mode === 'edit' ? complaint.id : null;

  if (mode === 'edit') {
    formTitle.textContent = 'Edit complaint';
    formSubtitle.textContent = 'Update the details below. Status can be changed here too.';
    submitFormBtn.textContent = 'Save changes';
    statusFieldWrap.hidden = false;

    el('complaintId').value = complaint.id;
    el('residentName').value = complaint.residentName;
    el('roomNumber').value = complaint.roomNumber;
    el('contact').value = complaint.contact;
    el('category').value = complaint.category;
    el('priority').value = complaint.priority;
    statusEditSelect.value = complaint.status;
    descriptionInput.value = complaint.description;
    el('additionalInfo').value = complaint.additionalInfo || '';
    descCount.textContent = `${complaint.description.length} / 2000`;
  } else {
    formTitle.textContent = 'Log a new complaint';
    formSubtitle.textContent = "Fill in the details below. Fields marked * are required.";
    submitFormBtn.textContent = 'Submit complaint';
    statusFieldWrap.hidden = true;
    el('complaintId').value = '';
    descCount.textContent = '0 / 2000';
  }

  formOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
  el('residentName').focus();
}

function closeForm() {
  formOverlay.hidden = true;
  document.body.style.overflow = '';
  state.editingId = null;
}

openNewComplaintBtn.addEventListener('click', () => openForm('create'));
closeFormBtn.addEventListener('click', closeForm);
cancelFormBtn.addEventListener('click', closeForm);
formOverlay.addEventListener('click', (e) => { if (e.target === formOverlay) closeForm(); });

descriptionInput.addEventListener('input', () => {
  descCount.textContent = `${descriptionInput.value.length} / 2000`;
});

function clientValidate() {
  const errors = {};
  const residentName = el('residentName').value.trim();
  const roomNumber = el('roomNumber').value.trim();
  const contact = el('contact').value.trim();
  const category = el('category').value;
  const priority = el('priority').value;
  const description = descriptionInput.value.trim();

  if (residentName.length < 2) errors.residentName = 'Resident name must be at least 2 characters';
  if (!roomNumber) errors.roomNumber = 'Room/flat number is required';
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRe = /^\+?[0-9\s-]{7,15}$/;
  if (!emailRe.test(contact) && !phoneRe.test(contact)) errors.contact = 'Enter a valid phone number or email';
  if (!CATEGORIES.includes(category)) errors.category = 'Select a category';
  if (!PRIORITIES.includes(priority)) errors.priority = 'Select a priority';
  if (description.length < 5) errors.description = 'Description must be at least 5 characters';

  return { valid: Object.keys(errors).length === 0, errors };
}

complaintForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { valid, errors } = clientValidate();
  if (!valid) { applyFieldErrors(errors); return; }
  clearFieldErrors();

  const payload = {
    residentName: el('residentName').value.trim(),
    roomNumber: el('roomNumber').value.trim(),
    contact: el('contact').value.trim(),
    category: el('category').value,
    priority: el('priority').value,
    description: descriptionInput.value.trim(),
    additionalInfo: el('additionalInfo').value.trim(),
  };

  submitFormBtn.disabled = true;
  const originalLabel = submitFormBtn.textContent;
  submitFormBtn.textContent = 'Saving…';

  try {
    if (state.editingId) {
      const data = await apiFetch(`${API_BASE}/${state.editingId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      // also push status if changed
      if (statusEditSelect.value && statusEditSelect.value !== data.complaint.status) {
        await apiFetch(`${API_BASE}/${state.editingId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: statusEditSelect.value }),
        });
      }
      showToast('Complaint updated successfully.', 'success');
    } else {
      await apiFetch(API_BASE, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      showToast('Complaint submitted successfully.', 'success');
    }
    closeForm();
    fetchComplaints();
  } catch (err) {
    if (err.fields) applyFieldErrors(err.fields);
    showBanner(err.message || 'Something went wrong. Please try again.', 'error');
  } finally {
    submitFormBtn.disabled = false;
    submitFormBtn.textContent = originalLabel;
  }
});

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------
async function openDetail(id) {
  try {
    const data = await apiFetch(`${API_BASE}/${id}`);
    const c = data.complaint;
    state.detailId = c.id;

    const total = state.total;
    const idx = state.complaints.findIndex((x) => x.id === c.id);
    el('detailEntryNo').textContent = idx >= 0 ? `No. ${String(total - idx).padStart(3, '0')}` : '';

    el('detailTitle').textContent = c.residentName;
    el('detailMeta').textContent = `${c.roomNumber} · ${c.category} · Filed ${formatDate(c.dateSubmitted)}`;
    el('detailContact').textContent = c.contact;
    el('detailPriority').textContent = c.priority;
    el('detailUpdated').textContent = formatDate(c.lastUpdated);
    el('detailId').textContent = c.id;
    el('detailDescription').textContent = c.description;

    const addWrap = el('detailAdditionalWrap');
    if (c.additionalInfo && c.additionalInfo.trim()) {
      addWrap.hidden = false;
      el('detailAdditional').textContent = c.additionalInfo;
    } else {
      addWrap.hidden = true;
    }

    const stamp = el('detailStatusStamp');
    stamp.textContent = c.status;
    stamp.style.setProperty('--stamp-color', `var(${STATUS_COLOR_VAR[c.status] || '--status-open'})`);

    renderStatusChips(c.status);

    detailOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
  } catch (err) {
    showBanner(`Couldn't open that complaint: ${err.message}`, 'error');
    fetchComplaints();
  }
}

function renderStatusChips(currentStatus) {
  statusChipRow.innerHTML = '';
  STATUSES.forEach((s) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'status-chip' + (s === currentStatus ? ' active' : '');
    chip.style.setProperty('--chip-color', `var(${STATUS_COLOR_VAR[s]})`);
    chip.textContent = s;
    chip.disabled = s === currentStatus;
    chip.addEventListener('click', () => updateStatus(state.detailId, s));
    statusChipRow.appendChild(chip);
  });
}

async function updateStatus(id, newStatus) {
  try {
    const data = await apiFetch(`${API_BASE}/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    });
    showToast(`Status updated to "${newStatus}".`, 'success');
    const stamp = el('detailStatusStamp');
    stamp.textContent = data.complaint.status;
    stamp.style.setProperty('--stamp-color', `var(${STATUS_COLOR_VAR[data.complaint.status]})`);
    el('detailUpdated').textContent = formatDate(data.complaint.lastUpdated);
    renderStatusChips(data.complaint.status);
    fetchComplaints();
  } catch (err) {
    showBanner(`Couldn't update status: ${err.message}`, 'error');
  }
}

function closeDetail() {
  detailOverlay.hidden = true;
  document.body.style.overflow = '';
  state.detailId = null;
}

closeDetailBtn.addEventListener('click', closeDetail);
detailOverlay.addEventListener('click', (e) => { if (e.target === detailOverlay) closeDetail(); });

editComplaintBtn.addEventListener('click', () => {
  const c = state.complaints.find((x) => x.id === state.detailId);
  if (c) {
    closeDetail();
    openForm('edit', c);
  } else {
    // fetch fresh in case it's not in the current filtered list
    apiFetch(`${API_BASE}/${state.detailId}`).then((data) => {
      closeDetail();
      openForm('edit', data.complaint);
    });
  }
});

// ---------------------------------------------------------------------------
// Delete / cancel complaint
// ---------------------------------------------------------------------------
deleteComplaintBtn.addEventListener('click', () => {
  state.pendingDeleteId = state.detailId;
  confirmOverlay.hidden = false;
});

confirmCancelBtn.addEventListener('click', () => {
  confirmOverlay.hidden = true;
  state.pendingDeleteId = null;
});
confirmOverlay.addEventListener('click', (e) => {
  if (e.target === confirmOverlay) { confirmOverlay.hidden = true; state.pendingDeleteId = null; }
});

confirmDeleteBtn.addEventListener('click', async () => {
  const id = state.pendingDeleteId;
  if (!id) return;
  confirmDeleteBtn.disabled = true;
  try {
    await apiFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
    showToast('Complaint removed from the register.', 'success');
    confirmOverlay.hidden = true;
    closeDetail();
    fetchComplaints();
  } catch (err) {
    showBanner(`Couldn't remove complaint: ${err.message}`, 'error');
  } finally {
    confirmDeleteBtn.disabled = false;
    state.pendingDeleteId = null;
  }
});

// ---------------------------------------------------------------------------
// Keyboard: Escape closes topmost overlay
// ---------------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!confirmOverlay.hidden) { confirmOverlay.hidden = true; state.pendingDeleteId = null; return; }
  if (!formOverlay.hidden) { closeForm(); return; }
  if (!detailOverlay.hidden) { closeDetail(); return; }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
initStaticControls();
fetchComplaints();
