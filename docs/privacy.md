# Privacy policy: Gantt View for Linear

Effective October 27, 2026.

Gantt View for Linear is a Chrome extension that adds a Gantt chart to Linear projects. This policy explains what data it handles.

## Data the extension uses

- **Your Linear account summary:** your name, user ID, and workspace name, ID, and URL key. Used to show which account is connected and to make sure the chart only loads projects from that workspace.
- **Linear sign-in tokens:** the OAuth access token and refresh token Linear issues when you click **Connect Linear**. Used to call Linear's API on your behalf.
- **Issue data for the project you open:** issue identifiers, titles, links, workflow states, assignee names, actual start dates, completion dates, and due dates, each issue's team ID and parent issue identifier, title, and link, plus the project's milestone names and target dates. Used to draw the chart.
- **Teams of those issues:** for each team with issues in the project, its workflow states (names, types, and colors) and the names and user IDs of its active members. Used to list the statuses and assignees you can pick for an issue.

## Where the data is kept

- The access token is kept in Chrome's extension session storage and is cleared when Chrome closes.
- The refresh token and account summary are kept in Chrome's extension local storage, restricted to the extension's own pages and background worker, so that you stay signed in after restarting Chrome.
- Chart view settings are kept in the same local storage so the chart looks the same next time: the time scale, collapsed groups (an assignee group is kept by the assignee's user ID), and grouping (none, by parent, or by assignee), and for each project (by project ID) the search text and assignee and status filters. Disconnecting does not remove them; uninstalling the extension does.
- Issue and team data is held in memory only while a chart is open.
- Tokens are never given to Linear's web page or to any website.

## Where the data is sent

The extension communicates only with Linear: `linear.app` for sign-in and `api.linear.app` for the API. It has no servers of its own and sends nothing to the developer or any third party. It contains no analytics, advertising, or tracking, and it does not sell or share data.

## Changes the extension makes in Linear

The extension changes an issue's due date, status, or assignee only when you do so in the chart: the due date by dragging, picking a date, or clearing it, and the status or assignee by picking one in the issue's row. It changes no other issue field.

## Removing your data

Click **Disconnect** on the extension's options page to delete the stored tokens and account summary and revoke the tokens with Linear. Uninstalling the extension deletes all of its stored data. You can also revoke access from Linear's settings at any time.

## Contact

Questions or requests: [github.com/janak2/linear-gantt-timeline/issues](https://github.com/janak2/linear-gantt-timeline/issues).
