const STORAGE_KEYS = {
  events: 'events',
  lastSyncAt: 'lastSyncAt',
  error: 'error',
  connected: 'connected'
};

const REFRESH_ALARM = 'refresh-calendar-events';
const LOOKAHEAD_DAYS = 7;
const MAX_RESULTS = 100;

chrome.runtime.onInstalled.addListener(async () => {
  await initializeExtension();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeExtension();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    try {
      await refreshEvents(false);
    } catch (error) {
      console.error('Background refresh failed:', error);
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error('Message handling failed:', error);
      sendResponse({ ok: false, error: error.message || 'Unknown error' });
    });
  return true;
});

async function initializeExtension() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await ensureRefreshAlarm();
}

async function ensureRefreshAlarm() {
  const existing = await chrome.alarms.get(REFRESH_ALARM);
  if (!existing) {
    await chrome.alarms.create(REFRESH_ALARM, {
      periodInMinutes: 1
    });
  }
}

async function handleMessage(message) {
  switch (message?.type) {
    case 'getState':
      return getState();
    case 'connect':
      await refreshEvents(Boolean(message.interactive));
      return getState();
    case 'refresh':
      await refreshEvents(Boolean(message.interactive));
      return getState();
    case 'disconnect':
      await chrome.identity.clearAllCachedAuthTokens();
      await chrome.storage.local.set({
        [STORAGE_KEYS.events]: [],
        [STORAGE_KEYS.lastSyncAt]: null,
        [STORAGE_KEYS.error]: null,
        [STORAGE_KEYS.connected]: false
      });
      return getState();
    default:
      throw new Error('Unsupported message type');
  }
}

async function getState() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.events,
    STORAGE_KEYS.lastSyncAt,
    STORAGE_KEYS.error,
    STORAGE_KEYS.connected
  ]);

  return {
    events: data[STORAGE_KEYS.events] || [],
    lastSyncAt: data[STORAGE_KEYS.lastSyncAt] || null,
    error: data[STORAGE_KEYS.error] || null,
    connected: Boolean(data[STORAGE_KEYS.connected])
  };
}

async function refreshEvents(interactive) {
  const token = await getToken(interactive);
  const url = buildEventsUrl();

  let response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (response.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token });
    const freshToken = await getToken(false);
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${freshToken}`
      }
    });
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Calendar API failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  const events = (payload.items || [])
    .map(normalizeEvent)
    .filter(Boolean)
    .sort((a, b) => new Date(a.startIso) - new Date(b.startIso));

  await chrome.storage.local.set({
    [STORAGE_KEYS.events]: events,
    [STORAGE_KEYS.lastSyncAt]: new Date().toISOString(),
    [STORAGE_KEYS.error]: null,
    [STORAGE_KEYS.connected]: true
  });
}

async function getToken(interactive) {
  const result = await chrome.identity.getAuthToken({ interactive });
  const token = typeof result === 'string' ? result : result?.token;

  if (!token) {
    throw new Error('No OAuth token returned. Check manifest oauth2.client_id and Calendar scope.');
  }

  return token;
}

function buildEventsUrl() {
  const now = new Date();
  const future = new Date(now);
  future.setDate(now.getDate() + LOOKAHEAD_DAYS);

  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(MAX_RESULTS)
  });

  return `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`;
}

function normalizeEvent(event) {
  const startRaw = event?.start?.dateTime || event?.start?.date;
  const endRaw = event?.end?.dateTime || event?.end?.date;

  if (!startRaw || !endRaw) {
    return null;
  }

  const joinUrl = findMeetingUrl(event);
  const htmlLink = event.htmlLink || null;
  const startDate = new Date(startRaw);
  const endDate = new Date(endRaw);

  return {
    id: event.id,
    title: event.summary || 'Untitled event',
    description: event.description || '',
    location: event.location || '',
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
    joinUrl,
    eventUrl: htmlLink,
    isAllDay: Boolean(event?.start?.date && !event?.start?.dateTime)
  };
}

function findMeetingUrl(event) {
  const entryPoints = event?.conferenceData?.entryPoints || [];
  const videoEntry = entryPoints.find((entry) => entry.entryPointType === 'video' && entry.uri);
  if (videoEntry?.uri) {
    return videoEntry.uri;
  }

  if (event?.hangoutLink) {
    return event.hangoutLink;
  }

  const locationUrl = extractFirstUrl(event?.location || '');
  if (locationUrl) {
    return locationUrl;
  }

  const descriptionUrl = extractFirstUrl(event?.description || '');
  if (descriptionUrl) {
    return descriptionUrl;
  }

  return null;
}

function extractFirstUrl(text) {
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : null;
}