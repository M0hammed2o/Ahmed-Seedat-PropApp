import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';

export interface AnimatedProgressBarProps {
  progress: number; // 0-1
  colorToken?: 'accent' | 'statusPaid' | 'statusOverdue';
  height?: number;
}

export function AnimatedProgressBar({
  progress,
  colorToken = 'accent',
  height = 8,
}: AnimatedProgressBarProps) {
  const { color, radii } = useTheme();
  const animated = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animated, {
      toValue: Math.max(0, Math.min(1, progress)),
      duration: 480,
      useNativeDriver: false,
    }).start();
  }, [animated, progress]);

  return (
    <View
      style={[styles.track, { backgroundColor: color.border, height, borderRadius: radii.pill }]}
    >
      <Animated.View
        style={{
          height,
          borderRadius: radii.pill,
          backgroundColor: color[colorToken],
          width: animated.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden' },
});
