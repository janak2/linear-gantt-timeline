# Gantt View for Linear

A Chrome extension that adds a **Gantt** tab to every Linear project. Bars run from an issue's actual start (`startedAt`) to its due date, and due dates can be changed from the chart.

- Bars from actual start to due date; a due-date marker for issues that have not started; issues without a due date under **Unscheduled**.
- Change a due date by dragging the bar's right edge or the marker, with the date picker, or by clearing it. Only `dueDate` is written, and an edit is refused if someone else changed the due date since the chart loaded.
- Search, assignee and status filters, day/week/month scales, Today, and links to each issue.
- Sign-in with Linear OAuth (authorization code with PKCE, no client secret).

Planned start dates are not editable: Linear's API has no planned-start field for issues.

## Set up the Linear OAuth application

1. In Linear, go to **Settings → API → OAuth applications** and create an application named **Gantt View** with public distribution.
2. Add the development callback URL: `https://ejcenkoklniinapjjgllepiedoajnali.chromiumapp.org/linear`. This ID comes from the public `key` in `manifest.json`.
3. Put the application's client ID in `src/config.js` (`LINEAR_CLIENT_ID`). The client ID is public; no secret is used.

## Try it locally

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select this folder.
2. Open a project at `https://linear.app`, click **Gantt**, then **Connect Linear**.
3. While the chart is open the address is `https://linear.app/<workspace>/project/<slug>/gantt`; open, reload, or bookmark it to go straight to the chart.

Reload the extension and the Linear tab after editing code.

## How it works

- `src/content.js` loads `src/page/adapter.js`, the only code that depends on Linear's page structure. It finds the project's tabs (links to sibling views of the same project), adds the Gantt tab, and shows the chart in an extension-origin iframe over the project's content area, leaving Linear's sidebar and header usable. It removes the chart when you leave the project.
- `panel.html` and `src/panel.js` draw the chart. They talk to the background worker through validated messages.
- `src/background.js` owns sign-in and every API request. `src/auth.js` runs the OAuth flow and token refresh; `src/linear.js` holds the GraphQL queries.
- The access token is kept in session storage. The rotating refresh token is kept in local storage restricted to trusted extension contexts, so sign-in survives a browser restart. Tokens never reach Linear's page.
- The chart only loads a project that matches both the URL and the connected workspace; otherwise it shows why it cannot.

## Develop

Node.js 22 or newer.

```sh
npm install
npx playwright install chromium
npm run check          # manifest resources and script syntax
npm test               # unit tests
npm run test:browser   # Chromium tests against a stand-in Linear page and API
```

`npm run icons` renders `icons/icon.svg`. `npm run screenshots` captures store images into `store/`.

## Release

1. Set `LINEAR_CLIENT_ID`, increase `version` in `manifest.json`, and run `npm run package`. This writes `dist/gantt-view-for-linear-<version>.zip` with `manifest.json` at its root and the development `key` removed.
2. Upload the ZIP to the Chrome Web Store dashboard. On the first upload, copy the item's public key into `manifest.json` `key` so local builds use the production ID, and add `https://<production-id>.chromiumapp.org/linear` to the Linear OAuth application's callback URLs.
3. Use `store/listing.md` for the listing, privacy fields, and reviewer instructions. The privacy policy is `docs/privacy.md`.
