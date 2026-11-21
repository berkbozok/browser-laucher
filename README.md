# Browser Launcher

Open one URL in every browser you pick, all at once. Built with Next.js,
TypeScript, Node.js and Tailwind CSS.

## Run it

```bash
npm install
npm run dev
```

Then open <http://127.0.0.1:3000>. Type a URL, tick the browsers, press
**Open**. Your last URL and selection are remembered.

Turn on **Also open in incognito** to get a second, private window as well as
the normal one, in every browser that can do it (see the table under Limits).

After you press Open, an **Open windows** list appears: one line per browser,
its normal window on the left and its incognito window on the right. Each box
is a live picture of that window, retaken every couple of seconds, with the
page's title and address underneath (Firefox only gives the title). So you
can watch all of them from one place, even the ones hidden behind other
windows. Click a box to bring that window to the front. A window you close
yourself drops off the list.

Live pictures need macOS's **Screen Recording** permission for the app that
runs the server: System Settings → Privacy & Security → Screen & System Audio
Recording. macOS asks you to quit and reopen that app afterwards. Without it
the boxes show the title and address only, and the page tells you what to
switch on.

**Close** shuts the windows the launcher opened, and only those, in the
browsers that are ticked at that moment. Untick a browser first to keep its
windows open. Windows you opened yourself are never touched.

The first time, macOS asks whether the app running the server (Terminal,
Cursor, …) may control each browser. Allow it: that is how the launcher finds
its own windows again. You can change the answer later under System Settings →
Privacy & Security → Automation. Without it pages still open, but Close can't
reach them.

## How it works

A web page can't start other apps, so the page asks the Node.js server to do it.

| File | What it does |
| --- | --- |
| `lib/browsers.ts` | The list of known browsers, finding which are installed, opening a URL in them, and reading their icons. |
| `lib/window-control.ts` | Opens each page in a window of its own through macOS scripting and hands back a handle for it, and closes windows by handle. |
| `lib/url.ts` | Turns typed text (`example.com`, `localhost:3000`) into a full `http(s)` URL and rejects anything else. |
| `lib/local-request.ts` | Refuses API calls that don't come from the launcher's own page. |
| `app/api/browsers` | `GET` the browsers and whether each is installed. `…/[id]/icon` serves the app's icon. |
| `app/api/open` | `POST { url, browsers, includePrivate? }` to open the URL. Returns a result per browser, including how its private window went. |
| `app/api/windows` | `GET` the launcher's open windows and what each is showing right now. |
| `app/api/preview/[key]` | `GET` a picture of one of those windows. |
| `app/api/focus` | `POST { key }` to bring one of them to the front. |
| `app/api/close` | `POST { browsers }` to close the launcher's windows in those browsers. |
| `lib/window-registry.ts` | The server's list of the windows it opened, kept in a small file so it survives reloads. |
| `lib/preview.ts` | Takes the pictures. |
| `lib/api-request.ts` | The checks every POST route starts with. |
| `components/open-windows.tsx` | The Open windows list. |
| `components/launcher.tsx` | The page: URL field, browser cards, results. |

## Add a browser

Add an entry to `CATALOG` in `lib/browsers.ts` with the app's name as it
appears in `/Applications`. Give it a `privateFlag` only if you have checked
that the browser honours it: one that ignores the switch would open the page in
a normal window while the launcher reports it as private.

## Limits

- **macOS only for now.** Browsers are found in `/Applications` and
  `~/Applications`, and driven through macOS scripting where they allow it.
- **Local only.** Start it with `npm run dev` or `npm start`: those make the
  server listen on `127.0.0.1` alone. The API also rejects requests from
  other sites or other hostnames, because it launches apps on the machine it
  runs on. Don't run it on an address other machines can reach.
- Only `http://` and `https://` addresses are opened.
- **What each browser can do**

  | Browser | Normal window | Incognito window | Close |
  | --- | --- | --- | --- |
  | Chrome, Brave, Edge, Opera, Vivaldi | yes | yes | yes |
  | Firefox, Zen | yes | yes | yes |
  | Safari | yes | yes, after a one-time setup | yes |
  | DuckDuckGo, Orion, Arc, Tor Browser | yes | no | by hand |

- **Where Close works, each page gets its own window**, not a tab in a window
  you already had, so that closing it can't take anything of yours with it.
  The browsers in the last row just get the page handed to them and put it
  wherever they like. DuckDuckGo, for one, switches to a tab that already
  shows that address instead of loading it again.
- **Safari's incognito window needs one more permission.** Safari has no
  command for a private window, so the launcher presses Safari's own
  *File → New Private Window* for you. For that, turn on the app running the
  server under System Settings → Privacy & Security → Accessibility, and click
  Allow when macOS asks about "System Events". Until then Safari opens its
  normal window only; the page shows a reminder while Safari is ticked.
- **Firefox and Zen can't say what a window contains**, so the launcher
  recognises its window as the one that appeared right after it asked. If
  Firefox isn't running, it is started first and given time to bring back
  whatever it wants (a home page, your last session); only then does the
  launcher add its own window. If it still can't tell which window is its
  own, it leaves them all alone and says so.
- **The server remembers which windows it opened**, in a small file in the
  system's temporary folder. The page only shows that list, so a reload, a
  second tab or a reply that went missing doesn't lose track of anything.
  Only those windows can be shown, pictured or closed through the API.
