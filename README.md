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

Turn on **Also open in incognito** to get a second, private window in each
browser as well as the normal one.

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
| `app/api/close` | `POST { windows }` with the handles from `/api/open` to close those windows. |
| `components/launcher.tsx` | The page: URL field, browser cards, results. |

## Add a browser

Add an entry to `CATALOG` in `lib/browsers.ts` with the app's name as it
appears in `/Applications`. Give it a `privateFlag` only if you have checked
that the browser honours it: one that ignores the switch would open the page in
a normal window while the launcher reports it as private.

## Limits

- **macOS only for now.** Browsers are found in `/Applications` and
  `~/Applications` and opened with the system `open` command.
- **Local only.** The server listens on `127.0.0.1`, and the API rejects
  requests from other sites or other hostnames, because it launches apps on
  the machine it runs on.
- Only `http://` and `https://` addresses are opened.
- **Each page gets its own window**, not a tab in a window you already had,
  so that closing it can't take anything of yours with it.
- **Closing depends on the browser too.** Chrome, Brave, Edge, Opera, Safari
  and Firefox are supported. Firefox can't say what a window contains, so the
  launcher recognises its window as the one that appeared right after it
  asked; if several appear at once (Firefox restoring a session as it starts)
  it leaves them all alone and tells you.
- **Private windows depend on the browser.** Chrome, Brave, Firefox, Opera and
  Edge have a command-line switch for one. Safari doesn't, so it only ever
  gets a normal window.
