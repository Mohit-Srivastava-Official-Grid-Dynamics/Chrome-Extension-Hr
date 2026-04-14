const state = {
  events: [],
  connected: false,
  lastSyncAt: null,
  error: null,
  loading: true
};

const retryBtn = document.getElementById('retryBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const statusActions = document.getElementById('statusActions');
const statusBadge = document.getElementById('statusBadge');
const lastSyncText = document.getElementById('lastSyncText');
const upcomingCount = document.getElementById('upcomingCount');
const plannedToday = document.getElementById('plannedToday');
const eventsList = document.getElementById('eventsList');
const emptyState = document.getElementById('emptyState');
const errorBox = document.getElementById('errorBox');
const clock = document.getElementById('clock');
const sectionCaption = document.getElementById('sectionCaption');

retryBtn.addEventListener('click', async () => {
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

bootstrap();
setInterval(updateLiveUi, 30_000);
setInterval(updateClock, 1_000);

async function bootstrap() {
  updateClock();
  setLoading(true);

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

  statusBadge.className = 'status-badge';

  if (state.loading) {
    statusBadge.classList.add('syncing');
    statusBadge.textContent = 'Syncing…';
  } else if (state.error) {
    statusBadge.classList.add('error');
    statusBadge.textContent = 'Needs attention';
  } else if (state.connected) {
    statusBadge.classList.add('connected');
    statusBadge.textContent = 'Connected';
  } else {
    statusBadge.textContent = 'Not connected';
  }

  lastSyncText.textContent = state.lastSyncAt
    ? `${new Date(state.lastSyncAt).toLocaleString()} · auto refresh enabled`
    : state.connected
      ? 'Connected, waiting for first sync'
      : 'Opening this panel will try to connect automatically';

  upcomingCount.textContent = String(visibleEvents.length);
  plannedToday.textContent = formatMinutes(totalMinutesToday(visibleEvents));
  sectionCaption.textContent = visibleEvents.length
    ? `Sorted by start time · completed meetings disappear automatically`
    : 'New items will appear here automatically';

  eventsList.innerHTML = '';
  emptyState.classList.toggle('hidden', visibleEvents.length > 0);

  for (const event of visibleEvents) {
    eventsList.appendChild(renderEventCard(event, now));
  }
}

function renderStatusActions() {
  const shouldShow = !state.connected || Boolean(state.error);
  statusActions.classList.toggle('hidden', !shouldShow);
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

function renderEventCard(event, now) {
  const start = new Date(event.startIso);
  const end = new Date(event.endIso);
  const wrapper = document.createElement('article');
  wrapper.className = 'event-card';

  const topLine = document.createElement('div');
  topLine.className = 'event-topline';

  const time = document.createElement('div');
  time.className = 'event-time';
  time.textContent = formatReadableEventRange(start, end, event.isAllDay, now);
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
  location.textContent = event.location ? `📍 ${event.location}` : '📍 No location added';

  const descriptionText = buildReadableDescription(event.description);
  const description = document.createElement('div');
  description.className = 'event-description';
  description.textContent = descriptionText || 'No extra notes for this meeting.';

  const actions = document.createElement('div');
  actions.className = 'event-actions';

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

  wrapper.append(topLine, title, location, description, actions);
  return wrapper;
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

function formatReadableEventRange(start, end, isAllDay, now) {
  const dayLabel = getDayLabel(start, now);

  if (isAllDay) {
    return `${dayLabel} · All day · ${start > now ? `starts in ${formatRelativeDuration(minutesBetween(now, start))}` : 'in progress'}`;
  }

  const timeRange = `${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  if (start <= now && end > now) {
    return `${dayLabel} · ${timeRange}`;
  }

  return `${dayLabel} · ${timeRange} · starts in ${formatRelativeDuration(minutesBetween(now, start))}`;
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
  if (/user did not approve|cancel/i.test(message)) {
    return 'Google Calendar permission was not granted. Open the panel again or press Connect to try once more.';
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