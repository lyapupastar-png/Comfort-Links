# Comfort Links Privacy Policy

**Last updated:** October 2026

## Data collection

Comfort Links does **not** collect, store remotely or transmit any personal
data to the developer. There is no analytics, telemetry, tracking or user
account.

## What stays on your computer

- **Shortcuts, folders and settings** are kept in the extension's local
  storage.
- **Cached site icons and downloaded wallpapers** are kept in the
  extension's local database (IndexedDB) so that they are not downloaded
  again.
- **A background image you upload** stays on your computer and is not
  synced.

## Sync

If you are signed in to Firefox with a Mozilla account, shortcuts, folders
and settings are also written to `storage.sync`, which Firefox syncs through
your Mozilla account. This is handled by Firefox, not by the extension;
nothing is sent to the developer.

## Network requests

The extension makes the following requests, and only after you have allowed
access to these sites in Firefox:

- **Site icons.** The host name of a shortcut (for example `example.com`) is
  sent to Google's favicon service
  (`www.google.com/s2/favicons`) and, if it has no icon, to DuckDuckGo's
  icon service (`icons.duckduckgo.com`). This can be switched off in the
  settings; icons then become a letter on a colour.
- **Backgrounds.** The wallpaper catalog and wallpaper images are downloaded
  from Mozilla servers (`firefox.settings.services.mozilla.com` and
  `firefox-settings-attachments.cdn.mozilla.net`) when you open the
  background picker or select a wallpaper.

No other requests are made.

## Permissions

- **Storage** — to keep shortcuts, folders and settings.
- **Top sites** — to import the shortcuts of the standard Firefox new tab
  page on the first run and to fill the "Most visited" folder.
- **History (optional)** — requested only when you turn on the "Recent"
  folder; the history is read locally to list recently visited sites.
- **Context menus** — the "Add page" and "Add link" items.
- **Active tab** — to read the address and title of the page you add from
  the context menu.
- **Access to the icon and wallpaper sites listed above** — for the
  requests described in "Network requests".

## Contact

Questions and issues: https://github.com/lyapupastar-png/Comfort-Links
