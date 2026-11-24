import { describe, expect, it } from 'vitest';
import { ACT_SECONDS, captainClip, idleFor, npcClip } from '../src/render/characters/figure-clips';
import { CLIPS } from '../src/render/characters/humanoid-spec';
import { lookPieces, npcLook, npcRoleFor, NPC_ROLES } from '../src/render/characters/looks';

/** The bodies in the game (plan 08 §20 piece B): who wears what and which clip plays. */

describe('NPC types to roles', () => {
  it('dresses every on-foot NPC type in the game as a role of its own', () => {
    for (const type of ['constable', 'watchman', 'marshal', 'sailor', 'keeper', 'shopkeeper']) {
      expect(npcRoleFor(`npc.${type}`, 'a')).toBe(type);
    }
    for (const type of ['fence', 'fisherman', 'farmer', 'dockhand']) {
      expect(npcRoleFor(`npc.${type}`, 'a')).toBe(type);
    }
    expect(npcRoleFor('npc.smuggler', 'a')).toBe('townsman');
  });

  it('makes some townsfolk and villagers women, the same ones every time', () => {
    const ids = Array.from({ length: 200 }, (_, k) => `crowd:${k}`);
    const women = ids.filter((id) => npcRoleFor('npc.townsman', id) === 'townswoman');
    expect(women.length).toBeGreaterThan(40);
    expect(women.length).toBeLessThan(120);
    for (const id of women) expect(npcRoleFor('npc.townsman', id)).toBe('townswoman');
    const village = ids.map((id) => npcRoleFor('npc.villager', id));
    expect(new Set(village)).toEqual(new Set(['villager', 'townswoman']));
  });

  it('gives the new roles real pieces', () => {
    for (const role of NPC_ROLES) {
      const look = npcLook(role, 3);
      expect(lookPieces(look)).toContain('head');
      if (look.body === 'female') expect(look.beard).toBe('none');
    }
  });
});

describe('the captain’s clip', () => {
  it('walks, runs and swims by gait, as the spike did', () => {
    expect(captainClip({ gait: 'walk', speed: 1.6 }).clip).toBe('walk');
    expect(captainClip({ gait: 'run', speed: 6 }).clip).toBe('sprint');
    expect(captainClip({ gait: 'swim', speed: 0 }).clip).toBe('swimIdle');
    expect(captainClip({ gait: 'idle', speed: 0, carrying: true }).clip).toBe('carry');
  });

  it('sits at the oars in the boat', () => {
    expect(captainClip({ gait: 'walk', speed: 2, rowing: true }).clip).toBe('sit');
  });

  it('plays a blow for its length, then hands back to the gait', () => {
    const act = { kind: 'cosh' as const, ageS: 0.1 };
    expect(captainClip({ gait: 'walk', speed: 1.5, act }).clip).toBe('cosh');
    const later = { kind: 'cosh' as const, ageS: ACT_SECONDS.cosh + 0.01 };
    expect(captainClip({ gait: 'walk', speed: 1.5, act: later }).clip).toBe('walk');
    // Swimming, the arms are busy.
    expect(captainClip({ gait: 'swim', speed: 1, act }).clip).toBe('swim');
  });

  it('works at a lock standing, or kneels at it crouched, on a loop', () => {
    expect(captainClip({ gait: 'idle', speed: 0, working: true })).toEqual({
      clip: 'pick',
      timeScale: 1,
      loop: true,
    });
    expect(captainClip({ gait: 'sneak', speed: 0, working: true }).clip).toBe('kneelWork');
    // Walking off lets go.
    expect(captainClip({ gait: 'walk', speed: 1.5, working: true }).clip).toBe('walk');
  });
});

describe('an NPC’s clip', () => {
  it('lies down when knocked out, bound or dead', () => {
    for (const state of ['unconscious', 'bound', 'dead']) {
      expect(npcClip({ state, speed: 0 }).clip).toBe('knockedDown');
    }
  });

  it('walks a beat and runs a chase by speed, with the lantern at rest', () => {
    expect(npcClip({ state: 'patrol', speed: 1.4 }).clip).toBe('walk');
    expect(npcClip({ state: 'alerted', speed: 4 }).clip).toBe('run');
    expect(npcClip({ state: 'patrol', speed: 0, lantern: true }).clip).toBe('lanternIdle');
    expect(npcClip({ state: 'patrol', speed: 1.4, gait: 'walk' }).clip).toBe('walk');
  });

  it('calls out when alarmed, looks about when searching, and drinks when drunk', () => {
    expect(npcClip({ state: 'alerted', speed: 0 }).clip).toBe('alarmed');
    expect(npcClip({ state: 'search', speed: 0 }).clip).toBe('search');
    expect(npcClip({ state: 'drunk', speed: 0 }).clip).toBe('drink');
  });

  it('keeps shopkeepers at their counters and hands at their tables', () => {
    expect(idleFor('npc.shopkeeper', 'keeper:x')).toBe('armsFolded');
    expect(idleFor('npc.sailor', 'crew:ship:0')).toBe('talk');
    expect(npcClip({ state: 'idle', speed: 0, idle: 'talk' }).clip).toBe('talk');
  });

  it('only names clips the bodies have', () => {
    const states = ['patrol', 'alerted', 'search', 'drunk', 'bribed', 'distracted', 'dead'];
    for (const state of states) {
      for (const speed of [0, 1, 3, 6]) {
        expect(CLIPS).toHaveProperty(npcClip({ state, speed }).clip);
      }
    }
  });
});
