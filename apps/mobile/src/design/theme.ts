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

export function useTheme() {
  const scheme = useColorScheme();
  const color = scheme === 'dark' ? colorDark : colorLight;
  return { color, spacing, radii, typeScale, motionDuration, iconSize };
}
