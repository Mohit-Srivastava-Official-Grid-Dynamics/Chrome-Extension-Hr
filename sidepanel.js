const state = {
  events: [],
  connected: false,
  lastSyncAt: null,
  error: null,
  loading: true
};

const uiState = {
  profileName: 'there',
  eventPriorities: {},
  futurePageIndex: 0,
  browserTheme: 'light'
};

const assistantState = {
  projectId: '',
  model: 'gemini-2.5-flash',
  contacts: {},
  messages: []
};

const ASSISTANT_STORAGE_KEYS = {
  projectId: 'assistant_vertex_project_id',
  model: 'assistant_vertex_model',
  contacts: 'assistant_contacts'
};

const UI_STORAGE_KEYS = {
  eventPriorities: 'event_priorities'
};

const FUTURE_EVENTS_PAGE_SIZE = 4;

const retryBtn = document.getElementById('retryBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const statusActions = document.getElementById('statusActions');
const statusBadge = document.getElementById('statusBadge');
const greetingTitle = document.getElementById('greetingTitle');
const greetingLine = document.getElementById('greetingLine');
const upcomingCount = document.getElementById('upcomingCount');
const dashboardHint = document.getElementById('dashboardHint');
const eventsList = document.getElementById('eventsList');
const emptyState = document.getElementById('emptyState');
const errorBox = document.getElementById('errorBox');
const clock = document.getElementById('clock');
const sectionCaption = document.getElementById('sectionCaption');

const scheduleTabBtn = document.getElementById('scheduleTabBtn');
const assistantTabBtn = document.getElementById('assistantTabBtn');
const scheduleTab = document.getElementById('scheduleTab');
const assistantTab = document.getElementById('assistantTab');

const assistantSettingsToggle = document.getElementById('assistantSettingsToggle');
const assistantSettings = document.getElementById('assistantSettings');
const vertexProjectIdInput = document.getElementById('vertexProjectIdInput');
const vertexModelInput = document.getElementById('vertexModelInput');
const saveAssistantSettingsBtn = document.getElementById('saveAssistantSettingsBtn');
const clearAssistantSettingsBtn = document.getElementById('clearAssistantSettingsBtn');
const contactNameInput = document.getElementById('contactNameInput');
const contactEmailInput = document.getElementById('contactEmailInput');
const addContactBtn = document.getElementById('addContactBtn');
const contactsList = document.getElementById('contactsList');
const directoryCountText = document.getElementById('directoryCountText');
const directoryImportInput = document.getElementById('directoryImportInput');
const importDirectoryBtn = document.getElementById('importDirectoryBtn');

const assistantErrorBox = document.getElementById('assistantErrorBox');
const promptSuggestions = document.getElementById('promptSuggestions');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');

const futureEventsList = document.getElementById('futureEventsList');
const futureEmptyState = document.getElementById('futureEmptyState');
const futurePrevBtn = document.getElementById('futurePrevBtn');
const futureNextBtn = document.getElementById('futureNextBtn');
const futurePageIndicator = document.getElementById('futurePageIndicator');
const futureSectionCaption = document.getElementById('futureSectionCaption');

retryBtn.addEventListener('click', async () => {
  if (state.connected && !state.error) {
    setLoading(true);
    const response = await sendMessage({ type: 'refresh', interactive: false });
    setLoading(false);
    if (!response.ok) {
      showError(response.error);
      return;
    }
    syncState(response);
    return;
  }

  await runConnectFlow(true);
});

disconnectBtn.addEventListener('click', async () => {
  setLoading(true);
  const response = await sendMessage({ type: 'disconnect' });
  setLoading(false);
  if (!response.ok) {
    showError(response.error);
    return;
  }
  syncState(response);
});

scheduleTabBtn.addEventListener('click', () => setActiveTab('schedule'));
assistantTabBtn.addEventListener('click', () => setActiveTab('assistant'));

assistantSettingsToggle.addEventListener('click', () => {
  assistantSettings.classList.toggle('hidden');
});

saveAssistantSettingsBtn.addEventListener('click', async () => {
  try {
    await saveAssistantConfig();
  } catch (error) {
    console.error('Save settings error:', error);
    showAssistantError('Error saving settings: ' + error.message);
  }
});

clearAssistantSettingsBtn.addEventListener('click', async () => {
  try {
    await clearAssistantConfig();
  } catch (error) {
    console.error('Clear settings error:', error);
    showAssistantError('Error clearing settings: ' + error.message);
  }
});

addContactBtn.addEventListener('click', async () => {
  await upsertContactFromInputs();
});

importDirectoryBtn.addEventListener('click', async () => {
  await importDirectoryFromTextarea();
});

contactsList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="remove-contact"]');
  if (!button) return;
  const nameKey = button.getAttribute('data-name-key');
  if (!nameKey) return;
  await removeContact(nameKey);
});

promptSuggestions.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-prompt]');
  if (!button) return;
  chatInput.value = button.getAttribute('data-prompt') || '';
  chatInput.focus();
});

eventsList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-priority]');
  if (!button) return;
  await setEventPriority(button.getAttribute('data-event-id'), button.getAttribute('data-priority'));
});

futureEventsList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-priority]');
  if (!button) return;
  await setEventPriority(button.getAttribute('data-event-id'), button.getAttribute('data-priority'));
});

futurePrevBtn.addEventListener('click', () => {
  if (uiState.futurePageIndex <= 0) return;
  uiState.futurePageIndex -= 1;
  render();
});

futureNextBtn.addEventListener('click', () => {
  uiState.futurePageIndex += 1;
  render();
});

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAssistantError();
  const text = (chatInput.value || '').trim();
  if (!text) return;

  const pendingProjectId = (vertexProjectIdInput.value || '').trim();
  const pendingModel = (vertexModelInput.value || '').trim();
  const hasUnsavedSettings = pendingProjectId !== assistantState.projectId || (pendingModel || 'gemini-2.5-flash') !== assistantState.model;
  if (hasUnsavedSettings) {
    await saveAssistantConfig({ silent: true });
  }

  if (!assistantState.projectId) {
    assistantSettings.classList.remove('hidden');
    showAssistantError('Add your Google Cloud Project ID in Settings, then press Save.');
    return;
  }

  chatInput.value = '';
  appendChatMessage('user', text);
  const pendingId = appendChatMessage('assistant', 'Thinking…', { pending: true });
  setAssistantBusy(true);

  const conversation = assistantState.messages
    .filter((message) => !message.pending && !message.internal)
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: message.content }));

  const response = await sendMessage({
    type: 'assistantChat',
    messages: conversation
  });

  setAssistantBusy(false);

  if (!response.ok) {
    updateChatMessage(pendingId, `Error: ${response.error || 'Assistant failed.'}`);
    showAssistantError(response.error || 'Assistant failed.');
    return;
  }

  updateChatMessage(pendingId, response.message || 'Done.');
});

bootstrap();
setInterval(updateLiveUi, 30_000);
setInterval(updateClock, 1_000);

async function bootstrap() {
  syncWithBrowserTheme();
  updateClock();
  setLoading(true);

  await loadUiPreferences();
  await loadProfileName();
  await loadAssistantConfig();

  const currentState = await sendMessage({ type: 'getState' });
  if (currentState.ok) {
    syncState(currentState);
  }

  if (currentState.ok && currentState.connected) {
    const refreshResponse = await sendMessage({ type: 'refresh', interactive: false });
    if (refreshResponse.ok) {
      syncState(refreshResponse);
    } else {
      showError(refreshResponse.error);
    }
  } else {
    await runConnectFlow(true);
  }

  setLoading(false);
}

function setActiveTab(tab) {
  const isAssistant = tab === 'assistant';
  scheduleTabBtn.classList.toggle('active', !isAssistant);
  assistantTabBtn.classList.toggle('active', isAssistant);
  scheduleTab.classList.toggle('hidden', isAssistant);
  assistantTab.classList.toggle('hidden', !isAssistant);
}

async function runConnectFlow(interactive) {
  setLoading(true);
  const response = await sendMessage({ type: 'connect', interactive });
  setLoading(false);

  if (!response.ok) {
    const message = normalizeError(response.error);
    state.connected = false;
    state.error = message;
    render();
    return;
  }

  syncState(response);
}

function syncState(response) {
  state.events = Array.isArray(response.events) ? response.events : [];
  state.connected = Boolean(response.connected);
  state.lastSyncAt = response.lastSyncAt || null;
  state.error = response.error || null;
  render();
}

function render() {
  updateLiveUi();
  renderError();
  renderStatusActions();
}

function updateLiveUi() {
  updateClock();

  const now = new Date();
  const visibleEvents = state.events
    .filter((event) => new Date(event.endIso) > now)
    .sort((a, b) => new Date(a.startIso) - new Date(b.startIso));
  const todayEvents = visibleEvents.filter((event) => isEventVisibleToday(event, now));
  const futureEvents = visibleEvents.filter((event) => !isEventVisibleToday(event, now));
  const nextOverallEvent = visibleEvents[0] || null;
  const firstName = extractFirstName(uiState.profileName);

  statusBadge.className = 'status-badge';

  if (state.loading) {
    statusBadge.classList.add('syncing');
    statusBadge.textContent = 'Syncing now';
  } else if (state.error) {
    statusBadge.classList.add('error');
    statusBadge.textContent = 'Needs attention';
  } else if (state.connected) {
    statusBadge.classList.add('connected');
    statusBadge.textContent = 'Calendar connected';
  } else {
    statusBadge.textContent = 'Calendar offline';
  }

  greetingTitle.textContent = `Hi ${firstName}`;
  greetingLine.textContent = buildGreetingLine({ now, todayEvents, nextOverallEvent });

  upcomingCount.textContent = String(todayEvents.length);
  dashboardHint.textContent = buildDashboardHint({ now, todayEvents, nextOverallEvent });
  sectionCaption.textContent = todayEvents.length
    ? `Showing ${todayEvents.length} remaining meeting${todayEvents.length === 1 ? '' : 's'} for today.`
    : 'Only today is shown here, so tomorrow stays out of the way.';

  eventsList.innerHTML = '';
  emptyState.classList.toggle('hidden', todayEvents.length > 0);
  updateEmptyStateCopy({ nextOverallEvent, now });

  for (const event of todayEvents) {
    eventsList.appendChild(renderEventCard(event, now, { section: 'today' }));
  }

  renderFutureEvents(futureEvents, now);
}

function renderStatusActions() {
  if (state.connected && !state.error) {
    retryBtn.textContent = 'Refresh';
  } else if (state.connected && state.error) {
    retryBtn.textContent = 'Retry sync';
  } else {
    retryBtn.textContent = 'Connect';
  }
  statusActions.classList.toggle('hidden', false);
  disconnectBtn.classList.toggle('hidden', !state.connected);
}

function renderError() {
  if (state.error) {
    errorBox.textContent = state.error;
    errorBox.classList.remove('hidden');
  } else {
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
  }
}

function renderEventCard(event, now, options = {}) {
  const start = new Date(event.startIso);
  const end = new Date(event.endIso);
  const wrapper = document.createElement('article');
  wrapper.className = 'event-card';

  const topLine = document.createElement('div');
  topLine.className = 'event-topline';

  const dayTag = document.createElement('div');
  dayTag.className = 'event-day-tag';
  dayTag.textContent = options.section === 'today' ? 'Today' : getDayLabel(start, now);
  topLine.appendChild(dayTag);

  const time = document.createElement('div');
  time.className = 'event-time';
  time.textContent = formatReadableEventRange(start, end, event.isAllDay, now, { includeDayLabel: false });
  topLine.appendChild(time);

  if (start <= now && end > now) {
    const livePill = document.createElement('div');
    livePill.className = 'event-live-pill';
    livePill.textContent = `Live now · ends in ${formatRelativeDuration(minutesBetween(now, end))}`;
    topLine.appendChild(livePill);
  }

  const title = document.createElement('h3');
  title.className = 'event-title';
  title.textContent = event.title;

  const location = document.createElement('div');
  location.className = 'event-location';
  location.textContent = event.location ? `Location: ${event.location}` : 'Location: Not added';

  const descriptionText = buildReadableDescription(event.description);
  const description = document.createElement('div');
  description.className = 'event-description';
  description.textContent = descriptionText || 'No extra notes for this meeting.';

  const actions = document.createElement('div');
  actions.className = 'event-actions';

  const priorityControls = createPriorityControls(event.id);

  if (event.joinUrl) {
    const joinLink = document.createElement('a');
    joinLink.className = 'join';
    joinLink.href = event.joinUrl;
    joinLink.target = '_blank';
    joinLink.rel = 'noreferrer';
    joinLink.textContent = 'Join meeting';
    actions.appendChild(joinLink);
  }

  if (event.eventUrl) {
    const openLink = document.createElement('a');
    openLink.href = event.eventUrl;
    openLink.target = '_blank';
    openLink.rel = 'noreferrer';
    openLink.textContent = 'Open in Calendar';
    actions.appendChild(openLink);
  }

  wrapper.append(topLine, title, location, description, priorityControls, actions);
  return wrapper;
}

function renderFutureEvents(events, now) {
  const totalPages = Math.max(1, Math.ceil(events.length / FUTURE_EVENTS_PAGE_SIZE));
  if (uiState.futurePageIndex >= totalPages) {
    uiState.futurePageIndex = totalPages - 1;
  }

  const startIndex = uiState.futurePageIndex * FUTURE_EVENTS_PAGE_SIZE;
  const pageEvents = events.slice(startIndex, startIndex + FUTURE_EVENTS_PAGE_SIZE);

  futureEventsList.innerHTML = '';
  futureEmptyState.classList.toggle('hidden', pageEvents.length > 0);
  futurePrevBtn.disabled = uiState.futurePageIndex === 0;
  futureNextBtn.disabled = uiState.futurePageIndex >= totalPages - 1 || events.length === 0;
  futurePageIndicator.textContent = events.length ? `Page ${uiState.futurePageIndex + 1} of ${totalPages}` : 'No pages yet';
  futureSectionCaption.textContent = events.length
    ? `${events.length} meeting${events.length === 1 ? '' : 's'} waiting after today.`
    : 'Tomorrow and beyond will show up here once they are in range.';

  for (const event of pageEvents) {
    futureEventsList.appendChild(renderEventCard(event, now, { section: 'future' }));
  }
}

function createPriorityControls(eventId) {
  const wrapper = document.createElement('div');
  wrapper.className = 'priority-controls';

  const label = document.createElement('div');
  label.className = 'priority-label';
  label.textContent = 'Priority';
  wrapper.appendChild(label);

  const options = document.createElement('div');
  options.className = 'priority-options';

  for (const priority of ['low', 'medium', 'high']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'priority-chip';
    button.textContent = priority.charAt(0).toUpperCase() + priority.slice(1);
    button.setAttribute('data-event-id', eventId);
    button.setAttribute('data-priority', priority);

    if ((uiState.eventPriorities[eventId] || '').toLowerCase() === priority) {
      button.classList.add('active', `priority-chip--${priority}`);
    }

    options.appendChild(button);
  }

  wrapper.appendChild(options);
  return wrapper;
}

function isEventVisibleToday(event, now) {
  const start = new Date(event.startIso);
  const end = new Date(event.endIso);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  return end > now && end >= startOfDay && start <= endOfDay;
}

function buildGreetingLine({ now, todayEvents, nextOverallEvent }) {
  if (!state.connected) {
    return 'Connect your calendar and this panel will shape the day around what matters most.';
  }

  if (state.loading) {
    return 'Pulling your schedule into focus so the rest of the day feels lighter.';
  }

  if (state.error) {
    return 'A quick reconnect will bring today back into focus.';
  }

  if (!todayEvents.length && nextOverallEvent) {
    const nextStart = new Date(nextOverallEvent.startIso);
    const dayLabel = getDayLabel(nextStart, now);
    return `Your day looks clear. The next thing on deck is ${dayLabel.toLowerCase()} at ${formatClockTime(nextStart)}.`;
  }

  if (!todayEvents.length) {
    return 'A calm runway today. Use the space for focused work before anything new lands.';
  }

  const liveEvent = todayEvents.find((event) => new Date(event.startIso) <= now && new Date(event.endIso) > now);
  if (liveEvent) {
    return `You're already in motion. ${liveEvent.title} is live, and the rest of today is lined up underneath it.`;
  }

  if (todayEvents.length === 1) {
    return 'Just one meeting ahead today, which leaves plenty of room for deep work around it.';
  }

  return `${todayEvents.length} meetings are stacked for today. Everything you need next is waiting below.`;
}

function buildDashboardHint({ now, todayEvents, nextOverallEvent }) {
  if (!state.connected) {
    return 'Connect once and your upcoming meetings for today will appear here automatically.';
  }

  if (state.error) {
    return state.error;
  }

  if (!todayEvents.length && nextOverallEvent) {
    const nextStart = new Date(nextOverallEvent.startIso);
    return `Next meeting: ${getDayLabel(nextStart, now)} at ${formatClockTime(nextStart)}.`;
  }

  if (!todayEvents.length) {
    return 'No more meetings are scheduled for today.';
  }

  const nextStart = new Date(todayEvents[0].startIso);
  const firstEvent = todayEvents[0];
  if (nextStart <= now && new Date(firstEvent.endIso) > now) {
    return `${firstEvent.title} is happening now.`;
  }

  return `Next up today: ${firstEvent.title} at ${formatClockTime(nextStart)}.`;
}

function updateEmptyStateCopy({ nextOverallEvent, now }) {
  const title = emptyState.querySelector('.empty-title');
  const copy = emptyState.querySelector('.empty-copy');
  if (!title || !copy) return;

  if (!state.connected) {
    title.textContent = 'Connect to see today at a glance';
    copy.textContent = 'Once connected, this space will show the meetings still ahead today.';
    return;
  }

  if (nextOverallEvent) {
    const nextStart = new Date(nextOverallEvent.startIso);
    title.textContent = 'Nothing else is lined up for today';
    copy.textContent = `You're clear for the rest of today. The next scheduled meeting is ${getDayLabel(nextStart, now)} at ${formatClockTime(nextStart)}.`;
    return;
  }

  title.textContent = 'Nothing else is lined up for today';
  copy.textContent = 'You have open air for the rest of the day. New meetings will appear here as soon as they land.';
}

function totalMinutesToday(events) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  return events.reduce((sum, event) => {
    const start = new Date(event.startIso);
    const end = new Date(event.endIso);
    if (end < startOfDay || start > endOfDay) {
      return sum;
    }

    const effectiveStart = start < startOfDay ? startOfDay : start;
    const effectiveEnd = end > endOfDay ? endOfDay : end;
    const minutes = Math.max(0, (effectiveEnd - effectiveStart) / 60000);
    return sum + minutes;
  }, 0);
}

function formatMinutes(minutes) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;

  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

function formatReadableEventRange(start, end, isAllDay, now, options = {}) {
  const dayLabel = getDayLabel(start, now);
  const prefix = options.includeDayLabel === false ? '' : `${dayLabel} · `;

  if (isAllDay) {
    return `${prefix}All day · ${start > now ? `starts in ${formatRelativeDuration(minutesBetween(now, start))}` : 'in progress'}`;
  }

  const timeRange = `${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  if (start <= now && end > now) {
    return `${prefix}${timeRange}`;
  }

  return `${prefix}${timeRange} · starts in ${formatRelativeDuration(minutesBetween(now, start))}`;
}

function getDayLabel(date, now) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTarget = new Date(date);
  startOfTarget.setHours(0, 0, 0, 0);

  const diffDays = Math.round((startOfTarget - startOfToday) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatRelativeDuration(totalMinutes) {
  const minutes = Math.max(0, totalMinutes);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;

  if (days > 0 && hours > 0) return `${days}d ${hours}h`;
  if (days > 0) return `${days}d`;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

function minutesBetween(a, b) {
  return Math.max(0, Math.round((b - a) / 60000));
}

function updateClock() {
  clock.textContent = new Date().toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function syncWithBrowserTheme() {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const applyTheme = (isDark) => {
    uiState.browserTheme = isDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', uiState.browserTheme);
  };

  applyTheme(mediaQuery.matches);

  const handleChange = (event) => applyTheme(event.matches);
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleChange);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(handleChange);
  }
}

function formatClockTime(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function setLoading(isLoading) {
  state.loading = isLoading;
  render();
}

function showError(message) {
  state.error = normalizeError(message || 'Something went wrong');
  renderError();
}

function normalizeError(message) {
  if (!message) return 'Unable to connect right now.';
  if (/OAuth2 not granted|revoked|user did not approve|cancel/i.test(message)) {
    return 'Google Calendar permission was not granted or was revoked. Open the panel and press Connect to re-authorize.';
  }
  if (/oauth|token|client id/i.test(message)) {
    return 'Google sign-in is not configured correctly yet. Double-check the OAuth client type and extension Item ID.';
  }
  return message;
}

function buildReadableDescription(rawHtml) {
  if (!rawHtml) return '';

  const parser = new DOMParser();
  const documentFragment = parser.parseFromString(rawHtml, 'text/html');
  const text = (documentFragment.body.textContent || '')
    .replace(/\s+/g, ' ')
    .replace(/\s([,.;:!?])/g, '$1')
    .trim();

  if (!text) return '';
  if (text.length <= 220) return text;
  return `${text.slice(0, 217).trim()}…`;
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function loadUiPreferences() {
  const stored = await chrome.storage.local.get([UI_STORAGE_KEYS.eventPriorities]);
  uiState.eventPriorities = stored[UI_STORAGE_KEYS.eventPriorities] || {};
}

async function setEventPriority(eventId, priority) {
  if (!eventId || !priority) return;
  uiState.eventPriorities[eventId] = priority;
  await chrome.storage.local.set({
    [UI_STORAGE_KEYS.eventPriorities]: uiState.eventPriorities
  });
  render();
}

async function loadProfileName() {
  try {
    const info = await chrome.identity.getProfileUserInfo();
    uiState.profileName = formatNameFromEmail(info?.email) || 'there';
  } catch (_error) {
    uiState.profileName = 'there';
  }
}

function formatNameFromEmail(email) {
  const value = String(email || '').trim();
  if (!value.includes('@')) return '';

  const localPart = value.split('@')[0]
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!localPart) return '';

  return localPart
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function extractFirstName(name) {
  const value = String(name || '').trim();
  return value ? value.split(' ')[0] : 'there';
}

async function loadAssistantConfig() {
  const stored = await chrome.storage.local.get([
    ASSISTANT_STORAGE_KEYS.projectId,
    ASSISTANT_STORAGE_KEYS.model,
    ASSISTANT_STORAGE_KEYS.contacts
  ]);

  assistantState.projectId = stored[ASSISTANT_STORAGE_KEYS.projectId] || '';
  assistantState.model = stored[ASSISTANT_STORAGE_KEYS.model] || 'gemini-2.5-flash';
  assistantState.contacts = stored[ASSISTANT_STORAGE_KEYS.contacts] || {};

  vertexProjectIdInput.value = assistantState.projectId;
  vertexModelInput.value = assistantState.model;
  renderContacts();

  if (!assistantState.messages.length) {
    appendChatMessage(
      'assistant',
      'Tell me who you want to meet with, and I will suggest conflict-free time slots (if you have access to their free/busy).'
    );
  }
}

async function saveAssistantConfig(options = {}) {
  hideAssistantError();
  assistantState.projectId = (vertexProjectIdInput.value || '').trim();
  assistantState.model = (vertexModelInput.value || '').trim() || 'gemini-2.5-flash';

  await chrome.storage.local.set({
    [ASSISTANT_STORAGE_KEYS.projectId]: assistantState.projectId,
    [ASSISTANT_STORAGE_KEYS.model]: assistantState.model
  });

  if (!options.silent) {
    appendChatMessage('assistant', 'Settings saved.', { internal: true });
  }
}

async function clearAssistantConfig() {
  hideAssistantError();
  assistantState.projectId = '';
  assistantState.model = 'gemini-2.5-flash';
  vertexProjectIdInput.value = '';
  vertexModelInput.value = assistantState.model;

  await chrome.storage.local.set({
    [ASSISTANT_STORAGE_KEYS.projectId]: '',
    [ASSISTANT_STORAGE_KEYS.model]: assistantState.model
  });

  appendChatMessage('assistant', 'Settings cleared.', { internal: true });
}

function normalizeContactKey(name) {
  return (name || '').trim().toLowerCase();
}

async function upsertContactFromInputs() {
  hideAssistantError();
  const name = (contactNameInput.value || '').trim();
  const email = (contactEmailInput.value || '').trim();

  if (!name || !email) {
    showAssistantError('Add a contact name and email.');
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showAssistantError('Enter a valid email address.');
    return;
  }

  const key = normalizeContactKey(name);
  assistantState.contacts[key] = { name, email };

  await chrome.storage.local.set({
    [ASSISTANT_STORAGE_KEYS.contacts]: assistantState.contacts
  });

  contactNameInput.value = '';
  contactEmailInput.value = '';
  renderContacts();
}

async function importDirectoryFromTextarea() {
  hideAssistantError();
  const raw = String(directoryImportInput.value || '').trim();
  if (!raw) {
    showAssistantError('Paste one employee per line in the format: name,email');
    return;
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let imported = 0;

  for (const line of lines) {
    const [namePart, emailPart] = line.split(',').map((value) => value?.trim() || '');
    if (!namePart || !emailPart) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailPart)) continue;

    assistantState.contacts[normalizeContactKey(namePart)] = {
      name: namePart,
      email: emailPart
    };
    imported += 1;
  }

  if (!imported) {
    showAssistantError('No valid employees found. Use one line per person: name,email');
    return;
  }

  await chrome.storage.local.set({
    [ASSISTANT_STORAGE_KEYS.contacts]: assistantState.contacts
  });

  directoryImportInput.value = '';
  renderContacts();
  appendChatMessage('assistant', `Imported ${imported} employee${imported === 1 ? '' : 's'} into the local directory.`, { internal: true });
}

async function removeContact(nameKey) {
  hideAssistantError();
  if (!assistantState.contacts[nameKey]) return;
  delete assistantState.contacts[nameKey];

  await chrome.storage.local.set({
    [ASSISTANT_STORAGE_KEYS.contacts]: assistantState.contacts
  });

  renderContacts();
}

function renderContacts() {
  const entries = Object.entries(assistantState.contacts || {})
    .map(([key, value]) => ({ key, name: value?.name || key, email: value?.email || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));

  directoryCountText.textContent = entries.length
    ? `${entries.length} employee${entries.length === 1 ? '' : 's'} stored locally for scheduling and email resolution.`
    : 'Store Grid employee emails locally so the assistant can resolve names instantly.';

  contactsList.innerHTML = '';
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'contacts-subtitle';
    empty.textContent = 'No employees stored yet.';
    contactsList.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'contact-row';

    const meta = document.createElement('div');
    meta.className = 'contact-meta';

    const name = document.createElement('div');
    name.className = 'contact-name';
    name.textContent = entry.name;

    const email = document.createElement('div');
    email.className = 'contact-email';
    email.textContent = entry.email;

    meta.append(name, email);

    const remove = document.createElement('button');
    remove.className = 'contact-remove';
    remove.type = 'button';
    remove.setAttribute('data-action', 'remove-contact');
    remove.setAttribute('data-name-key', entry.key);
    remove.textContent = 'Remove';

    row.append(meta, remove);
    contactsList.appendChild(row);
  }
}

function appendChatMessage(role, content, options = {}) {
  const message = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    role,
    content: String(content || ''),
    pending: Boolean(options.pending)
  };
  if (options.internal) {
    message.internal = true;
  }

  assistantState.messages.push(message);

  const wrapper = document.createElement('div');
  wrapper.className = `chat-message ${role}`;
  wrapper.setAttribute('data-message-id', message.id);

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  renderChatBubble(bubble, message.content);
  wrapper.appendChild(bubble);

  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  return message.id;
}

function updateChatMessage(messageId, newContent) {
  const message = assistantState.messages.find((item) => item.id === messageId);
  if (message) {
    message.content = String(newContent || '');
    message.pending = false;
  }

  const wrapper = chatMessages.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  const bubble = wrapper?.querySelector('.chat-bubble');
  if (bubble) {
    renderChatBubble(bubble, String(newContent || ''));
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showAssistantError(message) {
  assistantErrorBox.textContent = message;
  assistantErrorBox.classList.remove('hidden');
}

function hideAssistantError() {
  assistantErrorBox.textContent = '';
  assistantErrorBox.classList.add('hidden');
}

function setAssistantBusy(isBusy) {
  chatInput.disabled = isBusy;
  chatSendBtn.disabled = isBusy;
  assistantSettingsToggle.disabled = isBusy;
}

function renderChatBubble(container, content) {
  const text = String(content || '');
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const urlRegex = /https?:\/\/[^\s)]+/gi;
  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(text))) {
    const start = match.index;
    const url = match[0];

    if (start > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, start)));
    }

    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = url;
    container.appendChild(link);

    lastIndex = start + url.length;
  }

  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}
