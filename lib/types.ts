/** Shapes shared by the API routes and the UI. */

export type BrowserInfo = {
  id: string;
  name: string;
  installed: boolean;
};

export type BrowsersResponse = {
  /** False when the server runs on an OS we can't detect browsers on yet. */
  supported: boolean;
  browsers: BrowserInfo[];
};

export type OpenResult = {
  id: string;
  name: string;
  ok: boolean;
  error?: string;
};

export type OpenResponse = {
  /** The URL that was actually opened, after normalisation. */
  url: string;
  results: OpenResult[];
};
