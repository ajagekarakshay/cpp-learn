import { error } from '@sveltejs/kit';
import conceptsRaw from '$lib/data/concepts.json' with { type: 'json' };
import type { ConceptsData } from '$lib/types';
import type { PageLoad } from './$types';

const data = conceptsRaw as ConceptsData;

export const load: PageLoad = ({ params }) => {
	const concept = data.concepts.find((c) => c.id === params.concept);
	if (!concept) error(404, 'concept not found');
	const mod = data.modules.find((m) => m.id === concept.moduleId);
	return { concept, module: mod };
};
