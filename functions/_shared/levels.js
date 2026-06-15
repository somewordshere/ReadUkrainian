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
    id: "B1",
    description: "Середній рівень для довших і змістовніших текстів.",
    active: true,
  },
];

export const LEVELS_BY_ID = Object.fromEntries(
  LEVELS.map((level) => [level.id, level])
);
