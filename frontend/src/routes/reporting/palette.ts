// Validated default categorical palette from the dataviz skill
// (references/palette.md) — fixed slot order is the CVD-safety mechanism,
// never cycled or reassigned. Light/dark pair per slot.
export const CATEGORICAL_LIGHT = [
  '#2a78d6', // 1 blue
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#6250d6', // 7 violet
  '#e34948', // 8 red
]

export const CATEGORICAL_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
]

export const SEQUENTIAL_BLUE_LIGHT = '#2a78d6'

export function categoricalColor(index: number, isDark: boolean): string {
  const ramp = isDark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT
  return ramp[index % ramp.length]
}

export function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}
