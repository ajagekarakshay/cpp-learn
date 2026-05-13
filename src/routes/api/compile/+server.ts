import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { compileAndRun } from '$lib/server/godbolt';
import type { RequestHandler } from './$types';

const Body = z.object({
	source: z.string().min(1).max(50_000),
	standard: z.enum(['c++20', 'c++23', 'c++26']),
	stdin: z.string().max(10_000).optional(),
	wantAsm: z.boolean().optional()
});

export const POST: RequestHandler = async ({ request }) => {
	const raw = await request.json().catch(() => null);
	const parsed = Body.safeParse(raw);
	if (!parsed.success) error(400, parsed.error.issues.map((i) => i.message).join('; '));

	try {
		const result = await compileAndRun(parsed.data.source, parsed.data.standard, {
			stdin: parsed.data.stdin,
			wantAsm: parsed.data.wantAsm
		});
		return json(result);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		error(502, `compile failed: ${msg}`);
	}
};
