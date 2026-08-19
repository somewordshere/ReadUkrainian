# Read Ukrainian

[Read Ukrainian](https://readukrainianapp.com) is a reading-practice website for learners who want to build confidence with Ukrainian through short stories, pronunciation support, and comprehension quizzes.

## How the website works

Readers choose a story from the library at A1, A2, or B1 level. They can search and filter the collection, read a story, and complete a short multiple-choice quiz. Quiz results, completed stories, and bookmarks are saved in the browser, so readers can return later and continue where they stopped.

Stories and questions are loaded from the website's content database. A bundled copy of the learning content acts as a fallback if the content service is temporarily unavailable, keeping the core reading experience reliable.

On a story page, readers can select one Ukrainian word to see an English or German translation and Ukrainian grammar. They can also choose **Прослухати** to hear its pronunciation when audio is enabled. Dictionary lookups and generated audio are handled by the server.

## Website features

- Ukrainian stories organized by A1, A2, and B1 level
- Search and filters for level, topic, bookmarks, and reading progress
- Story word counts and a focused reading layout
- Multiple-choice comprehension quizzes with immediate feedback
- Saved quiz results and completed-story status
- Options to restart a story or continue to the next one
- Bookmarks and a continue-reading experience
- One-word Ukrainian pronunciation with clear AI-voice disclosure
- Server-side, one-word Ukrainian → English and Ukrainian → German dictionaries
- Responsive layouts for desktop and mobile devices
- Keyboard-friendly controls, visible focus states, accessible quiz choices, and reduced-motion support
- Resilient fallback content when live content cannot be loaded

## Content management

The website includes a private publishing workspace for the content team. Depending on their role, team members can:

- create and edit story drafts
- add, reorder, duplicate, and remove quiz questions
- preview unpublished changes
- publish or unpublish stories
- review and restore previous revisions
- choose the pronunciation voice used across the website
- review dictionary suggestions and check dictionary coverage before publishing

Drafts remain private until a publisher explicitly releases them, keeping work in progress separate from the public story library.

## Dictionary data

Ukrainian morphology and the primary translations come from Wiktionary data distributed by Kaikki.org. The German dictionary is supplemented with the Creative Commons Attribution-licensed [Linguisto German–Ukrainian dictionary](https://sourceforge.net/projects/linguisto/), release 2018-04-12.

The Linguisto build deliberately accepts only exact, single-word Ukrainian equivalents whose part of speech matches one unambiguous installed lexeme. This avoids automatically publishing phrases and uncertain reverse-dictionary matches. Rebuild the generated D1 seed from an official XDXF download with:

```sh
npm run dictionary:build:linguisto -- --source PATH_TO_XDXF --revision 2018-04-12
```
