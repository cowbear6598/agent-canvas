import { describe, it, expect } from 'vitest';
import {
  pathwayStateToSqliteInt,
  sqliteIntToPathwayState,
  isAllPathwaysSettled,
} from '../../src/utils/pathwayHelpers.js';

describe('pathwayStateToSqliteInt', () => {
  it('not-applicable → null', () => {
    expect(pathwayStateToSqliteInt('not-applicable')).toBe(null);
  });

  it('pending → 0', () => {
    expect(pathwayStateToSqliteInt('pending')).toBe(0);
  });

  it('settled → 1', () => {
    expect(pathwayStateToSqliteInt('settled')).toBe(1);
  });
});

describe('sqliteIntToPathwayState', () => {
  it('null → not-applicable', () => {
    expect(sqliteIntToPathwayState(null)).toBe('not-applicable');
  });

  it('0 → pending', () => {
    expect(sqliteIntToPathwayState(0)).toBe('pending');
  });

  it('1 → settled', () => {
    expect(sqliteIntToPathwayState(1)).toBe('settled');
  });

  it('sqliteIntToPathwayState 與 pathwayStateToSqliteInt 互為逆函數（not-applicable）', () => {
    expect(sqliteIntToPathwayState(pathwayStateToSqliteInt('not-applicable'))).toBe('not-applicable');
  });

  it('sqliteIntToPathwayState 與 pathwayStateToSqliteInt 互為逆函數（pending）', () => {
    expect(sqliteIntToPathwayState(pathwayStateToSqliteInt('pending'))).toBe('pending');
  });

  it('sqliteIntToPathwayState 與 pathwayStateToSqliteInt 互為逆函數（settled）', () => {
    expect(sqliteIntToPathwayState(pathwayStateToSqliteInt('settled'))).toBe('settled');
  });
});

describe('isAllPathwaysSettled', () => {
  it('pending auto → false', () => {
    expect(isAllPathwaysSettled('pending', 'not-applicable')).toBe(false);
  });

  it('pending direct → false', () => {
    expect(isAllPathwaysSettled('not-applicable', 'pending')).toBe(false);
  });

  it('both not-applicable → true（沒有路徑，視為已結算）', () => {
    expect(isAllPathwaysSettled('not-applicable', 'not-applicable')).toBe(true);
  });

  it('settled + not-applicable → true', () => {
    expect(isAllPathwaysSettled('settled', 'not-applicable')).toBe(true);
  });

  it('settled + settled → true', () => {
    expect(isAllPathwaysSettled('settled', 'settled')).toBe(true);
  });
});
