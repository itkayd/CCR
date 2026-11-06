// TfL mode ids → display names, in the order we list interchanges.
const MODES: [string, string][] = [
  ['elizabeth-line', 'Elizabeth line'],
  ['tube', 'Tube'],
  ['overground', 'Overground'],
  ['dlr', 'DLR'],
  ['national-rail', 'National Rail'],
  ['international-rail', 'International'],
  ['tram', 'Tram'],
  ['cable-car', 'Cable car'],
];
const ORDER = new Map(MODES.map(([id], i) => [id, i]));
const LABEL = new Map(MODES);

export function modeLabels(ids: string[] = []): string[] {
  return [...ids]
    .sort((a, b) => (ORDER.get(a) ?? 99) - (ORDER.get(b) ?? 99))
    .map((id) => LABEL.get(id) ?? id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));
}

/** "Elizabeth line · Tube · Overground · DLR · National Rail" */
export const formatModes = (ids: string[] = []) => modeLabels(ids).join(' · ');
