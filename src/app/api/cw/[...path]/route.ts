import { handleCw } from '@/lib/cw/compat';

type Ctx = { params: Promise<{ path: string[] }> };
const run = async (req: Request, ctx: Ctx) =>
  handleCw(req, (await ctx.params).path);

export const GET = run;
export const POST = run;
export const PUT = run;
export const PATCH = run;
