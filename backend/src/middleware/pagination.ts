import { Response } from 'express';

export function setPaginationHeaders(res: Response, total: number, pageSize: number = 20): void {
  res.setHeader('X-Total-Count', total.toString());
  res.setHeader('X-Page-Size', pageSize.toString());
}
