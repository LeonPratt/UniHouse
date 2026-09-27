let people = [];
let rotas = [];
let expenses = [];
let pendingMembers = [];
let me = null;
let live = false;
let supabase;
let rotaWeekOffset = 0;
let localRecurringRotas = {};
let calendarEvents = [];
let calendarMonthOffset = 0;
const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const isAdmin = () => me?.role === 'House admin';
const canManage = item => Boolean(me) && (isAdmin() || item.createdBy === me.id);
const canComplete = item => Boolean(me) && (isAdmin() || item.assignedTo === me.id);
const requireAccount = () => { if (me) return true; toast('Sign in and add housemates to start using Housemate.'); return false; };
const houseName = window.HOUSEMATE_CONFIG?.houseName?.trim() || 'Your house';
document.querySelectorAll('[data-house-name]').forEach(element => element.textContent = houseName);
const money = value => `£${Number(value || 0).toFixed(2)}`;
const initials = name => name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase();
const toneFor = name => ['me', 'jm', 'sk', 'rc'][Math.abs([...name].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 4];
const avatar = (letters, tone, classes = '') => `<span class="avatar avatar-${escapeHtml(tone)} ${escapeHtml(classes)}">${escapeHtml(letters)}</span>`;
const dayFor = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
const prettyDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const sharesFor = expense => expense.shares?.length ? expense.shares : expense.split.map((name, index) => { const total = Math.round(expense.amount * 100); return { name, amount: (Math.floor(total / expense.split.length) + (index < total % expense.split.length ? 1 : 0)) / 100 }; });
const shareFor = (expense, name) => sharesFor(expense).find(share => share.name === name)?.amount || 0;
function viewingWeekStart() { const start = new Date(); const day = start.getDay(); start.setDate(start.getDate() - (day === 0 ? 6 : day - 1) + rotaWeekOffset * 7); start.setHours(0, 0, 0, 0); return start; }
function inViewingWeek(item) { if (!item.dueDate) return rotaWeekOffset === 0; const start = viewingWeekStart(); const end = new Date(start); end.setDate(end.getDate() + 7); const due = new Date(`${item.dueDate}T12:00:00`); return due >= start && due < end; }
function formatWeekLabel() { const start = viewingWeekStart(); const end = new Date(start); end.setDate(end.getDate() + 6); const sameMonth = start.getMonth() === end.getMonth(); return sameMonth ? `${start.getDate()} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}` : `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`; }
function dateKey(date) { return new Date(date).toISOString().slice(0, 10); }
function calendarMonth() { const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() + calendarMonthOffset); date.setHours(0, 0, 0, 0); return date; }

function renderDashboardRota() {
  byId('dashboardRota').innerHTML = rotas.slice(0, 4).map((item, index) => `<div class="rota-item"><button class="rota-checkbox ${item.done ? 'done' : ''}" data-complete="${index}" aria-label="Mark ${escapeHtml(item.task)} complete" ${canComplete(item) ? '' : 'disabled'}>${item.done ? '✓' : ''}</button><div><strong>${escapeHtml(item.task)}</strong><small>${escapeHtml(item.person)}</small></div><span class="due-label">${item.done ? 'DONE' : escapeHtml(item.due.toUpperCase())}</span></div>`).join('') || '<p class="empty-state">No rota jobs yet. Add the first one.</p>';
  byId('rotaCount').textContent = rotas.filter(item => !item.done).length;
}

function renderRotaBoard() {
  const start = viewingWeekStart();
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return { key: date.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(), label: date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }).toUpperCase() }; });
  byId('rotaWeekLabel').textContent = rotaWeekOffset === 0 ? `This week · ${formatWeekLabel()}` : `Week of ${formatWeekLabel()}`;
  const tasksForWeek = rotas.filter(inViewingWeek);
  byId('rotaBoard').innerHTML = days.map(day => `<div class="rota-column"><h3>${day.label}</h3>${tasksForWeek.filter(item => item.day === day.key).map(item => { const index = rotas.indexOf(item); return `<article class="rota-task ${item.done ? 'done' : ''}" ${canComplete(item) ? `data-complete="${index}"` : ''}>${canManage(item) ? `<button class="delete-task-button" data-delete-task="${index}" aria-label="Delete ${escapeHtml(item.task)}">×</button>` : ''}<strong>${item.done ? '✓ ' : ''}${escapeHtml(item.task)}</strong><span>${avatar(item.initials, item.tone, 'tiny-avatar')}${escapeHtml(item.person.split(' ')[0])}</span></article>`; }).join('') || '<p class="empty-state">Nothing here yet</p>'}</div>`).join('');
}

function renderCalendar() {
  const month = calendarMonth(); const year = month.getFullYear(); const monthIndex = month.getMonth();
  byId('calendarMonthLabel').textContent = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const firstMondayOffset = (month.getDay() + 6) % 7; const gridStart = new Date(year, monthIndex, 1 - firstMondayOffset); const today = dateKey(new Date());
  byId('calendarGrid').innerHTML = Array.from({ length: 42 }, (_, index) => { const day = new Date(gridStart); day.setDate(gridStart.getDate() + index); const key = dateKey(day); const inMonth = day.getMonth() === monthIndex; const events = calendarEvents.filter(event => event.startsOn <= key && event.endsOn >= key); return `<div class="calendar-day ${inMonth ? '' : 'muted'} ${key === today ? 'today' : ''}"><span class="calendar-date">${day.getDate()}</span>${events.map(event => `<button class="calendar-event" data-calendar-event="${escapeHtml(event.id)}" title="${escapeHtml(event.title)}${event.location ? ` · ${escapeHtml(event.location)}` : ''}">${escapeHtml(event.title)}${event.location ? ` <span>· ${escapeHtml(event.location)}</span>` : ''}</button>`).join('')}</div>`; }).join('');
}

function expenseTotals() {
  const mine = me?.name;
  const paid = expenses.filter(item => item.paidBy === mine).reduce((sum, item) => sum + item.amount, 0);
  const owed = expenses.filter(item => item.paidBy === mine).reduce((sum, item) => sum + sharesFor(item).filter(share => share.name !== mine).reduce((shareSum, share) => shareSum + share.amount, 0), 0);
  const owes = expenses.filter(item => item.paidBy !== mine).reduce((sum, item) => sum + shareFor(item, mine), 0);
  return { paid, owed, owes, net: owed - owes };
}

function allBalances() {
  const balances = Object.fromEntries(people.map(person => [person.name, 0]));
  expenses.forEach(expense => {
    balances[expense.paidBy] = (balances[expense.paidBy] || 0) + Math.round(expense.amount * 100);
    const shares = sharesFor(expense);
    shares.forEach(share => { balances[share.name] = (balances[share.name] || 0) - Math.round(share.amount * 100); });
  });
  return balances;
}

function renderSettlement() {
  const balances = allBalances();
  const creditors = Object.entries(balances).filter(([, amount]) => amount > 0).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  const debtors = Object.entries(balances).filter(([, amount]) => amount < 0).map(([name, amount]) => ({ name, amount: -amount })).sort((a, b) => b.amount - a.amount);
  const transfers = [];
  while (creditors.length && debtors.length) { const creditor = creditors[0], debtor = debtors[0], amount = Math.min(creditor.amount, debtor.amount); transfers.push({ from: debtor.name, to: creditor.name, amount }); creditor.amount -= amount; debtor.amount -= amount; if (!creditor.amount) creditors.shift(); if (!debtor.amount) debtors.shift(); }
  byId('settlementList').innerHTML = transfers.length ? transfers.map(item => `<div class="settlement-row"><strong>${escapeHtml(item.from)}</strong><span class="settlement-arrow">→</span><strong>${escapeHtml(item.to)}</strong><span class="settlement-amount">${money(item.amount / 100)}</span></div>`).join('') : '<div class="settlement-empty">Everyone is all square.</div>';
  byId('balanceBreakdown').innerHTML = `<h3>Net balances</h3>${people.map(person => { const amount = balances[person.name] || 0; const label = amount > 0 ? `is owed ${money(amount / 100)}` : amount < 0 ? `owes ${money(-amount / 100)}` : 'is all square'; return `<div class="member-balance"><span>${escapeHtml(person.name)}${person.id === me.id ? ' (you)' : ''}</span><strong class="${amount > 0 ? 'positive' : amount < 0 ? 'negative' : ''}">${label}</strong></div>`; }).join('')}`;
}

function renderExpenses() {
  const totals = expenseTotals();
  byId('expenseList').innerHTML = expenses.map(expense => `<div class="expense-row"><span class="expense-icon">${escapeHtml(expense.icon)}</span><div class="expense-name"><strong>${escapeHtml(expense.name)}</strong><small>Paid by ${escapeHtml(expense.paidBy === me?.name ? 'you' : expense.paidBy)}</small></div><span class="expense-date">${escapeHtml(expense.date)}</span><strong class="expense-cost">${money(expense.amount)}</strong><span class="expense-status">SPLIT ${expense.split.length} WAYS</span></div>`).join('') || '<p class="empty-state">No shared expenses yet.</p>';
  byId('expenseSubtitle').textContent = `${expenses.length} expense${expenses.length === 1 ? '' : 's'} so far`;
  byId('youPaid').textContent = money(totals.paid); byId('youOwed').textContent = money(Math.max(0, totals.owed)); byId('youOwe').textContent = money(Math.max(0, totals.owes));
  byId('balanceTotal').textContent = money(Math.abs(totals.net));
  document.querySelector('.balance-card p').textContent = totals.net >= 0 ? `You’re owed ${money(totals.net)} this month` : `You owe ${money(Math.abs(totals.net))} this month`;
  const spendingCard = document.querySelectorAll('.summary-card')[2];
  if (spendingCard) { const totalSpend = expenses.reduce((sum, item) => sum + item.amount, 0); spendingCard.querySelector('strong').textContent = money(totalSpend); spendingCard.querySelector('p').textContent = 'Shared spending to date'; spendingCard.querySelector('.progress-label').textContent = `${expenses.length} logged expense${expenses.length === 1 ? '' : 's'}`; }
  const next = rotas.find(item => !item.done); const nextCard = document.querySelector('.task-summary');
  if (next && nextCard) { nextCard.querySelector('strong').textContent = next.task; nextCard.querySelector('p').textContent = next.person === me?.name ? 'You' : next.person; const pill = nextCard.closest('.summary-card').querySelector('.status-pill'); if (pill) pill.textContent = next.due; }
  else if (nextCard) { nextCard.querySelector('strong').textContent = 'No tasks yet'; nextCard.querySelector('p').textContent = 'Add the first task when your house is ready.'; const pill = nextCard.closest('.summary-card').querySelector('.status-pill'); if (pill) pill.textContent = '—'; }
}

function renderPeople() {
  const balanceFor = name => (allBalances()[name] || 0) / 100;
  const balanceLabel = name => { const balance = balanceFor(name); return Math.abs(balance) < .005 ? 'All square' : balance > 0 ? `${money(balance)} owed` : `owes ${money(Math.abs(balance))}`; };
  byId('peopleList').innerHTML = people.map(person => `<div class="person-row">${avatar(person.initials, person.tone)}<div><strong>${escapeHtml(person.name)}${person.id === me?.id ? ' (you)' : ''}</strong><small>${escapeHtml(person.role)}</small></div>${person.role === 'House admin' ? '<span class="admin-badge">ADMIN</span>' : '<span></span>'}<span class="person-balance">${balanceLabel(person.name)}</span></div>`).join('') || '<p class="empty-state">No approved housemates yet.</p>';
  const peopleCount = document.querySelector('.people-panel .panel-heading p'); if (peopleCount) peopleCount.textContent = `${people.length} approved member${people.length === 1 ? '' : 's'}`;
}

function renderPending() {
  const container = byId('pendingList');
  if (!live || me?.role === 'House admin') {
    container.innerHTML = pendingMembers.length ? pendingMembers.map(person => `<div class="pending-row">${avatar(person.initials, person.tone || 'rc')}<div><strong>${escapeHtml(person.name)}</strong><small>Requested access ${escapeHtml(person.createdAt)} · ${escapeHtml(person.email || '')}</small></div><div><button class="approve-button" data-approval="approve" data-member-id="${escapeHtml(person.id)}">Approve</button><button class="decline-button" data-approval="decline" data-member-id="${escapeHtml(person.id)}">Decline</button></div></div>`).join('') : '<p class="empty-state">No pending requests — everyone is sorted.</p>';
  } else container.innerHTML = '<p class="empty-state">Only a house admin can approve requests.</p>';
  byId('pendingCount').textContent = pendingMembers.length;
  byId('approvalCount').textContent = pendingMembers.length;
}

function renderActivity() {
  const newestExpense = expenses[0];
  const completed = rotas.find(item => item.done);
  const lines = [];
  if (newestExpense) lines.push(`<article class="activity-item"><span class="activity-symbol">£</span><div><p><b>${escapeHtml(newestExpense.paidBy === me?.name ? 'You' : newestExpense.paidBy)} added ${escapeHtml(newestExpense.name)}</b> and split it with the house.</p><small>${escapeHtml(newestExpense.date)}</small></div></article>`);
  if (completed) lines.push(`<article class="activity-item"><span class="activity-symbol">✓</span><div><p><b>${escapeHtml(completed.person)} completed ${escapeHtml(completed.task)}.</b> Nice one.</p><small>This week</small></div></article>`);
  if (!lines.length) lines.push('<p class="empty-state">Activity will appear here as your house starts using the app.</p>');
  byId('activityList').innerHTML = lines.join('');
}

function populateForms() {
  const expenseSelect = document.querySelector('#expenseForm select[name="paidBy"]');
  const taskSelect = document.querySelector('#taskForm select[name="assigned"]');
  if (!me) {
    expenseSelect.innerHTML = '<option>Sign in to add an expense</option>';
    taskSelect.innerHTML = '<option>Sign in to assign a task</option>';
    document.querySelector('.split-members').innerHTML = '';
    byId('recurringStartWith').innerHTML = '<option>Sign in to create a rota</option>';
    byId('recurringMembers').innerHTML = '';
    document.querySelector('.page-heading .eyebrow').textContent = 'YOUR HOUSE';
    document.querySelector('#accountModal h2').textContent = 'Your account';
    return;
  }
  expenseSelect.innerHTML = `<option>${escapeHtml(me.name)} (you)</option>`;
  taskSelect.innerHTML = people.map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}${person.id === me.id ? ' (you)' : ''}</option>`).join('');
  document.querySelector('.split-members').innerHTML = people.map(person => `<label><input type="checkbox" name="split" value="${escapeHtml(person.id)}" checked /> ${escapeHtml(person.name)}${person.id === me.id ? ' (you)' : ''}</label>`).join('');
  byId('recurringStartWith').innerHTML = people.map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}${person.id === me.id ? ' (you)' : ''}</option>`).join('');
  byId('recurringMembers').innerHTML = people.map(person => `<label><input type="checkbox" name="recurringMember" value="${escapeHtml(person.id)}" checked /> ${escapeHtml(person.name)}${person.id === me.id ? ' (you)' : ''}</label>`).join('');
  document.querySelector('.page-heading .eyebrow').textContent = `GOOD MORNING, ${me.name.split(' ')[0].toUpperCase()}`;
  document.querySelector('#accountModal h2').textContent = me.name;
}

function renderAll() { renderDashboardRota(); renderRotaBoard(); renderCalendar(); renderExpenses(); renderPeople(); renderPending(); renderActivity(); populateForms(); }
function toast(message) { const el = byId('toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2800); }

async function loadLiveData() {
  const [profileResult, choreResult, expenseResult, shareResult, pendingResult, eventResult] = await Promise.all([
    supabase.from('profiles').select('id, display_name, status, role, created_at').eq('status', 'approved').order('created_at'),
    supabase.from('chores').select('id, title, assigned_to, created_by, due_date, completed_at, recurring_rota_id').order('due_date'),
    supabase.from('expenses').select('id, title, amount, paid_by, spent_on, created_at').order('spent_on', { ascending: false }),
    supabase.from('expense_shares').select('expense_id, member_id, amount, settled_at'),
    me.role === 'House admin' ? supabase.from('profiles').select('id, display_name, created_at').eq('status', 'pending').order('created_at') : Promise.resolve({ data: [] }),
    supabase.from('house_events').select('id, title, starts_on, ends_on, location, notes').order('starts_on')
  ]);
  const error = [profileResult, choreResult, expenseResult, shareResult, pendingResult, eventResult].find(result => result.error)?.error;
  if (error) throw error;
  people = profileResult.data.map((profile, index) => ({ id: profile.id, name: profile.display_name, initials: initials(profile.display_name), tone: ['me', 'jm', 'sk', 'rc'][index % 4], role: profile.role === 'admin' ? 'House admin' : 'Housemate', balance: '' }));
  me = people.find(person => person.id === window.housemateAuth.session.user.id) || { id: window.housemateAuth.session.user.id, name: window.housemateAuth.profile.display_name, role: window.housemateAuth.profile.role === 'admin' ? 'House admin' : 'Housemate', initials: initials(window.housemateAuth.profile.display_name), tone: 'me' };
  const memberById = Object.fromEntries(people.map(person => [person.id, person]));
  rotas = choreResult.data.map(chore => { const owner = memberById[chore.assigned_to] || { name: 'Former housemate', initials: '??', tone: 'rc' }; return { id: chore.id, task: chore.title, person: owner.name, initials: owner.initials, tone: owner.tone, assignedTo: chore.assigned_to, createdBy: chore.created_by, day: dayFor(chore.due_date), due: prettyDate(chore.due_date), done: Boolean(chore.completed_at), dueDate: chore.due_date, recurringRotaId: chore.recurring_rota_id }; });
  const sharesByExpense = shareResult.data.reduce((all, share) => ({ ...all, [share.expense_id]: [...(all[share.expense_id] || []), share] }), {});
  expenses = expenseResult.data.map(expense => { const shares = (sharesByExpense[expense.id] || []).map(share => ({ name: memberById[share.member_id]?.name, amount: Number(share.amount) })).filter(share => share.name); return { id: expense.id, name: expense.title, icon: '◒', paidBy: memberById[expense.paid_by]?.name || 'Former housemate', date: prettyDate(expense.spent_on), amount: Number(expense.amount), split: shares.map(share => share.name), shares }; });
  pendingMembers = (pendingResult.data || []).map(profile => ({ id: profile.id, name: profile.display_name, initials: initials(profile.display_name), tone: toneFor(profile.display_name), email: 'New housemate', createdAt: prettyDate(profile.created_at.slice(0, 10)) }));
  calendarEvents = eventResult.data.map(event => ({ id: event.id, title: event.title, startsOn: event.starts_on, endsOn: event.ends_on, location: event.location, notes: event.notes }));
  renderAll();
}

async function completeTask(index) {
  const task = rotas[index]; if (!task) return;
  if (!canComplete(task)) return toast('Only the assignee or an admin can complete this task.');
  if (task.recurringRotaId && task.done) return toast('This repeating turn is already complete. The next turn has been assigned.');
  if (live) {
    const { error } = await supabase.rpc('set_chore_completion', { p_chore_id: task.id, p_complete: !task.done });
    if (error) return toast(`Couldn’t complete this rota: ${error.message}`);
    await loadLiveData(); return toast(task.done ? 'Task reopened.' : 'Task marked as done.');
  }
  const nextDone = !task.done; task.done = nextDone; renderDashboardRota(); renderRotaBoard(); renderActivity();
  if (task.recurringRotaId && !live && nextDone) {
    const rule = localRecurringRotas[task.recurringRotaId];
    if (rule) { const upcoming = rotas.filter(item => item.recurringRotaId === task.recurringRotaId && !item.done); const latest = upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).at(-1); if (latest && upcoming.length < 10) { const lastPerson = people.find(person => person.name === latest.person); const nextMemberIndex = (rule.memberIds.indexOf(lastPerson.id) + 1) % rule.memberIds.length; const nextDue = new Date(`${latest.dueDate}T12:00:00`); nextDue.setDate(nextDue.getDate() + rule.intervalDays); const owner = people.find(person => person.id === rule.memberIds[nextMemberIndex]); const dueDate = nextDue.toISOString().slice(0, 10); rotas.push({ id: `local-${Date.now()}`, task: rule.title, person: owner.name, initials: owner.initials, tone: owner.tone, day: dayFor(dueDate), due: prettyDate(dueDate), dueDate, done: false, recurringRotaId: task.recurringRotaId }); } }
    renderRotaBoard();
  }
  toast(nextDone ? 'Task marked as done — lovely.' : 'Task reopened.');
}

async function deleteTask(index) {
  const task = rotas[index]; if (!task || !canManage(task) || !window.confirm(`Delete “${task.task}” from the rota?`)) return;
  if (task.recurringRotaId && !window.confirm('This is a repeating rota. Delete every future turn as well?')) return;
  if (live) { const source = task.recurringRotaId ? 'recurring_rotas' : 'chores'; const id = task.recurringRotaId || task.id; const { error } = await supabase.from(source).delete().eq('id', id); if (error) return toast(`Couldn’t delete this task: ${error.message}`); await loadLiveData(); }
  else { if (task.recurringRotaId) { rotas = rotas.filter(item => item.recurringRotaId !== task.recurringRotaId); delete localRecurringRotas[task.recurringRotaId]; } else rotas.splice(index, 1); renderDashboardRota(); renderRotaBoard(); renderActivity(); }
  toast(task.recurringRotaId ? 'Recurring rota deleted.' : 'Task deleted from the rota.');
}

async function changeApproval(id, status) {
  if (live) { const { error } = await supabase.from('profiles').update({ status }).eq('id', id); if (error) return toast(`Couldn’t update this request: ${error.message}`); await loadLiveData(); }
  else { pendingMembers = pendingMembers.filter(person => person.id !== id); renderPending(); }
  toast(status === 'approved' ? 'Housemate approved and ready to join.' : 'Request declined.');
}

function navigate(page) { document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === page)); document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('active', el.dataset.page === page)); location.hash = page; window.scrollTo({ top: 0, behavior: 'smooth' }); document.querySelector('.sidebar').classList.remove('open'); }

document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', event => { event.preventDefault(); navigate(link.dataset.page); }));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.go)));
document.addEventListener('click', event => { const deleteButton = event.target.closest('[data-delete-task]'); if (deleteButton) { event.stopPropagation(); deleteTask(Number(deleteButton.dataset.deleteTask)); return; } const taskButton = event.target.closest('[data-complete]'); if (taskButton) completeTask(Number(taskButton.dataset.complete)); const approvalButton = event.target.closest('[data-approval]'); if (approvalButton) changeApproval(approvalButton.dataset.memberId, approvalButton.dataset.approval === 'approve' ? 'approved' : 'rejected'); });
document.querySelectorAll('[data-open-expense]').forEach(button => button.addEventListener('click', () => { byId('expenseForm').reset(); byId('expenseForm').date.value = new Date().toISOString().slice(0, 10); byId('expenseModal').showModal(); }));
byId('addTaskButton').addEventListener('click', () => byId('taskModal').showModal());
byId('addRecurringButton').addEventListener('click', () => { byId('recurringForm').reset(); byId('recurringForm').startDate.value = new Date().toISOString().slice(0, 10); byId('recurringModal').showModal(); });
byId('addEventButton').addEventListener('click', () => { byId('eventForm').reset(); const today = new Date().toISOString().slice(0, 10); byId('eventForm').startsOn.value = today; byId('eventForm').endsOn.value = today; byId('eventModal').showModal(); });
document.querySelectorAll('.modal-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
byId('accountButton').addEventListener('click', () => byId('accountModal').showModal());
byId('settingsButton').addEventListener('click', () => toast('House settings are coming next.'));
byId('notificationButton').addEventListener('click', () => byId('accountModal').showModal());
byId('mobileMenu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
byId('closeStrip').addEventListener('click', event => event.currentTarget.parentElement.remove());
byId('inviteInfo').addEventListener('click', () => toast('New accounts stay pending until an admin approves them.'));
byId('settleButton').addEventListener('click', () => { renderSettlement(); byId('settlementModal').showModal(); });
byId('closeSettlementButton').addEventListener('click', () => byId('settlementModal').close());
byId('signOutButton').addEventListener('click', async () => { if (live) { const disabled = await window.disableRotaPush?.(); if (disabled === false) return toast('Could not remove this device’s reminders. Try again before signing out.'); await supabase.auth.signOut(); } window.location.assign('./auth.html'); });
byId('previousWeekButton').addEventListener('click', () => { rotaWeekOffset -= 1; renderRotaBoard(); });
byId('nextWeekButton').addEventListener('click', () => { rotaWeekOffset += 1; renderRotaBoard(); });
byId('currentWeekButton').addEventListener('click', () => { rotaWeekOffset = 0; renderRotaBoard(); });
byId('previousMonthButton').addEventListener('click', () => { calendarMonthOffset -= 1; renderCalendar(); });
byId('nextMonthButton').addEventListener('click', () => { calendarMonthOffset += 1; renderCalendar(); });
byId('currentMonthButton').addEventListener('click', () => { calendarMonthOffset = 0; renderCalendar(); });

byId('expenseForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!requireAccount()) return; const form = new FormData(event.currentTarget); const split = form.getAll('split'); if (!split.length) return toast('Choose at least one person to split with.');
  const amount = Number(form.get('amount')); const paidBy = me.name;
  if (live) {
    const { error } = await supabase.rpc('create_expense', { p_title: form.get('name'), p_amount: amount, p_spent_on: form.get('date'), p_member_ids: split });
    if (error) return toast(`Couldn’t add expense: ${error.message}`);
    byId('expenseModal').close(); await loadLiveData(); return toast('Expense added and split with the house.');
  }
  expenses.unshift({ id: `local-${Date.now()}`, name: form.get('name'), icon: '◒', paidBy, date: prettyDate(form.get('date')), amount, split: people.filter(person => split.includes(person.id)).map(person => person.name) }); byId('expenseModal').close(); renderExpenses(); renderActivity(); toast('Expense added and split with the house.');
});

byId('taskForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!requireAccount()) return; const form = new FormData(event.currentTarget); const owner = people.find(person => person.id === form.get('assigned')) || me; const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 4);
  if (live) { const { error } = await supabase.from('chores').insert({ title: form.get('taskName'), assigned_to: owner.id, created_by: me.id, due_date: dueDate.toISOString().slice(0, 10) }); if (error) return toast(`Couldn’t add task: ${error.message}`); byId('taskModal').close(); await loadLiveData(); return toast('New task added to this week’s rota.'); }
  const dueDateText = dueDate.toISOString().slice(0, 10); rotas.push({ id: `local-${Date.now()}`, task: form.get('taskName'), person: owner.name, initials: owner.initials, tone: owner.tone, day: dayFor(dueDateText), due: prettyDate(dueDateText), dueDate: dueDateText, done: false }); byId('taskModal').close(); renderDashboardRota(); renderRotaBoard(); toast('New task added to this week’s rota.');
});

byId('recurringForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!requireAccount()) return; const form = new FormData(event.currentTarget); const selectedIds = form.getAll('recurringMember');
  if (!selectedIds.length) return toast('Choose at least one person for the rotation.');
  const startId = form.get('startsWith'); const startIndex = selectedIds.indexOf(startId); const memberOrder = [...selectedIds.slice(startIndex), ...selectedIds.slice(0, startIndex)];
  if (startIndex < 0) return toast('The starting person must be included in the rotation.');
  const title = form.get('title'), intervalDays = Number(form.get('intervalDays')), startDate = form.get('startDate');
  if (live) {
    const { error } = await supabase.rpc('create_recurring_rota', { p_title: title, p_interval_days: intervalDays, p_member_order: memberOrder, p_start_date: startDate });
    if (error) return toast(`Couldn’t create recurring rota: ${error.message}`);
    byId('recurringModal').close(); await loadLiveData(); return toast('Recurring rota created. The first turn is ready.');
  }
  const rotaId = `local-recurring-${Date.now()}`; localRecurringRotas[rotaId] = { title, intervalDays, memberIds: memberOrder, index: 9 }; const firstDate = new Date(`${startDate}T12:00:00`); Array.from({ length: 10 }, (_, index) => { const due = new Date(firstDate); due.setDate(firstDate.getDate() + index * intervalDays); const owner = people.find(person => person.id === memberOrder[index % memberOrder.length]); const dueDate = due.toISOString().slice(0, 10); rotas.push({ id: `local-${Date.now()}-${index}`, task: title, person: owner.name, initials: owner.initials, tone: owner.tone, day: dayFor(dueDate), due: prettyDate(dueDate), dueDate, done: false, recurringRotaId: rotaId }); }); byId('recurringModal').close(); renderAll(); toast('Recurring rota created with 10 upcoming turns.');
});

byId('eventForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!requireAccount()) return; const form = new FormData(event.currentTarget); const startsOn = form.get('startsOn'), endsOn = form.get('endsOn');
  if (endsOn < startsOn) return toast('The end date must be on or after the start date.');
  const item = { title: form.get('title'), startsOn, endsOn, location: form.get('location'), notes: form.get('notes') };
  if (live) { const { error } = await supabase.from('house_events').insert({ title: item.title, starts_on: startsOn, ends_on: endsOn, location: item.location || null, notes: item.notes || null, created_by: me.id }); if (error) return toast(`Couldn’t add event: ${error.message}`); byId('eventModal').close(); await loadLiveData(); return toast('Added to the house calendar.'); }
  calendarEvents.push({ id: `local-event-${Date.now()}`, ...item }); byId('eventModal').close(); renderCalendar(); toast('Added to the house calendar.');
});

function start() {
  const today = new Date(); byId('todayLabel').textContent = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
  renderAll(); if (location.hash && byId(location.hash.slice(1))) navigate(location.hash.slice(1));
}

async function connectAuthenticatedUser(auth) {
  if (!auth?.session?.user || !auth.supabase || !auth.profile) return;
  live = true;
  supabase = auth.supabase;
  me = {
    id: auth.session.user.id,
    name: auth.profile.display_name,
    role: auth.profile.role === 'admin' ? 'House admin' : 'Housemate',
    initials: initials(auth.profile.display_name),
    tone: 'me'
  };
  renderAll();
  try {
    await loadLiveData();
  } catch (error) {
    toast(`Couldn’t load your house data: ${error.message}`);
  }
}

window.addEventListener('housemate-auth-ready', event => { void connectAuthenticatedUser(event.detail); });
window.addEventListener('pageshow', () => { void connectAuthenticatedUser(window.housemateAuth); });
start();
void connectAuthenticatedUser(window.housemateAuth);
