const STORAGE_KEYS = {
  events: 'events',
  lastSyncAt: 'lastSyncAt',
  error: 'error',
  connected: 'connected'
};

const ASSISTANT_STORAGE_KEYS = {
  projectId: 'assistant_vertex_project_id',
  model: 'assistant_vertex_model',
  contacts: 'assistant_contacts'
};

const REFRESH_ALARM = 'refresh-calendar-events';
const LOOKAHEAD_DAYS = 7;
const MAX_RESULTS = 100;
const VERTEX_API_URL = 'https://us-central1-aiplatform.googleapis.com/v1beta1/projects/{projectId}/locations/us-central1/publishers/google/models/{model}:generateContent';
const MAX_ASSISTANT_TURNS = 8;

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
    case 'assistantChat':
      return assistantChat(message);
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
  try {
    const result = await chrome.identity.getAuthToken({ interactive });
    const token = typeof result === 'string' ? result : result?.token;

    if (!token) {
      throw new Error('No OAuth token returned. Check manifest oauth2.client_id and Calendar scope.');
    }

    return token;
  } catch (error) {
    const message = String(error?.message || error || 'OAuth authentication failed');
    if (/OAuth2 not granted|revoked|consent|access_denied/i.test(message)) {
      throw new Error('Google Calendar permission is not granted or was revoked. Open the panel and click Connect to re-authorize.');
    }
    throw error;
  }
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

function normalizeContactKey(name) {
  return (name || '').trim().toLowerCase();
}

function resolveAttendeeEmails(attendees, contacts) {
  const list = Array.isArray(attendees) ? attendees : [];
  const resolved = [];
  const unresolved = [];

  for (const raw of list) {
    const value = String(raw || '').trim();
    if (!value) continue;

    if (value.includes('@')) {
      resolved.push(value);
      continue;
    }

    const key = normalizeContactKey(value);
    const email = contacts?.[key]?.email;
    if (email) {
      resolved.push(email);
    } else {
      unresolved.push(value);
    }
  }

  return {
    resolvedEmails: Array.from(new Set(resolved)),
    unresolvedNames: Array.from(new Set(unresolved))
  };
}

async function queryFreeBusy({ token, timeMin, timeMax, calendarIds }) {
  const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: (calendarIds || []).map((id) => ({ id }))
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Free/busy query failed: ${response.status} ${text}`);
  }

  return response.json();
}

function roundUpToStep(date, stepMinutes) {
  const stepMs = Math.max(1, stepMinutes) * 60_000;
  const time = date.getTime();
  const rounded = Math.ceil(time / stepMs) * stepMs;
  return new Date(rounded);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function mergeBusyIntervals(busyIntervals) {
  const intervals = (busyIntervals || [])
    .map((interval) => ({
      startMs: new Date(interval.start).getTime(),
      endMs: new Date(interval.end).getTime()
    }))
    .filter((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs))
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const merged = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (!last || interval.startMs > last.endMs) {
      merged.push({ ...interval });
      continue;
    }
    last.endMs = Math.max(last.endMs, interval.endMs);
  }

  return merged;
}

function isWithinWorkday(date, workdayStartMinutes, workdayEndMinutes, durationMinutes) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= workdayStartMinutes && minutes + durationMinutes <= workdayEndMinutes;
}

function formatSlotLabel(startDate, endDate) {
  const day = startDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const startTime = startDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const endTime = endDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${startTime} - ${endTime}`;
}

function computeSlotSuggestions({
  timeMinIso,
  timeMaxIso,
  mergedBusy,
  durationMinutes,
  stepMinutes,
  workdayStartHour,
  workdayEndHour,
  maxResults
}) {
  const startWindow = new Date(timeMinIso);
  const endWindow = new Date(timeMaxIso);
  if (!(startWindow instanceof Date) || Number.isNaN(startWindow.getTime())) {
    throw new Error('Invalid timeMin');
  }
  if (!(endWindow instanceof Date) || Number.isNaN(endWindow.getTime())) {
    throw new Error('Invalid timeMax');
  }
  if (endWindow <= startWindow) {
    throw new Error('timeMax must be after timeMin');
  }

  const duration = Math.max(5, Number(durationMinutes) || 30);
  const step = Math.max(5, Number(stepMinutes) || 30);
  const max = Math.max(1, Math.min(20, Number(maxResults) || 6));
  const startHourCandidate = Number(workdayStartHour);
  const endHourCandidate = Number(workdayEndHour);
  const startHour = Number.isFinite(startHourCandidate) ? startHourCandidate : 9;
  const endHour = Number.isFinite(endHourCandidate) ? endHourCandidate : 18;
  const workStart = Math.max(0, Math.min(23, startHour)) * 60;
  const workEnd = Math.max(1, Math.min(24, endHour)) * 60;

  const durationMs = duration * 60_000;
  let cursor = roundUpToStep(startWindow, step);

  const results = [];
  let busyIndex = 0;

  while (cursor.getTime() + durationMs <= endWindow.getTime() && results.length < max) {
    if (!isWithinWorkday(cursor, workStart, workEnd, duration)) {
      cursor = new Date(cursor.getTime() + step * 60_000);
      continue;
    }

    const slotStartMs = cursor.getTime();
    const slotEndMs = slotStartMs + durationMs;

    while (mergedBusy[busyIndex] && mergedBusy[busyIndex].endMs <= slotStartMs) {
      busyIndex += 1;
    }

    const maybeBusy = mergedBusy[busyIndex];
    const isBusy = maybeBusy ? overlaps(slotStartMs, slotEndMs, maybeBusy.startMs, maybeBusy.endMs) : false;
    if (!isBusy) {
      const start = new Date(slotStartMs);
      const end = new Date(slotEndMs);
      results.push({
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        label: formatSlotLabel(start, end)
      });
    }

    cursor = new Date(cursor.getTime() + step * 60_000);
  }

  return results;
}

async function calendarFindMeetingSlots(args) {
  const config = await getAssistantConfig();

  const durationMinutes = Number(args?.duration_minutes) || 30;
  const stepMinutes = Number(args?.step_minutes) || 30;
  const workdayStartHour = args?.workday_start_hour ?? 9;
  const workdayEndHour = args?.workday_end_hour ?? 18;
  const maxResults = Number(args?.max_results) || 6;

  const now = new Date();
  const timeMinIso = args?.start_iso || now.toISOString();
  const endDefault = new Date(now);
  endDefault.setDate(endDefault.getDate() + 7);
  const timeMaxIso = args?.end_iso || endDefault.toISOString();

  const { resolvedEmails, unresolvedNames } = resolveAttendeeEmails(args?.attendees, config.contacts);
  if (unresolvedNames.length) {
    return {
      ok: false,
      error: `Missing emails for: ${unresolvedNames.join(', ')}. Add them in Settings → Contacts, or provide emails directly.`
    };
  }

  const calendarIds = ['primary', ...resolvedEmails];
  const token = await getToken(true);
  const freeBusy = await queryFreeBusy({ token, timeMin: timeMinIso, timeMax: timeMaxIso, calendarIds });

  const calendars = freeBusy?.calendars || {};
  const busy = [];
  const warnings = [];

  for (const calendarId of calendarIds) {
    const entry = calendars[calendarId];
    const errors = entry?.errors || [];
    if (Array.isArray(errors) && errors.length) {
      warnings.push(`${calendarId}: ${errors.map((e) => e?.reason || 'no_access').join(', ')}`);
      continue;
    }
    for (const interval of entry?.busy || []) {
      busy.push(interval);
    }
  }

  const mergedBusy = mergeBusyIntervals(busy);
  const slots = computeSlotSuggestions({
    timeMinIso,
    timeMaxIso,
    mergedBusy,
    durationMinutes,
    stepMinutes,
    workdayStartHour,
    workdayEndHour,
    maxResults
  });

  return {
    ok: true,
    timeMinIso,
    timeMaxIso,
    durationMinutes,
    attendees: resolvedEmails,
    slots,
    warnings
  };
}

async function calendarCreateMeeting(args) {
  const config = await getAssistantConfig();

  const title = String(args?.title || '').trim();
  const description = String(args?.description || '').trim();
  const location = String(args?.location || '').trim();
  const startIso = String(args?.start_iso || '').trim();
  const endIso = String(args?.end_iso || '').trim();
  const addMeetLink = args?.add_meet_link !== false;

  if (!title) return { ok: false, error: 'Missing meeting title.' };
  if (!startIso || !endIso) return { ok: false, error: 'Missing meeting time range.' };

  const { resolvedEmails, unresolvedNames } = resolveAttendeeEmails(args?.attendees, config.contacts);
  if (unresolvedNames.length) {
    return {
      ok: false,
      error: `Missing emails for: ${unresolvedNames.join(', ')}. Add them in Settings → Contacts, or provide emails directly.`
    };
  }

  const startDate = new Date(startIso);
  const endDate = new Date(endIso);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    return { ok: false, error: 'Invalid start/end time.' };
  }

  const requestId = crypto?.randomUUID ? crypto.randomUUID() : `req_${Date.now()}`;

  const event = {
    summary: title,
    description,
    location: location || undefined,
    start: { dateTime: startDate.toISOString() },
    end: { dateTime: endDate.toISOString() },
    attendees: resolvedEmails.map((email) => ({ email }))
  };

  if (addMeetLink) {
    event.conferenceData = {
      createRequest: {
        requestId,
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    };
  }

  const token = await getToken(true);
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('sendUpdates', 'all');
  if (addMeetLink) {
    url.searchParams.set('conferenceDataVersion', '1');
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(event)
  });

  if (!response.ok) {
    const text = await response.text();
    return { ok: false, error: `Create event failed: ${response.status} ${text}` };
  }

  const created = await response.json();
  return {
    ok: true,
    eventId: created.id,
    htmlLink: created.htmlLink || null,
    hangoutLink: created.hangoutLink || null
  };
}

function buildAssistantInstructions() {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return [
    'You are a calendar scheduling assistant inside a Chrome side panel.',
    `Current time: ${now.toISOString()} (${timezone}).`,
    '',
    'Goal: Help the user find conflict-free meeting times and then create the meeting in Google Calendar with invites.',
    '',
    'Rules:',
    '- Ask for attendee emails if you only have names (you can store them with upsert_contact).',
    '- Use find_meeting_slots to propose a few options (3-6).',
    '- If find_meeting_slots returns warnings about calendar access, clearly tell the user you cannot guarantee those attendees are free.',
    '- Before calling create_meeting: restate the meeting title, attendees, and exact time range, and ask the user to confirm.',
    '- Keep messages short and actionable.'
  ].join('\n');
}

function buildAssistantTools() {
  return [
    {
      type: 'function',
      name: 'list_contacts',
      description: 'List saved contacts (name to email mappings).',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {}
      }
    },
    {
      type: 'function',
      name: 'upsert_contact',
      description: 'Save or update a contact mapping from name to email.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Person name, e.g. Alice' },
          email: { type: 'string', description: 'Email address, e.g. alice@example.com' }
        },
        required: ['name', 'email']
      }
    },
    {
      type: 'function',
      name: 'remove_contact',
      description: 'Remove a saved contact by name.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Person name to remove, e.g. Alice' }
        },
        required: ['name']
      }
    },
    {
      type: 'function',
      name: 'find_meeting_slots',
      description:
        'Find available time slots with no conflicts across the user calendar and the listed attendees (if accessible).',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          attendees: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of attendee names or emails.'
          },
          duration_minutes: { type: 'integer', minimum: 5, maximum: 480, description: 'Meeting duration in minutes.' },
          start_iso: { type: 'string', description: 'RFC3339/ISO time window start. Defaults to now.' },
          end_iso: { type: 'string', description: 'RFC3339/ISO time window end. Defaults to now + 7 days.' },
          workday_start_hour: { type: 'integer', minimum: 0, maximum: 23, description: 'Local workday start hour.' },
          workday_end_hour: { type: 'integer', minimum: 1, maximum: 24, description: 'Local workday end hour.' },
          step_minutes: { type: 'integer', minimum: 5, maximum: 120, description: 'Grid step size in minutes.' },
          max_results: { type: 'integer', minimum: 1, maximum: 20, description: 'Max number of suggestions.' }
        },
        required: ['attendees']
      }
    },
    {
      type: 'function',
      name: 'create_meeting',
      description: 'Create the meeting in the user primary calendar and send invites to attendees.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee names or emails.' },
          start_iso: { type: 'string', description: 'RFC3339/ISO meeting start time.' },
          end_iso: { type: 'string', description: 'RFC3339/ISO meeting end time.' },
          title: { type: 'string', description: 'Meeting title / summary.' },
          description: { type: 'string', description: 'Meeting description / agenda.' },
          location: { type: 'string', description: 'Optional meeting location.' },
          add_meet_link: { type: 'boolean', description: 'If true, add a Google Meet link.' }
        },
        required: ['attendees', 'start_iso', 'end_iso', 'title']
      }
    }
  ];
}

async function listContactsTool() {
  const config = await getAssistantConfig();
  const contacts = Object.values(config.contacts || {})
    .map((contact) => ({ name: contact?.name || '', email: contact?.email || '' }))
    .filter((contact) => contact.name && contact.email)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { ok: true, contacts };
}

async function upsertContactTool(args) {
  const name = String(args?.name || '').trim();
  const email = String(args?.email || '').trim();

  if (!name || !email) {
    return { ok: false, error: 'Name and email are required.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Invalid email format.' };
  }

  const config = await getAssistantConfig();
  const key = normalizeContactKey(name);
  const updated = { ...(config.contacts || {}) };
  updated[key] = { name, email };

  await chrome.storage.local.set({
    [ASSISTANT_STORAGE_KEYS.contacts]: updated
  });

  return { ok: true, contact: { name, email } };
}

async function removeContactTool(args) {
  const name = String(args?.name || '').trim();
  if (!name) return { ok: false, error: 'Name is required.' };

  const config = await getAssistantConfig();
  const key = normalizeContactKey(name);
  if (!config.contacts?.[key]) {
    return { ok: false, error: `No contact found for: ${name}` };
  }

  const updated = { ...(config.contacts || {}) };
  delete updated[key];
  await chrome.storage.local.set({
    [ASSISTANT_STORAGE_KEYS.contacts]: updated
  });

  return { ok: true };
}

async function assistantChat(message) {
  const config = await getAssistantConfig();
  const projectId = String(config.projectId || '').trim();
  
  if (!projectId) {
    throw new Error('Vertex AI Project ID not set. Open Assistant → Settings and add your Google Cloud Project ID.');
  }

  const model = String(config.model || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash';
  const rawMessages = Array.isArray(message?.messages) ? message.messages : [];
  const input = rawMessages
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
    .map((item) => ({ role: item.role, content: String(item.content || '') }))
    .filter((item) => item.content.trim().length > 0);

  const tools = buildAssistantTools();
  const instructions = buildAssistantInstructions();
  const toolHandlers = {
    list_contacts: async () => listContactsTool(),
    upsert_contact: async (args) => upsertContactTool(args),
    remove_contact: async (args) => removeContactTool(args),
    find_meeting_slots: async (args) => calendarFindMeetingSlots(args),
    create_meeting: async (args) => calendarCreateMeeting(args)
  };

  const result = await runVertexAIWithTools({
    projectId,
    model,
    instructions,
    tools,
    input,
    toolHandlers
  });

  if (!result.ok) {
    throw new Error(result.error || 'Assistant failed');
  }

  return { message: result.outputText };
}

async function getAssistantConfig() {
  const stored = await chrome.storage.local.get([
    ASSISTANT_STORAGE_KEYS.projectId,
    ASSISTANT_STORAGE_KEYS.model,
    ASSISTANT_STORAGE_KEYS.contacts
  ]);

  return {
    projectId: stored[ASSISTANT_STORAGE_KEYS.projectId] || '',
    model: stored[ASSISTANT_STORAGE_KEYS.model] || 'gemini-2.5-flash',
    contacts: stored[ASSISTANT_STORAGE_KEYS.contacts] || {}
  };
}

function buildVertexContents(messages) {
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    role: message.role === 'user' ? 'user' : 'model',
    parts: [{ text: String(message.content || '') }]
  }));
}

function extractTextFromVertexCandidate(candidateContent) {
  const parts = Array.isArray(candidateContent?.parts) ? candidateContent.parts : [];
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractFunctionCallsFromVertexCandidate(candidateContent) {
  const parts = Array.isArray(candidateContent?.parts) ? candidateContent.parts : [];
  return parts
    .filter((part) => part?.functionCall?.name)
    .map((part) => ({
      name: part.functionCall.name,
      args: part.functionCall.args || {}
    }));
}

async function createVertexAIResponse({ projectId, model, instructions, tools, contents }) {
  const token = await getToken(false);
  const url = VERTEX_API_URL.replace('{projectId}', projectId).replace('{model}', model);
  const functionDeclarations = (Array.isArray(tools) ? tools : []).map((tool) => {
    const declaration = {
      name: tool.name,
      description: tool.description
    };

    if (tool.parameters && Object.keys(tool.parameters).length) {
      declaration.parametersJsonSchema = tool.parameters;
    }

    return declaration;
  });

  const requestBody = {
    contents,
    system_instruction: {
      role: 'system',
      parts: [{ text: instructions }]
    },
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048
    }
  };

  if (functionDeclarations.length) {
    requestBody.tools = [{ functionDeclarations }];
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vertex AI API failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function runVertexAIWithTools({ projectId, model, instructions, tools, input, toolHandlers }) {
  const toolMap = toolHandlers || {};
  const contents = buildVertexContents(input);

  for (let turn = 0; turn < MAX_ASSISTANT_TURNS; turn += 1) {
    const response = await createVertexAIResponse({
      projectId,
      model,
      instructions,
      tools,
      contents
    });

    const candidate = response?.candidates?.[0];
    const candidateContent = candidate?.content;
    if (!candidateContent) {
      const message = response?.promptFeedback?.blockReason
        ? `Vertex blocked the response: ${response.promptFeedback.blockReason}`
        : 'Vertex returned no candidate content.';
      return { ok: false, error: message };
    }

    const functionCalls = extractFunctionCallsFromVertexCandidate(candidateContent);
    if (!functionCalls.length) {
      const text = extractTextFromVertexCandidate(candidateContent);
      return {
        ok: true,
        outputText: text.trim() || 'Done.',
        raw: response
      };
    }

    contents.push({
      role: candidateContent.role || 'model',
      parts: candidateContent.parts || []
    });

    const functionResponseParts = [];

    for (const call of functionCalls) {
      const handler = toolMap[call.name];
      if (typeof handler !== 'function') {
        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            response: {
              error: {
                message: `Unknown tool: ${call.name}`
              }
            }
          }
        });
        continue;
      }

      try {
        const result = await handler(call.args || {});
        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            response: {
              output: result ?? { ok: true }
            }
          }
        });
      } catch (error) {
        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            response: {
              error: {
                message: error?.message || 'Tool failed'
              }
            }
          }
        });
      }
    }

    contents.push({
      role: 'user',
      parts: functionResponseParts
    });
  }

  return { ok: false, error: 'Assistant exceeded max tool turns' };
}
