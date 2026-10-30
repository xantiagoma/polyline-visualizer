import {ChevronDownIcon, MonitorIcon, MoonIcon, SunIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {useTheme, type ThemePreference} from '@/lib/theme';

const THEMES: [ThemePreference, string, typeof SunIcon][] = [
  ['light', 'Light', SunIcon],
  ['dark', 'Dark', MoonIcon],
  ['system', 'System', MonitorIcon],
];

export function ThemeControl() {
  const {preference, setPreference} = useTheme();
  const [, label, Icon] = THEMES.find(([value]) => value === preference)!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" aria-label={`Theme: ${label}`} />}
      >
        <Icon data-icon="inline-start" />
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preference}
            onValueChange={(value) => setPreference(value as ThemePreference)}
          >
            {THEMES.map(([value, name, ItemIcon]) => (
              <DropdownMenuRadioItem key={value} value={value} closeOnClick>
                <ItemIcon />
                {name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
