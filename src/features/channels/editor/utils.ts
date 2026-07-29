import type { ModelCatalogMetaUpdate } from '../types';

import { getCatalogProviderLogo, getCatalogModel, formatTokenCount } from '@/lib/modelsCatalog';

/** Format release date for display */
export function formatReleaseDate(value?: string): string {
  if (!value) return '';
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const monthOnly = value.match(/^(\d{4})-(\d{2})$/);
  if (monthOnly) return `${value}-01`;
  return value;
}

/** Build catalog metadata for an API pool entry */
export function buildEntryCatalogMeta(modelName: string): ModelCatalogMetaUpdate {
  const model = getCatalogModel(modelName);
  if (!model) {
    return {
      model: modelName,
      provider_logo: getCatalogProviderLogo(modelName),
      release_date: '',
      model_meta_zh: '',
      model_meta_en: '',
    };
  }

  const inputs = model.modalities?.input || [];
  const outputs = model.modalities?.output || [];
  const features: string[] = [];
  if (outputs.includes('image')) features.push('imageGeneration');
  if (inputs.includes('image')) features.push('imageUnderstanding');
  if (inputs.includes('audio') || outputs.includes('audio')) features.push('audio');
  if (inputs.includes('video') || outputs.includes('video')) features.push('video');
  if (inputs.includes('pdf') || outputs.includes('pdf')) features.push('pdf');
  if (model.reasoning) features.push('reasoning');
  if (model.interleaved) features.push('interleaved');
  if (model.tool_call) features.push('toolCall');
  if (model.structured_output) features.push('structuredOutput');
  if (model.attachment) features.push('attachment');
  if (model.temperature) features.push('temperature');

  const releaseDate = formatReleaseDate(model.release_date);
  const context = formatTokenCount(model.limit?.context) || '';
  const output = formatTokenCount(model.limit?.output) || '';
  const enFeatureLabels: Record<string, string> = {
    imageGeneration: 'Image Gen',
    imageUnderstanding: 'Vision',
    audio: 'Audio',
    video: 'Video',
    pdf: 'PDF',
    reasoning: 'Reasoning',
    interleaved: 'Reasoning Trace',
    toolCall: 'Tool Calling',
    structuredOutput: 'Struct Output',
    attachment: 'Attachment',
    temperature: 'Temperature',
  };
  const buildMeta = (labels: Record<string, string>, releaseLabel: string, contextLabel: string, outputLabel: string) => [
    releaseDate ? `${releaseLabel}: ${releaseDate}` : null,
    ...features.map((feature) => labels[feature]).filter(Boolean),
    context ? `${contextLabel}: ${context}` : null,
    output ? `${outputLabel}: ${output}` : null,
  ].filter(Boolean).join(' / ');

  return {
    model: modelName,
    provider_logo: getCatalogProviderLogo(modelName),
    release_date: releaseDate,
    model_meta_zh: buildMeta(enFeatureLabels, 'Released', 'Context', 'Output'),
    model_meta_en: buildMeta(enFeatureLabels, 'Release', 'Context', 'Output'),
  };
}
