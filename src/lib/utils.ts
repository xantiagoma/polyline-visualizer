import {type ClassValue, clsx} from 'clsx';
import {twMerge} from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Clipboard write with a fallback for insecure contexts (plain HTTP), where
 * `navigator.clipboard` is undefined.
 */
export async function writeClipboard(text: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.cssText = 'position:fixed;opacity:0';
  document.body.append(el);
  el.select();
  const ok = document.execCommand('copy');
  el.remove();
  if (!ok) throw new Error('Copy failed');
}
