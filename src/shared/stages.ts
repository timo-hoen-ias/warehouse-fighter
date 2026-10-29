// Arenen-Liste (geteilt zwischen Client und Server). Der Aufbau in three.js steckt in client/stage.ts.

export interface StageInfo {
  id: string;
  name: string;
  subtitle: string;
  /** Vorschaufarben für die Auswahlkarte */
  colors: [string, string];
}

export const STAGES: StageInfo[] = [
  { id: 'wareneingang', name: 'Lager 3 · Wareneingang', subtitle: 'Hochregale, Rolltore, ein müder Stapler', colors: ['#1565c0', '#ff6f00'] },
  { id: 'kuehlhaus', name: 'Kühlhaus −24 °C', subtitle: 'Frost, Nebel und Schneegestöber', colors: ['#b3e5fc', '#ffffff'] },
  { id: 'laderampe', name: 'Laderampe · Nachtschicht', subtitle: 'Natriumlicht und offene Auflieger', colors: ['#0a0e1a', '#ff9800'] },
  { id: 'hochregal', name: 'Automatisches Hochregallager', subtitle: '30 Meter Stahl, Shuttles im Dauerbetrieb', colors: ['#0d1b2a', '#00e5ff'] },
  { id: 'packstation', name: 'Packstation 7', subtitle: 'Förderband, Klebeband, Luftpolsterfolie', colors: ['#795548', '#ffcc80'] },
  { id: 'retouren', name: 'Retourenhalle', subtitle: 'Gitterboxen und Chaos', colors: ['#5d4037', '#cfd8dc'] },
  { id: 'hafen', name: 'Containerterminal', subtitle: 'Draußen am Kai, Kräne im Rücken', colors: ['#87b5e0', '#d84315'] },
  { id: 'sortieranlage', name: 'Paketzentrum · Sortieranlage', subtitle: '40.000 Pakete pro Stunde', colors: ['#1a1a2e', '#e040fb'] },
  { id: 'gefahrgut', name: 'Gefahrgutlager', subtitle: 'Fässer, Warnlichter, bitte nicht rauchen', colors: ['#212121', '#ffd600'] },
  { id: 'peak', name: 'Black Friday · Peak Season', subtitle: 'Ein Berg aus einer Million Paketen', colors: ['#311b92', '#ff1744'] },
];

export function getStage(id: string): StageInfo {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}
