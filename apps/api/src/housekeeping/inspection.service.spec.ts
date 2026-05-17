import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { parseVerdict } from './inspection.service';

describe('parseVerdict', () => {
  it('parses plain JSON', () => {
    const v = parseVerdict(
      '{"verdict":"clean","issues":[],"confidence":0.92,"reasoning":"todo ok"}',
    );
    expect(v.verdict).toBe('clean');
    expect(v.confidence).toBeCloseTo(0.92);
    expect(v.reasoning).toBe('todo ok');
  });

  it('strips ```json fences before parsing', () => {
    const v = parseVerdict(
      '```json\n{"verdict":"dirty","issues":["basura","cama deshecha"],"confidence":0.8,"reasoning":"falta limpiar"}\n```',
    );
    expect(v.verdict).toBe('dirty');
    expect(v.issues).toEqual(['basura', 'cama deshecha']);
  });

  it('clamps confidence to [0,1]', () => {
    expect(parseVerdict('{"verdict":"clean","issues":[],"confidence":3,"reasoning":"x"}').confidence).toBe(1);
    expect(parseVerdict('{"verdict":"clean","issues":[],"confidence":-0.5,"reasoning":"x"}').confidence).toBe(0);
  });

  it('throws on unknown verdict', () => {
    expect(() =>
      parseVerdict('{"verdict":"sucio","issues":[],"confidence":0.5,"reasoning":"x"}'),
    ).toThrow(BadRequestException);
  });

  it('throws on non-JSON output', () => {
    expect(() => parseVerdict('No puedo determinar el estado de la habitación.')).toThrow(
      BadRequestException,
    );
  });

  it('caps issues to 10 items and skips non-strings', () => {
    const many = Array.from({ length: 20 }, (_, i) => `i${i}`);
    const v = parseVerdict(
      JSON.stringify({ verdict: 'damaged', issues: [...many, 42, null], confidence: 0.7, reasoning: 'rotura' }),
    );
    expect(v.issues.length).toBeLessThanOrEqual(10);
    expect(v.issues.every((s) => typeof s === 'string')).toBe(true);
  });
});
