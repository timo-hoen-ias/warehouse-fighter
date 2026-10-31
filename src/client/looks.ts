// Aussehen und Kampfstil je Kämpfer – nur Darstellung, keine Spielwerte.
// Jeder Kämpfer bekommt eine eigene Statur, Frisur, Ausrüstung und Haltung.

export type Stance = 'brawler' | 'boxer' | 'heavy' | 'upright' | 'nimble' | 'robot';

export type Extra =
  | 'earmuffs'
  | 'headset'
  | 'kneepads'
  | 'apron'
  | 'beltTape'
  | 'badge'
  | 'lanyard'
  | 'hood'
  | 'furCollar'
  | 'toolbelt'
  | 'headband'
  | 'tracks'
  | 'chestPanel'
  | 'beacon'
  | 'claws'
  | 'shoulderPads'
  | 'flannel'
  | 'glassesChain';

export interface Look {
  /** Körpergröße (1 = normal). */
  height: number;
  /** Bauch (Radius in Metern), 0 = keiner. */
  belly: number;
  hair?: 'ponytail' | 'bun' | 'bob' | 'messy' | 'dreads';
  hairColor: number;
  beard?: 'full' | 'stubble' | 'frost';
  glasses?: 'round' | 'sun';
  /** Handschuh-Farbe. */
  gloves: number;
  extras: Extra[];
  stance: Stance;
  /** Farbe der Schlagspur. */
  trail: number;
}

const base: Look = { height: 1, belly: 0, hairColor: 0x3e2723, gloves: 0xd8a000, extras: [], stance: 'brawler', trail: 0xffffff };

export const LOOKS: Record<string, Look> = {
  gerd: { ...base, height: 1.04, belly: 0.17, gloves: 0x8d6e63, extras: ['earmuffs', 'shoulderPads'], stance: 'heavy', trail: 0xffb300 },
  kim: { ...base, height: 0.96, hair: 'ponytail', hairColor: 0x1b1b1b, gloves: 0x263238, extras: ['headset', 'kneepads'], stance: 'boxer', trail: 0xc6ff00 },
  piet: { ...base, beard: 'stubble', hairColor: 0x5d4037, gloves: 0xd8a000, extras: ['apron', 'beltTape'], trail: 0xff4d6d },
  lena: { ...base, hair: 'bun', hairColor: 0x4e2a1e, glasses: 'round', gloves: 0xeceff1, extras: ['badge'], stance: 'upright', trail: 0x40e0ff },
  ludger: { ...base, height: 1.1, belly: 0.22, beard: 'full', hairColor: 0x4e342e, glasses: 'sun', gloves: 0x5d4037, extras: ['flannel'], stance: 'heavy', trail: 0xffeb3b },
  paul: { ...base, height: 0.9, hair: 'messy', hairColor: 0xc8a050, gloves: 0xf3d0b5, extras: ['lanyard', 'hood'], stance: 'nimble', trail: 0xffa726 },
  ingrid: { ...base, height: 0.96, hair: 'bob', hairColor: 0xb8b8c0, glasses: 'round', gloves: 0x7e57c2, extras: ['glassesChain'], stance: 'upright', trail: 0xe040fb },
  kalle: { ...base, height: 1.06, belly: 0.08, beard: 'frost', hairColor: 0xe0f7fa, gloves: 0x1565c0, extras: ['furCollar', 'shoulderPads'], stance: 'heavy', trail: 0x80d8ff },
  rita: { ...base, hair: 'dreads', hairColor: 0x2b1b10, gloves: 0xff8f00, extras: ['headband', 'toolbelt'], stance: 'brawler', trail: 0xffc107 },
  robo: { ...base, height: 1.05, gloves: 0x78909c, extras: ['tracks', 'chestPanel', 'beacon', 'claws'], stance: 'robot', trail: 0x00e5ff },
};

export function getLook(id: string): Look {
  return LOOKS[id] ?? base;
}
