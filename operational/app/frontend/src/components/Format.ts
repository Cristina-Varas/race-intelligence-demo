export const signedSeconds = (value: number | null, digits = 2): string => {
  if (value === null) return 'N/A'
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)} s`
}

export const probability = (value: number): string => `${(value * 100).toFixed(2)}%`

export const pace = (value: number): string => `${value.toFixed(3)} s/lap`

export const delayInterpretation = (delay: number): string => {
  if (delay > 0) return `Virtual Max starts ${delay.toFixed(1)} seconds later`
  if (delay < 0) return `Virtual Max requires ${Math.abs(delay).toFixed(1)} seconds head start`
  return 'Same starting time'
}
