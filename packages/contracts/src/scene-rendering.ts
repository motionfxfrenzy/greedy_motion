import type { Beat } from './beat-plan.ts';
import { getLook } from './looks.ts';

/** Native per-scene directions. Material styles stay project-wide and require generated media. */
export const sceneTreatments = ['clean', 'sketch', 'doodle', 'hairline'] as const;
export const sceneGraphics = ['auto', 'dom', 'orbits', 'particles'] as const;
export type SceneRendering = { treatment?: typeof sceneTreatments[number]; graphic?: typeof sceneGraphics[number] };
export type SceneRoute = {
  renderer: 'dom' | 'canvas2d' | 'rough-svg' | 'hairline-svg' | 'media';
  treatment: string;
  graphic: 'none' | 'orbits' | 'particles';
  editability: 'elements' | 'parameters-and-live-text' | 'media-and-live-text';
  reason: string;
};
export function sceneRenderingProblems(value: unknown): string[] {
  if (value === undefined) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['render must be an object'];
  const r = value as Record<string, unknown>;
  const errors: string[] = [];
  if (Object.keys(r).some(k => !['treatment', 'graphic'].includes(k))) errors.push('unknown render option');
  if (r.treatment !== undefined && !sceneTreatments.includes(r.treatment as never)) errors.push('unsupported scene treatment');
  if (r.graphic !== undefined && !sceneGraphics.includes(r.graphic as never)) errors.push('unsupported scene graphic');
  return errors;
}
export function resolveSceneRoute(beat: Pick<Beat, 'kind' | 'role' | 'energy' | 'render'>, look = 'clean'): SceneRoute {
  const problems = sceneRenderingProblems(beat.render);
  if (problems.length) throw new Error(problems.join('; '));
  const style = getLook(look);
  if (style.renderMode === 'generated' && beat.render && Object.keys(beat.render).length) throw new Error('Material films cannot override scenes with native graphics.');
  const treatment = beat.render?.treatment ?? style.id;
  const base = { treatment, graphic: 'none' as const, editability: 'elements' as const };
  if ((style.renderMode === 'generated' && beat.kind !== 'title' && beat.role !== 'cta') || beat.kind === '3d' || beat.kind === 'footage') return { ...base, renderer: 'media', editability: 'media-and-live-text', reason: 'Required generated/imported footage; live text stays in the compositor.' };
  const explicitCanvas = ['orbits', 'particles'].includes(beat.render?.graphic ?? '');
  if (explicitCanvas && (beat.kind !== 'kinetic' || beat.role === 'cta' || treatment !== 'clean')) throw new Error('Procedural graphics require a clean kinetic scene other than the closing CTA.');
  if (beat.kind === 'ui' || beat.kind === 'title' || beat.role === 'cta') return { ...base, renderer: 'dom', reason: 'Structured layout and text retain element editing.' };
  if (treatment === 'hairline') return { ...base, renderer: 'hairline-svg', reason: 'Native vector plates and stroke animation.' };
  if (treatment === 'sketch' || treatment.startsWith('doodle')) return { ...base, renderer: 'rough-svg', reason: 'Seeded hand-drawn SVG with live text.' };
  const graphic = beat.render?.graphic ?? 'auto';
  if (graphic === 'dom' || (graphic === 'auto' && beat.energy !== 'high')) return { ...base, renderer: 'dom', reason: 'Simple geometry stays in the editable DOM.' };
  return { ...base, renderer: 'canvas2d', graphic: graphic === 'particles' ? 'particles' : 'orbits', editability: 'parameters-and-live-text', reason: 'Procedural geometry uses a bounded Canvas layer; text stays editable.' };
}
