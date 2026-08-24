export const LEVELS = [
  {
    id: "A1",
    description: "Початковий рівень для коротких і простих текстів.",
    active: true,
  },
  {
    id: "A2",
    description: "Базовий рівень для ширшого словникового запасу.",
    active: true,
  },
  {
    // Hidden until B1 has real content: all 15 rows currently hold the same
    // placeholder paragraph and there are no questions for the level.
    id: "B1",
    description: "Середній рівень для довших і змістовніших текстів.",
    active: false,
  },
];

export const LEVELS_BY_ID = Object.fromEntries(
  LEVELS.map((level) => [level.id, level])
);
