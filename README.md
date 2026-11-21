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

## How it works

A web page can't start other apps, so the page asks the Node.js server to do it.

| File | What it does |
| --- | --- |
| `lib/browsers.ts` | The list of known browsers, finding which are installed, opening a URL in them, and reading their icons. |
| `lib/url.ts` | Turns typed text (`example.com`, `localhost:3000`) into a full `http(s)` URL and rejects anything else. |
| `lib/local-request.ts` | Refuses API calls that don't come from the launcher's own page. |
| `app/api/browsers` | `GET` the browsers and whether each is installed. `…/[id]/icon` serves the app's icon. |
| `app/api/open` | `POST { url, browsers }` to open the URL. Returns a result per browser. |
| `components/launcher.tsx` | The page: URL field, browser cards, results. |

## Add a browser

Add one line to `CATALOG` in `lib/browsers.ts` with the app's name as it
appears in `/Applications`.

## Limits

- **macOS only for now.** Browsers are found in `/Applications` and
  `~/Applications` and opened with the system `open` command.
- **Local only.** The server listens on `127.0.0.1`, and the API rejects
  requests from other sites or other hostnames, because it launches apps on
  the machine it runs on.
- Only `http://` and `https://` addresses are opened.
