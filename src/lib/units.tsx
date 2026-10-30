import {createContext, use, useState, type ReactNode} from 'react';
import {
  AREA_UNITS,
  formatArea,
  formatDistance,
  LENGTH_UNITS,
  type AreaUnit,
  type LengthUnit,
  type UnitSystem,
} from './geo';

/**
 * Unit preferences (remembered per browser): the system that `auto` follows,
 * and optional fixed units for lengths (and perimeters) and for areas.
 */
type Units = {
  system: UnitSystem;
  length: LengthUnit;
  area: AreaUnit;
  setLength: (length: LengthUnit) => void;
  setSystem: (system: UnitSystem) => void;
  setArea: (area: AreaUnit) => void;
  distance: (metres: number) => string;
  areaText: (m2: number) => string;
};

const SYSTEM_KEY = 'pv-units';
const AREA_KEY = 'pv-area-unit';
const LENGTH_KEY = 'pv-length-unit';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    if (value && (allowed as readonly string[]).includes(value)) return value as T;
  } catch {}
  return fallback;
}

function write(key: string, value: string, fallback: string) {
  try {
    if (value === fallback) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

/** US English browsers start in imperial; everyone else in metric. */
const defaultSystem = (): UnitSystem =>
  typeof navigator !== 'undefined' && /^en-(US|LR|MM)$/i.test(navigator.language) ? 'imperial' : 'metric';

const UnitsContext = createContext<Units | null>(null);

export function UnitsProvider({children}: {children: ReactNode}) {
  const [system, setSystemState] = useState<UnitSystem>(() =>
    read(SYSTEM_KEY, ['metric', 'imperial'], defaultSystem()),
  );
  const [length, setLengthState] = useState<LengthUnit>(() =>
    read(LENGTH_KEY, LENGTH_UNITS.map((u) => u.value), 'auto'),
  );
  const [area, setAreaState] = useState<AreaUnit>(() =>
    read(AREA_KEY, AREA_UNITS.map((u) => u.value), 'auto'),
  );
  const value: Units = {
    system,
    length,
    area,
    setLength(next) {
      setLengthState(next);
      write(LENGTH_KEY, next, 'auto');
    },
    setSystem(next) {
      setSystemState(next);
      write(SYSTEM_KEY, next, defaultSystem());
    },
    setArea(next) {
      setAreaState(next);
      write(AREA_KEY, next, 'auto');
    },
    distance: (metres) => formatDistance(metres, system, length),
    areaText: (m2) => formatArea(m2, area, system),
  };
  return <UnitsContext value={value}>{children}</UnitsContext>;
}

export function useUnits() {
  const units = use(UnitsContext);
  if (!units) throw new Error('useUnits needs a UnitsProvider');
  return units;
}
