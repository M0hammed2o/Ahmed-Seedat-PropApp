import { useColorScheme } from 'react-native';
import {
  colorDark,
  colorLight,
  iconSize,
  motionDuration,
  radii,
  spacing,
  typeScale,
} from '@propvault/ui';
import { useAppStore } from '@/state/useAppStore';

export function useTheme() {
  const systemScheme = useColorScheme();
  const override = useAppStore((s) => s.colorSchemeOverride);
  const effectiveScheme = override === 'system' ? systemScheme : override;
  const color = effectiveScheme === 'dark' ? colorDark : colorLight;
  return {
    color,
    spacing,
    radii,
    typeScale,
    motionDuration,
    iconSize,
    isDark: effectiveScheme === 'dark',
  };
}
