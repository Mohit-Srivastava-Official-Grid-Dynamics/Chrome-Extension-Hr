# Calendar Companion Extension

This extension shows today's Google Calendar events in a Chrome side panel and includes a Vertex-powered scheduling assistant.

It also includes an optional **Scheduler assistant** tab that can suggest conflict-free meeting slots, create meetings with invites, and resolve names from a locally stored employee directory.

## Files

- `manifest.json` - extension config
- `service-worker.js` - auth, refresh, Calendar API calls, storage cache
- `sidepanel.html` - side panel layout
- `sidepanel.css` - styles
- `sidepanel.js` - UI rendering, countdown, auto-removal of completed events

## Setup steps

1. Create a Google Cloud project.
2. Enable Google Calendar API.
3. Configure OAuth consent screen (keep it in **Testing** for local/dev usage).
4. Create a Chrome Extension OAuth client.
5. Paste the OAuth client ID into `manifest.json`.
6. In OAuth consent screen → **Data access / Scopes**, add:
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
7. Load the folder as an unpacked extension in `chrome://extensions`.
8. Pin the extension and click it once to open the side panel.
9. Click `Connect` inside the panel (you may need to `Disconnect` once to force a re-consent after adding scopes).

### Assistant setup

1. Open the side panel → **Assistant** tab → **Settings**.
2. Enter your Google Cloud project ID and adjust the Vertex model if needed.
3. Click **Save**.
4. (Optional) Add employees one by one or bulk import `name,email` rows so you can say “book a meeting with Alice and Bob” without typing emails.

> Note: Free/busy checks for other attendees only work if you have access to their free/busy information (for example, shared calendars or Workspace domain defaults). Otherwise the assistant will warn that it can’t guarantee availability.

## Important notes

- The panel is opened from the extension icon. Chrome does not let the extension permanently force the side panel open for all users.
- Completed meetings are removed in the panel UI every 30 seconds.
- The background service worker refreshes cached events every minute.
- The assistant stores your selected Vertex project, model, employee directory, and UI-only meeting priorities in `chrome.storage.local`.

## Before publishing

- Add your own real icons.
- Add a privacy policy.
- Use the minimum Calendar scopes possible.
- Complete OAuth verification if Google asks for it.
