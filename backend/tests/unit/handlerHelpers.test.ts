import { vi } from 'vitest';

const mockGetById = vi.fn();

vi.mock('../../src/services/podStore.js', () => ({
  podStore: {
    getById: mockGetById,
  },
}));

const { getPodDisplayName } = await import('../../src/utils/handlerHelpers.js');

describe('getPodDisplayName', () => {
  beforeEach(() => {
    mockGetById.mockReset();
  });

  it('Pod 存在時應回傳 Pod 名稱', () => {
    mockGetById.mockReturnValue({ id: 'pod-1', name: 'My Pod' });

    const result = getPodDisplayName('canvas-1', 'pod-1');

    expect(result).toBe('My Pod');
  });

  it('Pod 不存在時應回傳 podId 作為 fallback', () => {
    mockGetById.mockReturnValue(undefined);

    const result = getPodDisplayName('canvas-1', 'pod-1');

    expect(result).toBe('pod-1');
  });
});
