import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';

export function SkeletonBlock({
  height = 16,
  width = '100%',
}: {
  height?: number;
  width?: number | `${number}%`;
}) {
  const { color, radii, motionDuration } = useTheme();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: motionDuration.slow,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: motionDuration.slow,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, motionDuration]);

  return (
    <Animated.View
      accessibilityElementsHidden
      style={[
        styles.block,
        { height, width, backgroundColor: color.border, borderRadius: radii.sm, opacity },
      ]}
    />
  );
}

export function SkeletonState({ rows = 3 }: { rows?: number }) {
  const { spacing } = useTheme();
  return (
    <View style={{ padding: spacing[4], gap: spacing[3] }}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonBlock key={i} height={56} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {},
});
