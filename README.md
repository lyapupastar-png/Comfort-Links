# Comfort Links

A Firefox extension that replaces the new tab page with a grid of shortcuts
that you can group into folders by dragging one shortcut onto another, like
app icons on a phone.

## Features

- Shortcuts and folders on the new tab page, with several pages, free
  placement in any grid cell and a "Default view" button that restores the
  compact layout.
- Folders are created by dropping a shortcut onto another one; shortcuts
  can be dragged out of a folder again. An empty folder disappears.
- Smart folders "Recent" and "Most visited" that can be moved like any other
  folder and switched off in the settings.
- Site icons loaded automatically (optional, see [PRIVACY.md](PRIVACY.md)),
  with a letter on a colour as a fallback.
- Backgrounds: the Firefox new tab wallpaper catalog, your own image, or a
  plain colour.
- Shortcuts, folders and settings are synced through your Mozilla account
  (`storage.sync`) when you are signed in to Firefox.
- "Add page" and "Add link" items in the context menu.
- On the first run the shortcuts of the standard Firefox new tab page are
  imported.
- Interface in English, Russian and Ukrainian.

The manifest declares Firefox 140 as the minimum version (Firefox for
Android 142).

## Privacy

The extension has no server of its own and sends nothing to the developer.
See [PRIVACY.md](PRIVACY.md) for the few requests it makes when you allow
them.

## Building from source

Requirements: Node.js 20+ and npm.

```sh
npm ci
npm run lint    # web-ext lint
npm run pack    # builds release/comfort_links-<version>.xpi
```

The code in `src/` is loaded as is: nothing is transpiled or minified and
there are no runtime dependencies. To try it, open
`about:debugging#/runtime/this-firefox` in Firefox and choose "Load
Temporary Add-on…" with `src/manifest.json` or the `.xpi` from `release/`.

## Tests

```sh
npm run unit    # unit tests (node:test)
npm run e2e     # end-to-end tests in a temporary Firefox profile
npm test        # both
```

The end-to-end tests use Selenium and geckodriver; set `FIREFOX_BIN` if
Firefox is not in its default location. `HEADFUL=1` shows the browser
window.

## License

Copyright (C) 2026 SPYder4

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by the
Free Software Foundation, version 3. See [LICENSE](LICENSE).
