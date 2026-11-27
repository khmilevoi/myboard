/**
 * "3 года 2 мес · кошка · стерилизована": the parts that are there, joined by a middle dot; null
 * when none is. A missing field is left out, never drawn as "—".
 */
export function dotLine(parts: readonly (string | null)[]): string | null {
  const present = parts.filter((part): part is string => part !== null && part !== '')
  return present.length === 0 ? null : present.join(' · ')
}
