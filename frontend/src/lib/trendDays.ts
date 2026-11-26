/**
 * The trend endpoints return only the days that had activity. A chart gives every point the same
 * width, so add the quiet days (as zeros) between the first and last one to keep time to scale.
 */
export function fillDays<T extends { date: string }>(points: T[], zero: NoInfer<Omit<T, 'date'>>): T[] {
  if (points.length < 2) return points
  const byDate = new Map(points.map((p) => [p.date, p]))
  const dates = [...byDate.keys()].sort()
  const last = dates[dates.length - 1]
  const filled: T[] = []
  const day = new Date(`${dates[0]}T00:00:00Z`)
  for (let date = dates[0]; date <= last; date = day.toISOString().slice(0, 10)) {
    filled.push(byDate.get(date) ?? ({ ...zero, date } as T))
    day.setUTCDate(day.getUTCDate() + 1)
  }
  return filled
}
