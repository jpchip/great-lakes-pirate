import { describe, expect, it } from 'vitest';
import eventsJson from '../data/events.json';
import { eventsFileSchema } from '../data/schemas/events';
import { gameLaw, tierDef } from '../src/sim/law/defs';
import { setHeat } from '../src/sim/law/law';
import {
  captainNames,
  deedScores,
  freshNickname,
  leadingDeed,
  nameFor,
  noteDeed,
  notePlace,
  reviewNickname,
  rerollNickname,
  type NicknameWorld,
} from '../src/sim/news/nickname';
import { gameNews, renderStory, wantedColumn, type PressWorld } from '../src/sim/news/papers';
import type { Story } from '../src/sim/news/state';
import {
  ENDINGS,
  endingForChoice,
  lawmanEligibility,
  retireEligibility,
} from '../src/sim/run/endings';
import { hallRecords } from '../src/sim/run/hall';
import { buildLastRun } from '../src/sim/run/run-end';
import { createWorldState } from '../src/sim/world-state';

const defs = gameNews().file.nicknames;
const law = gameLaw();

function world(fameTier = 1): NicknameWorld {
  return {
    fameTier,
    captain: 'Ida Bergquist',
    seed: 'nick-test',
    placeName: (p) =>
      p === 'site.stockton' ? 'Stockton Island' : p === 'port.bayfield' ? 'Bayfield' : undefined,
  };
}

describe('the nickname (plan 12 §6.3)', () => {
  it('waits for Fame tier 1, then coins a name from the deeds the papers know', () => {
    const s = freshNickname();
    for (let i = 0; i < 3; i++) noteDeed(s, 'crime.contraband', { crimeId: `c${i}` });
    expect(reviewNickname(defs, s, world(0), 0)).toBeUndefined();
    const coined = reviewNickname(defs, s, world(1), 10);
    expect(coined?.from).toBeUndefined();
    expect(s.deed).toBe('smuggler');
    const forms = defs.deeds.find((d) => d.id === 'smuggler')?.names ?? [];
    const possible = forms
      .filter((f) => !f.form.includes('{haunt}'))
      .map((f) => f.form.replace('{first}', 'Ida').replace('{last}', 'Bergquist'));
    expect(possible).toContain(coined?.to);
    expect(s.current).toBe(coined?.to);
    // Reading the same record again changes nothing.
    expect(reviewNickname(defs, s, world(1), 20)).toBeUndefined();
  });

  it('counts a crime once however many reports name it', () => {
    const s = freshNickname();
    expect(noteDeed(s, 'crime.piracy', { crimeId: 'x' })).toBe(true);
    expect(noteDeed(s, 'crime.piracy', { crimeId: 'x' })).toBe(false);
    expect(s.deeds['crime.piracy']).toBe(1);
  });

  it('weighs notoriety: one killing outweighs a few smuggling runs, and ends the Gentleman', () => {
    const s = freshNickname();
    for (let i = 0; i < 2; i++) noteDeed(s, 'crime.piracy');
    expect(leadingDeed(defs, s)).toBe('gentleman');
    for (let i = 0; i < 5; i++) noteDeed(s, 'crime.contraband');
    noteDeed(s, 'crime.killing', { killed: 1 });
    expect(deedScores(defs, s).some((d) => d.id === 'gentleman')).toBe(false);
    expect(leadingDeed(defs, s)).toBe('killer');
  });

  it('changes with the record, holding within the margin', () => {
    const s = freshNickname();
    for (let i = 0; i < 4; i++) noteDeed(s, 'crime.contraband');
    reviewNickname(defs, s, world(), 0);
    expect(s.deed).toBe('smuggler');
    // Thieving at 1.5 a deed: 3 = 4.5 against smuggling's 4 is inside the margin.
    for (let i = 0; i < 3; i++) noteDeed(s, 'crime.burglary');
    expect(reviewNickname(defs, s, world(), 1)).toBeUndefined();
    noteDeed(s, 'crime.burglary');
    const change = reviewNickname(defs, s, world(), 2);
    expect(s.deed).toBe('thief');
    expect(change?.from).toBeDefined();
    expect(s.history.length).toBe(2);
  });

  it('a haunt names the place you are most seen at', () => {
    const s = freshNickname();
    noteDeed(s, 'crime.false_light');
    notePlace(s, 'site.stockton', 8);
    reviewNickname(defs, s, world(), 0);
    expect(s.haunt).toBe('site.stockton');
    // Every wrecker form with or without " of" can name it; most do.
    const all = [0, 1, 2, 3, 4, 5, 6, 7].map((salt) =>
      nameFor(defs, {
        deed: 'wrecker',
        haunt: 'Stockton Island',
        captain: 'Ida Bergquist',
        seed: 's',
        salt,
      }),
    );
    expect(all.some((n) => n.includes('Stockton Island'))).toBe(true);
  });

  it('the letter to the editor rerolls it once', () => {
    const s = freshNickname();
    for (let i = 0; i < 2; i++) noteDeed(s, 'crime.piracy');
    const first = reviewNickname(defs, s, world(), 0);
    const r = rerollNickname(defs, s, world(), 1);
    expect(typeof r).toBe('object');
    if (typeof r === 'string') return;
    expect(r.from).toBe(first?.to);
    expect(r.to).not.toBe(r.from);
    expect(s.rerolled).toBe(true);
    expect(typeof rerollNickname(defs, s, world(), 2)).toBe('string');
  });

  it('splits a captain name', () => {
    expect(captainNames('Ida Bergquist')).toEqual({ first: 'Ida', last: 'Bergquist' });
    expect(captainNames('Ole')).toEqual({ first: 'Ole', last: 'Ole' });
  });
});

describe('the nickname in the papers', () => {
  const news = gameNews();
  const state = createWorldState('papers-nick', 0);
  const press: PressWorld = {
    law,
    lawWorld: { law: state } as unknown as PressWorld['lawWorld'],
    captain: 'Ida Bergquist',
    ship: 'Kittiwake',
    nickname: 'Bloody Ida',
    seed: 'x',
    goodName: (g) => g,
    cutter: () => [],
    weather: () => ({ text: '', signals: [] }),
  };
  const paper = news.papers[0];
  if (!paper) throw new Error('no papers');
  const story = (s: Partial<Story>): Story => ({
    id: 'story-1',
    kind: 'crime',
    key: 'k',
    at: 0,
    region: paper.region,
    ident: 'person',
    crime: 'crime.piracy',
    heat: 0,
    printedIn: [],
    heated: false,
    ...s,
  });

  it('heads a story about you by name with it, and sets it in the body', () => {
    const a = renderStory(news, press, story({}), paper, 0);
    expect(`${a.headline} ${a.deck}`).toMatch(/BLOODY IDA|Bloody Ida/);
    // A story that only knew the ship doesn't use it.
    const b = renderStory(news, press, story({ ident: 'ship' }), paper, 0);
    expect(`${b.headline} ${b.deck} ${b.body}`).not.toContain('Bloody Ida');
  });

  it('prints the coining story', () => {
    const a = renderStory(news, press, story({ kind: 'nickname', nick: 'Bloody Ida' }), paper, 0);
    expect(`${a.headline} ${a.body}`).toContain('Bloody Ida'.toUpperCase().slice(0, 6));
    expect(a.body).toContain('Bloody Ida');
  });

  it('gives the WANTED notice an alias', () => {
    const s = createWorldState('wanted-nick', 0);
    setHeat(law, s, paper.covers[0] ?? paper.region, tierDef(law, 3).minHeat);
    const col = wantedColumn(
      { ...press, lawWorld: { law: s } as unknown as PressWorld['lawWorld'] },
      paper,
      0,
    );
    expect(col[0]?.alias).toBe('Called "Bloody Ida"');
  });
});

describe('the voluntary endings (plan 12 §4.2)', () => {
  const base = { wealthCents: 0, fameTier: 0, wantedTiers: [0, 0], standing: {} };

  it('Retire needs wealth and no region at tier 3 or above', () => {
    expect(retireEligibility(base).missing).toEqual(['wealth']);
    const rich = { ...base, wealthCents: ENDINGS.retire.wealthCents };
    expect(retireEligibility(rich).ok).toBe(true);
    expect(retireEligibility({ ...rich, wantedTiers: [3] }).missing).toEqual(['wanted']);
  });

  it('Turn Lawman needs Fame high, every region at 1 or below, and good Standing', () => {
    const ok = {
      ...base,
      fameTier: ENDINGS.lawman.minFameTier,
      wantedTiers: [1, 0],
      standing: { 'port.bayfield': 70, 'port.ashland': 65 },
    };
    expect(lawmanEligibility(ok).ok).toBe(true);
    expect(lawmanEligibility({ ...ok, wantedTiers: [2] }).missing).toEqual(['wanted']);
    expect(lawmanEligibility({ ...ok, standing: { 'port.bayfield': 70 } }).missing).toEqual([
      'standing',
    ]);
  });

  it("maps the letters' choices to the endings, and every one exists", () => {
    const events = eventsFileSchema.parse(eventsJson);
    const retire = events.events.find((e) => e.id === ENDINGS.retire.event);
    const lawman = events.events.find((e) => e.id === ENDINGS.lawman.event);
    expect(ENDINGS.retire.retirements).toHaveLength(3);
    for (const r of ENDINGS.retire.retirements) {
      expect(retire?.choices?.some((c) => c.id === r.choice)).toBe(true);
      expect(endingForChoice(ENDINGS.retire.event, r.choice)).toMatchObject({ kind: 'retired' });
    }
    expect(lawman?.choices?.some((c) => c.id === ENDINGS.lawman.choice)).toBe(true);
    expect(endingForChoice(ENDINGS.retire.event, 'not_yet')).toBeUndefined();
    expect(endingForChoice(ENDINGS.lawman.event, 'decline')).toBeUndefined();
    expect(retire?.draw).toBe(false);
  });

  it('prints a retirement with its epilogue, under the nickname', () => {
    const s = createWorldState('retire', 0);
    s.player.captain = { name: 'Ida Bergquist', shipName: 'Kittiwake', background: 'fisherman' };
    s.nickname = { ...freshNickname(), current: 'Whiskey Ida' };
    const last = buildLastRun(law, s, 'retired', 3600 * 24 * 10, new Date(), {
      retirement: 'cabin',
    });
    expect(last.frontPage.headline).toBe('WHISKEY IDA GONE TO THE ISLANDS');
    expect(last.frontPage.body[0]).toContain('Captain Ida Bergquist, "Whiskey Ida," master');
    expect(last.epilogue?.length).toBeGreaterThan(0);
    expect(last.epitaph).toMatch(/^Went to ground on Sand Island, /);
    expect(last.nickname).toBe('Whiskey Ida');
    expect(last.summary.find((r) => r.label === 'Known to the papers as')?.value).toBe(
      'Whiskey Ida',
    );
    expect(last.summary.find((r) => r.label === 'How it ended')?.value).toBe(
      'Retired to a cabin on Sand Island',
    );
  });

  it('prints the lawman page with its ironic headline', () => {
    const s = createWorldState('lawman', 0);
    const last = buildLastRun(law, s, 'lawman', 3600 * 24 * 3, new Date());
    expect(last.frontPage.headline).toBe("NOTORIOUS PIRATE PINS ON A MARSHAL'S STAR");
    expect(last.frontPage.paper).toBe('The Duluth Daily Lantern');
    expect(last.summary.find((r) => r.label === 'How it ended')?.value).toBe('Turned lawman');
  });

  it('counts lives taken in the summary', () => {
    const s = createWorldState('killer', 0);
    if (s.stats) s.stats.killed = 2;
    const last = buildLastRun(law, s, 'abandoned', 3600, new Date());
    expect(last.summary.find((r) => r.label === 'Lives taken')?.value).toBe('2 souls');
  });
});

describe('the Hall of Captains', () => {
  it('reads the records it can, latest first', () => {
    const rec = (iso: string) => ({
      captain: 'Ole',
      shipName: 'Hope',
      cause: 'retired',
      epitaph: 'x',
      headline: 'Y',
      summary: [],
      endedAtIso: iso,
    });
    const out = hallRecords([rec('2026-01-01'), { junk: true }, rec('2026-02-01')]);
    expect(out.map((r) => r.endedAtIso)).toEqual(['2026-02-01', '2026-01-01']);
  });
});
