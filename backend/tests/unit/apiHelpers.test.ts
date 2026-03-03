import { requireJsonBody } from '../../src/api/apiHelpers.js';

describe('requireJsonBody', () => {
  it('正確的 application/json Content-Type 且有 body 時應回傳 null', () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '13',
      },
      body: '{"test": true}',
    });

    const result = requireJsonBody(req);

    expect(result).toBeNull();
  });

  it('缺少 Content-Type 時應回傳 400 Response', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-length': '13',
      },
      body: '{"test": true}',
    });

    const result = requireJsonBody(req);

    expect(result).toBeInstanceOf(Response);
    expect(result!.status).toBe(400);
    const body = await result!.json();
    expect(body).toMatchObject({ error: '無效的請求格式' });
  });

  it('Content-Length 為 0（空 body）時應回傳 400 Response', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '0',
      },
    });

    const result = requireJsonBody(req);

    expect(result).toBeInstanceOf(Response);
    expect(result!.status).toBe(400);
    const body = await result!.json();
    expect(body).toMatchObject({ error: '無效的請求格式' });
  });

  it('Content-Type 為 application/json; charset=utf-8 時應回傳 null（接受含參數的格式）', () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': '13',
      },
      body: '{"test": true}',
    });

    const result = requireJsonBody(req);

    expect(result).toBeNull();
  });
});
