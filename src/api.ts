export class RequestError extends Error {
  code: string;
  current: unknown;

  constructor(message: string, code: string, current?: unknown) {
    super(message);
    this.code = code;
    this.current = current;
  }
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api/' + path, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new RequestError(body?.error || '로컬 서버 응답 확인 필요', body?.code, body?.details?.current);
  return body as T;
}

export const post = <T>(path: string, body: unknown) => request<T>(path, {
  method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
});
export const upload = <T>(path: string, file: File) => request<T>(path, {
  method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:file,
});
export const fileUrl = (mountId: string, name: string) => '/api/files/' + mountId + '/' + encodeURIComponent(name);
export const exportUrl = (mountId: string, format: string) => '/api/export/' + mountId + '/' + format;

