import {useEffect, useRef, useState} from 'react';
import {CheckIcon, CopyIcon} from 'lucide-react';
import {toast} from 'sonner';
import {writeClipboard} from '@/lib/utils';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';

/** Copies the last valid value (never an unconfirmed draft). */
export function CopyButton({
  value,
  label,
  size = 'icon-lg',
  variant = 'outline',
}: {
  value: string;
  label: string;
  size?: 'icon' | 'icon-sm' | 'icon-lg';
  variant?: 'outline' | 'ghost';
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await writeClipboard(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
      toast.success(`Copied ${label}`, {
        description: value.length > 120 ? `${value.slice(0, 120)}…` : value,
      });
    } catch {
      toast.error(`Could not copy ${label}`, {
        description:
          'Clipboard access was blocked. Select the value and copy it manually.',
      });
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={variant}
            size={size}
            className={
              size === 'icon-lg' ? 'size-11 shrink-0 bg-card' : 'shrink-0'
            }
            aria-label={`Copy ${label}`}
            onClick={copy}
          />
        }
      >
        {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
      </TooltipTrigger>
      <TooltipContent>{copied ? 'Copied' : `Copy ${label}`}</TooltipContent>
    </Tooltip>
  );
}
