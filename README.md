# Calendar Companion

Calendar Companion is a Chrome Extension Manifest V3 side panel that connects to your Google Calendar, shows your meetings for today, and includes a Vertex AI powered scheduling assistant.

The extension is designed to help you:

- quickly review the rest of your day at a glance
- see upcoming meetings beyond today
- open or join calendar events directly from the side panel
- store a lightweight employee directory locally for name-to-email resolution
- ask an AI assistant to find conflict-free meeting slots and create meetings with invites

## What’s in this project

- `manifest.json` - Chrome extension configuration, permissions, OAuth setup, side panel entrypoint, and icons
- `service-worker.js` - background logic for authentication, Calendar API access, periodic refresh, and Vertex AI assistant tool calls
- `sidepanel.html` - the side panel UI structure
- `sidepanel.css` - the full visual design for the panel
- `sidepanel.js` - all front-end behavior, rendering, tab switching, and local UI state
- `icons/` - extension icons

## How it works

### Schedule tab

The Schedule tab is the main dashboard.

It:

- connects to your primary Google Calendar
- fetches events from the current time through the next 7 days
- separates meetings into “Today” and “More meetings ahead”
- shows a live clock and connection status
- updates meeting cards with readable time ranges, descriptions, locations, and links
- surfaces active meetings with a live indicator
- lets you open Google Calendar event pages or join links when available
- stores a simple per-event priority label locally in Chrome storage

### Assistant tab

The Assistant tab is a scheduling helper backed by Vertex AI.

It can:

- suggest time slots based on your calendar availability
- create Google Calendar meetings with attendees
- add Google Meet links
- resolve attendee names using a local employee directory
- let you save, update, remove, or bulk-import contacts in the side panel

The assistant uses Chrome storage to keep:

- the Google Cloud Project ID
- the chosen Vertex model
- the local contact directory
- UI-only priority labels for calendar events

## Architecture

### Background service worker

`service-worker.js` handles the extension’s privileged operations:

- initializes the side panel behavior
- refreshes calendar data on install, startup, and every minute via a Chrome alarm
- obtains OAuth tokens using `chrome.identity`
- calls the Google Calendar API
- normalizes Google Calendar event payloads into UI-friendly objects
- handles disconnect/reset behavior
- forwards assistant chat requests to Vertex AI
- exposes assistant tools for:
  - `list_contacts`
  - `upsert_contact`
  - `remove_contact`
  - `find_meeting_slots`
  - `create_meeting`

### Side panel UI

`sidepanel.html`, `sidepanel.css`, and `sidepanel.js` provide the user-facing experience:

- a polished calendar dashboard
- a second tab for the assistant
- local settings for Vertex project and model
- local employee directory management
- a chat interface with suggestion chips
- live refresh of countdowns, clocks, and visible event sections

## Setup

### 1. Create a Google Cloud project

Create or choose a Google Cloud project that you want this extension to use.

### 2. Enable required APIs

Enable:

- Google Calendar API
- Vertex AI API access for the assistant

### 3. Configure the OAuth consent screen

Set up the OAuth consent screen for the project.

For local development, keep the app in **Testing** unless you specifically need broader access.

### 4. Create a Chrome Extension OAuth client

Create an OAuth client configured for a Chrome extension.

The extension already has a client ID in `manifest.json`, but you should replace it with your own before distributing or publishing.

### 5. Confirm OAuth scopes

The manifest requests these scopes:

- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/cloud-platform`

If you change scopes in Google Cloud, make sure they stay in sync with `manifest.json`.

### 6. Update the manifest client ID

Open `manifest.json` and replace the existing `oauth2.client_id` with your own Chrome Extension OAuth client ID.

### 7. Load the extension unpacked

In Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder

### 8. Open the side panel

Click the extension icon in Chrome.

Chrome will open the side panel for the extension. The panel contains:

- **Schedule** for your calendar
- **Assistant** for scheduling help

### 9. Connect Google Calendar

In the Schedule tab:

1. Click **Connect**
2. Sign in with the Google account whose calendar you want to view
3. Approve the requested permissions

If you recently changed scopes, you may need to click **Disconnect** once and then **Connect** again so Chrome prompts for the updated consent.

## Using the extension

### Viewing your calendar

Once connected, the Schedule tab will:

- show today’s remaining meetings
- show additional upcoming meetings in pages of 4
- refresh automatically in the background every minute
- remove completed meetings from the visible list every 30 seconds

Each meeting card can include:

- time range
- day label
- title
- location
- description preview
- priority buttons: Low, Medium, High
- a **Join meeting** link if a meeting URL exists
- an **Open in Calendar** link if Google Calendar provides one

### Setting priorities

For any event card, you can click:

- **Low**
- **Medium**
- **High**

These labels are stored locally only. They do not change the event in Google Calendar.

### Using the assistant

Open the **Assistant** tab and click **Settings**.

There you can configure:

- **Google Cloud Project ID**
- **Model**  
  The code defaults to `gemini-2.5-flash` if you leave this blank.

Click **Save** after editing.

### Adding contacts

The assistant can resolve people by name if their email is stored in the local directory.

You can add contacts in two ways:

1. **Manual add**
   - Enter a name
   - Enter an email
   - Click **Add / Update**

2. **Bulk import**
   - Paste one contact per line in the format `name,email`
   - Click **Import directory**

Examples:

```text
Mohit,mohit@grid.company
Anika,anika@grid.company
Riya,riya@grid.company
```

You can remove stored contacts from the list below the import area.

### Asking for time slots

Use prompts like:

- `Find 30 minutes with Mohit and Priya tomorrow afternoon.`
- `Book a project sync with Anika, Riya, and me next week.`
- `Suggest the best slots for a design review with the frontend team this Friday, then wait for my confirmation before creating the invite.`

The assistant will:

- look for conflict-free openings
- return a few candidate slots
- warn you if it cannot fully verify attendee availability
- wait for confirmation before creating a meeting

### Creating a meeting

When you give the assistant a request that includes:

- attendees
- a time range
- a title

it can create the event in your primary calendar and send invites.

If you want a Google Meet link, the assistant can add one automatically unless you explicitly disable it.

## Assistant behavior and limitations

- The assistant only knows attendee emails if you add them locally or provide emails directly.
- Free/busy lookups for other attendees only work when your account has access to those calendars or shared visibility.
- If access is missing, the assistant can still suggest based on your own calendar, but it cannot guarantee attendee availability.
- The assistant stores its configuration in `chrome.storage.local`, not in a server database.
- For production use, the UI itself notes that model access should be moved behind a backend you control.

## Configuration details

### Storage keys used

The extension keeps the following data locally:

- connected calendar state
- cached events
- last sync timestamp
- last error message
- assistant Vertex project ID
- assistant Vertex model
- assistant contacts
- event priority labels

### Refresh behavior

- Calendar events are fetched when the extension connects
- The background worker refreshes data every minute
- The panel also updates its clock and visible countdowns every second

## File-by-file summary

### `manifest.json`

Defines:

- extension name and description
- permissions
- host permissions for Google APIs
- side panel entry path
- OAuth scopes and client ID
- extension icons

### `service-worker.js`

Handles:

- install/startup initialization
- side panel behavior
- OAuth token retrieval
- Calendar API fetches
- event normalization
- disconnect/reset actions
- Vertex AI chat and tool execution
- slot finding and meeting creation

### `sidepanel.html`

Defines:

- Schedule tab
- Assistant tab
- settings form
- contact directory
- prompt chips
- chat area
- calendar event lists

### `sidepanel.css`

Defines:

- the visual theme
- light/dark adaptation
- glassy cards and gradients
- responsive layout behavior
- tab styles, badges, pills, and event cards

### `sidepanel.js`

Handles:

- tab switching
- rendering events
- connection and refresh actions
- countdowns and live status text
- storing event priorities
- assistant settings
- contact add/update/remove/import
- chat message rendering
- assistant request submission

## Before publishing

Before you ship this extension publicly, make sure to:

- replace the OAuth client ID with your own
- use real branding icons
- add a privacy policy
- keep Google Calendar permissions as minimal as possible
- complete Google OAuth verification if required
- review whether Vertex AI access should stay client-side or move behind your own backend

## Notes

- Chrome side panels are opened by the extension action, but Chrome does not let an extension permanently force the panel open for every user interaction.
- Completed meetings are removed from the visible Schedule tab UI, but they are not deleted from Google Calendar.

If you want, I can also add a short “How to demo this extension” section or turn this README into a more polished product-style document with screenshots placeholders and usage examples.
