# Timesheet Side Panel Extension

This starter extension shows upcoming Google Calendar events in a Chrome side panel.

## Files

- `manifest.json` - extension config
- `service-worker.js` - auth, refresh, Calendar API calls, storage cache
- `sidepanel.html` - side panel layout
- `sidepanel.css` - styles
- `sidepanel.js` - UI rendering, countdown, auto-removal of completed events

## Setup steps

1. Create a Google Cloud project.
2. Enable Google Calendar API.
3. Configure OAuth consent screen.
4. Create a Chrome Extension OAuth client.
5. Paste the OAuth client ID into `manifest.json`.
6. Load the folder as an unpacked extension in `chrome://extensions`.
7. Pin the extension and click it once to open the side panel.
8. Click `Connect Google Calendar` inside the panel.

## Important notes

- The panel is opened from the extension icon. Chrome does not let the extension permanently force the side panel open for all users.
- Completed meetings are removed in the panel UI every 30 seconds.
- The background service worker refreshes cached events every minute.

## Before publishing

- Add your own real icons.
- Add a privacy policy.
- Use the minimum Calendar scopes possible.
- Complete OAuth verification if Google asks for it.
