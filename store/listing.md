# Chrome Web Store listing

## Store listing

**Name:** Gantt View for Linear

**Summary:** Adds a Gantt tab to Linear projects and lets you change issue due dates, status, and assignee from the chart.

**Category:** Workflow & Planning

**Language:** English

**Description:**

Gantt View for Linear adds a Gantt tab next to Overview and Issues in every Linear project.

- Each issue is a bar from the day work actually started to its due date.
- Issues that have not started show a marker on their due date.
- Each issue's labels are shown next to its title.
- Project milestones are shown at their target dates.
- Issues in progress without a due date are flagged at the top. Other issues without a due date are listed under Unscheduled, and finished issues under Completed.
- Change a due date by dragging the end of a bar or the marker, by picking a date, or by clearing it. Change an issue's status or assignee from its row. Changes are saved to Linear right away.
- If someone else changed an issue since the chart loaded, your edit is not saved over theirs.
- Group issues by parent issue or by assignee.
- Search, filter by assignee or status, switch between day, week, and month scales, and jump to today. The chart remembers your view.
- Follows Linear's light and dark themes and works with the keyboard.

Connect with your Linear account. The extension talks only to Linear and has no servers of its own.

**Screenshots:** `store/screenshot-week-dark.png`, `store/screenshot-day-light.png` (1280×800)

**Small promo tile:** `store/promo-small.png` (440×280)

**Icon:** `icons/icon-128.png`

## Support

**Support site:** https://github.com/janak2/linear-gantt-timeline/issues

**Homepage:** https://github.com/janak2/linear-gantt-timeline

## Privacy practices

**Single purpose:** Show a Linear project's issues on a Gantt chart inside Linear and let the user change their due dates, status, and assignee.

**Permission justifications:**

- `identity`: Signs the user in to Linear with OAuth (`chrome.identity.launchWebAuthFlow`).
- `storage`: Keeps the Linear sign-in tokens, the connected account's name and workspace, and the chart's view settings in extension storage.
- Host permission `https://api.linear.app/*`: Reads the project's issues and milestones and the statuses and members of their teams, saves due-date, status, and assignee changes, and exchanges, refreshes, and revokes OAuth tokens through Linear's API.
- Content script on `https://linear.app/*`: Adds the Gantt tab to Linear project pages and shows the chart in the project's content area.

**Remote code:** No. All code is included in the package.

**Data usage:**

- Personally identifiable information: yes (the connected user's name and the names of assignees and team members).
- Authentication information: yes (Linear OAuth tokens).
- Website content: yes (Linear issue titles, states, labels, and dates, and milestone names and target dates, for the open project).
- Health, financial, personal communications, location, web history, user activity: no.

Certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/janak2/linear-gantt-timeline/blob/main/docs/privacy.md

## Test instructions for reviewers

1. Sign in to a Linear workspace at https://linear.app (a free workspace works) and create a project with a few issues. Give some issues a due date and move one to In Progress.
2. Open the project. Click **Gantt** next to Overview and Issues.
3. Click **Connect Linear** and approve access.
4. Drag the right end of a bar, or pick a date in an issue's due-date field. Open the issue in Linear to see the new due date.
5. Pick a different status or assignee in an issue's row. Open the issue in Linear to see the change.
