# Project Handover

Generated: 2026-06-06

## Workspace

Static Ukrainian reading web app for language learners.

Workspace:
`C:\Users\User\Documents\Codex\2026-05-27\make-an-web-app-for-a`

Main A2 file:
`C:\Users\User\Documents\Codex\2026-05-27\make-an-web-app-for-a\a2-stories.js`

Optimized topic source:
`C:\Users\User\Desktop\German\optimized-ukrainian-story-topics.md`

Current site version:
`0.60` in `version.js`

## Current State

- `a2-stories.js` contains 103 A2 story objects.
- Topics 1-50 are filled and audited.
- Topics 51-103 are intentionally empty with `paragraphs: []`.
- Continue generation at topic 51: `Традиція Івана Купала`.
- Do not regenerate or heavily revise topics 1-50 unless the user explicitly asks.
- Current git status before this handover: `a2-stories.js` modified, `HANDOVER.md` untracked.
- Do not push to git unless the user explicitly asks.

`node --check .\a2-stories.js` passed earlier after topics 1-50 were completed. A later retry in this sandbox returned `Access is denied` for `node.exe`, so use another available Node runtime if needed.

## User Rules For A2 Stories

- Write stories in Ukrainian only.
- Keep the original topic number and Ukrainian title.
- In `a2-stories.js`, add only story paragraphs. Do not add questions, answers, vocabulary, translations, explanations, metadata, or source notes.
- CEFR A2 level: simple, natural Ukrainian; mostly short sentences; common vocabulary; friendly and realistic, not childish.
- Grammar and cases must be correct. Previous chats made many mistakes, so validation matters.
- Word count is important. Aim for the higher side of the requested range, not the lower side.
- If a normal topic target is about 110 words, aim around 110-125 unless the topic says otherwise.
- Follow the required paragraph count exactly.
- Dialogue topics should be stored as one paragraph in the data file unless the dialogue covers clearly different time periods.
- If narrator gender is unspecified: odd topic number = boy/man narrator, even topic number = girl/woman narrator.
- Use natural Ukrainian forms for names and places, including foreign places. Example: use `Варшава`, not `Warsaw`.
- Avoid reusing the same sentence structure or repeated phrasing across stories.
- Use current Ukrainian calendar dates. For Christmas, use 25 December and mention the change from 7 January only when useful.
- Sensitive topics must be respectful, non-graphic, and not politically argumentative or emotionally excessive.
- For topics with parades or fireworks, use 180-220 words and explain life or celebration before 2022 and after the Russian full-scale invasion. The reader should understand the country before and after 2022. This has already been applied to topics 16 and 46.

## Token-Saving Workflow

The user asked why token usage was high. Future chats should keep output compact.

- Prefer editing `a2-stories.js` directly instead of printing full stories in chat, unless the user asks to see the text.
- Read only the next needed topic specs from `optimized-ukrainian-story-topics.md`.
- Generate one batch, patch the file, then run a compact audit.
- In the final response, report only topic numbers, word counts, paragraph counts, and any issues.
- Avoid repeating the whole prompt, full audit table, or full generated story text unless needed.
- If the user asks to continue without a batch size, 5 topics preserves the previous workflow. If the user wants lower token usage, suggest 10 topics per batch.


## Completed A2 Audit

Topics 1-50 currently have these counts:

1. `Мій день`: 118 words, 3 paragraphs
2. `Моя сім'я`: 115 words, 3 paragraphs
3. `Мій будинок`: 114 words, 3 paragraphs
4. `У школі`: 117 words, 3 paragraphs
5. `Мій друг`: 114 words, 3 paragraphs
6. `У магазині`: 111 words, 1 paragraph
7. `Мій улюблений спорт`: 119 words, 3 paragraphs
8. `Погода сьогодні`: 113 words, 2 paragraphs
9. `Що я їм на сніданок`: 107 words, 3 paragraphs
10. `Мої домашні тварини`: 116 words, 3 paragraphs
11. `Маршрутка або автобус`: 113 words, 3 paragraphs
12. `У лікаря`: 111 words, 1 paragraph
13. `Мій вільний час`: 110 words, 3 paragraphs
14. `Дні тижня`: 120 words, 4 paragraphs
15. `День пам'яті жертв Чорнобиля`: 126 words, 3 paragraphs
16. `Новий рік`: 181 words, 3 paragraphs
17. `День Соборності України`: 127 words, 3 paragraphs
18. `Різдво Христове`: 126 words, 3 paragraphs
19. `День Героїв Небесної Сотні`: 130 words, 3 paragraphs
20. `Міжнародний жіночий день`: 112 words, 3 paragraphs
21. `Вишиванка — мій одяг`: 111 words, 3 paragraphs
22. `Борщ — улюблена страва`: 110 words, 3 paragraphs
23. `Великдень`: 120 words, 3 paragraphs
24. `Вареники на обід`: 116 words, 3 paragraphs
25. `Хліб та сіль`: 115 words, 3 paragraphs
26. `Моя вулиця`: 112 words, 3 paragraphs
27. `Перший дзвоник — День знань`: 132 words, 4 paragraphs
28. `Покупки на ринку`: 111 words, 3 paragraphs
29. `Я допомагаю вдома`: 110 words, 3 paragraphs
30. `День матері`: 115 words, 3 paragraphs
31. `День вишиванки`: 128 words, 4 paragraphs
32. `У кафе`: 108 words, 3 paragraphs
33. `Моя улюблена їжа`: 114 words, 3 paragraphs
34. `Зима в Україні`: 112 words, 2 paragraphs
35. `Писанка — мистецтво розпису яєць`: 133 words, 3 paragraphs
36. `Числа і гроші`: 107 words, 3 paragraphs
37. `Моя мама`: 114 words, 3 paragraphs
38. `Пісня на уроці`: 112 words, 3 paragraphs
39. `Тварини на фермі`: 114 words, 3 paragraphs
40. `Хто де живе`: 122 words, 3 paragraphs
41. `День Конституції України`: 123 words, 3 paragraphs
42. `Дорога до школи`: 106 words, 3 paragraphs
43. `Мій день народження`: 115 words, 3 paragraphs
44. `Ранок у сім'ї`: 110 words, 3 paragraphs
45. `Річка Дніпро`: 115 words, 2 paragraphs
46. `День Незалежності України`: 184 words, 3 paragraphs
47. `Відпочинок в Одесі та на Чорному морі`: 135 words, 3 paragraphs
48. `День захисників і захисниць`: 121 words, 3 paragraphs
49. `День Гідності та Свободи`: 126 words, 3 paragraphs
50. `День пам'яті жертв Голодомору`: 132 words, 3 paragraphs

## Useful Audit Command

Use this PowerShell pattern to count words and paragraphs consistently:

```powershell
$text = [System.IO.File]::ReadAllText((Resolve-Path '.\a2-stories.js'), [System.Text.Encoding]::UTF8)
$pattern = '(?s)\{\s*title:\s*"([^"]+)",\s*showWordCount:\s*true,\s*paragraphs:\s*\[(.*?)\]\s*\}'
$blocks = [regex]::Matches($text, $pattern)
$paraPattern = '"((?:[^"\\]|\\.)*)"'
$wordRe = [regex]"[\p{L}\p{N}'’ʼ-]+"
for ($i = 0; $i -lt $blocks.Count; $i++) {
  $title = $blocks[$i].Groups[1].Value
  $paragraphMatches = [regex]::Matches($blocks[$i].Groups[2].Value, $paraPattern)
  $paragraphs = @($paragraphMatches | ForEach-Object { $_.Groups[1].Value })
  $count = $wordRe.Matches(($paragraphs -join ' ')).Count
  Write-Output (($i + 1).ToString() + '. ' + $title + ': ' + $count + ' words, ' + $paragraphs.Count + ' paragraphs')
}
```
