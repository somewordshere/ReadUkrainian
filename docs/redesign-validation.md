# Public redesign validation — 2026-09-18

Implemented a neutral, green-accented library and two-column reader. Public
pages load `public/css/public.css` after the original stylesheet. Every new rule
is scoped to `.public-page`; the admin page loads only the original stylesheet.
Existing content, APIs, storage keys, and level-expansion behaviour are retained.

**Product rule:** questions always stay to the right of the story, including
on phones. The reader has two columns with a 300px minimum for each. Narrow
screens scroll the reader horizontally; a hint and the existing quiz jump link
help reach the right column. Never add a breakpoint that stacks the questions.

## Automated checks

- `npm run check`: successful. 160 tests passed, zero failed, one optional live
  audio-provider contract test skipped. Existing editorial warnings remain.
- JavaScript syntax checks and `git diff --check`: successful.
- Calculated contrast: muted text on page background 5.54:1, green on white
  6.84:1, control borders on white 3.35:1 and on page background 3.11:1.

## Browser checks

Verified using the in-app browser and a local Worker, with current repository
migrations applied to an isolated `.wrangler/redesign-preview` database.

- Original library and reader checks covered 1440, 1024, 768, and 390px widths;
  3/3/2/1 library columns; 20px story text on desktop and 18px on phones.
  The later right-column correction supersedes the original single-column
  reader and its no-horizontal-scrolling requirement on narrow screens.
- Right-column correction verified at 1440, 1024, 768, and 390px: questions
  begin at the same vertical position as the story and remain to its right.
  Only the reader scrolls horizontally on phones; the page does not overflow.
  The keyboard quiz jump reveals the complete question panel and focuses its
  heading at 390px.
- At 1440×900, the first story row begins about 600px down the page, including
  the recommendation panel.
- Level expansion, combined search/topic/bookmark filters, empty-result state,
  reset and search focus passed.
- Keyboard quiz jump sets focus to the quiz heading. Answer targets are at
  least 44px tall. Wrong-answer feedback, a 4/5 completion, mistake review,
  next-story navigation, and restart passed.
- Completed answers and bookmarks survived reload. German translation preference
  survived reload. Existing saved completion states remained visible.
- English and German dictionary results for “мама” passed. The German popover
  fits within the 390px viewport. Pronunciation reached the browser's
  “Відтворення завершено.” state; both enabled and disabled controls were checked.
- Admin login inspected; stylesheet loading and original appearance retained.

## Limits and preview

Actual browser zoom could not be controlled through the available browser API.
Reflow was checked at 720×450, equivalent to the CSS viewport of a 1440×900
window at 200% zoom. Physical-phone behaviour, a complete screen-reader audit,
and the authenticated admin workflow were not tested in this pass.

The preview uses local fixture data. No production publication was performed.
To restart the prepared preview:

```sh
npm run dev -- --local --ip 127.0.0.1 --port 8788 --persist-to .wrangler/redesign-preview
```
