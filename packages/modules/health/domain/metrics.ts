export const METRIC_KINDS = [
  'weight',
  'bmi',
  'body-fat',
  'body-water',
  'muscle',
  'bone-mass',
  'basal-metabolism',
] as const

export type MetricKind = (typeof METRIC_KINDS)[number]

export const METRIC_UNITS: Record<MetricKind, string> = {
  weight: 'kg',
  bmi: 'kg/m2',
  'body-fat': '%',
  'body-water': '%',
  muscle: '%',
  'bone-mass': 'kg',
  'basal-metabolism': 'kcal',
}
