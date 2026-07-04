// Resolves video/audio file names from the report JSON to servable URLs.
// In mock mode assets come from the contract package; once the real pipeline
// runs, reports point at files under /assets/generated served by vite.
import placeholderBefore from '../../../packages/contract/mock/placeholder-before.mp4?url';
import placeholderAfter from '../../../packages/contract/mock/placeholder-after.mp4?url';
import placeholderSideBySide from '../../../packages/contract/mock/placeholder-side-by-side.mp4?url';
import placeholderFailBefore from '../../../packages/contract/mock/placeholder-fail-before.mp4?url';
import placeholderFailAfter from '../../../packages/contract/mock/placeholder-fail-after.mp4?url';
import placeholderFailSideBySide from '../../../packages/contract/mock/placeholder-fail-side-by-side.mp4?url';

const MOCK_ASSETS: Record<string, string> = {
  'placeholder-before.mp4': placeholderBefore,
  'placeholder-after.mp4': placeholderAfter,
  'placeholder-side-by-side.mp4': placeholderSideBySide,
  'placeholder-fail-before.mp4': placeholderFailBefore,
  'placeholder-fail-after.mp4': placeholderFailAfter,
  'placeholder-fail-side-by-side.mp4': placeholderFailSideBySide,
};

export function resolveAsset(fileName: string, assetBaseUrl?: string): string {
  if (MOCK_ASSETS[fileName]) return MOCK_ASSETS[fileName];
  if (fileName.startsWith('/') || fileName.startsWith('http')) return fileName;
  return `${assetBaseUrl ?? ''}/${fileName}`;
}
