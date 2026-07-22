import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useTheme } from '../theme';

/** Small pulsing indicator used next to "AI is analysing..." style copy. */
export function PulsingDot({ size = 8 }: { size?: number }) {
  const { color } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.6, duration: 600, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color.accent,
        transform: [{ scale }],
      }}
    />
  );
}
